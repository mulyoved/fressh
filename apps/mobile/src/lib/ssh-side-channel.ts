import {
	type SshConnection,
	type ListenerEvent,
	type TerminalChunk,
} from '@fressh/react-native-uniffi-russh';
import { rootLogger } from './logger';

const logger = rootLogger.extend('SshSideChannel');

export type SideChannelResult = {
	success: boolean;
	output: string;
	error?: string;
	/** GitHub issue URL if detected in output */
	issueUrl?: string;
};

function isTerminalChunk(event: ListenerEvent): event is TerminalChunk {
	return 'bytes' in event && 'stream' in event;
}

/**
 * Execute a command on a side-channel SSH session.
 * Creates a temporary shell on the existing connection, runs the command,
 * captures output, and closes the shell - without interfering with the main terminal.
 */
export async function executeSideChannelCommand(
	connection: SshConnection,
	command: string,
	timeoutMs: number = 30000,
): Promise<SideChannelResult> {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// Unique marker to detect command completion
	const endMarker = `__SIDE_CHANNEL_DONE_${Date.now()}__`;

	logger.debug('Starting side-channel shell for command execution');

	// Create a new shell session on the same connection
	const sideShell = await connection.startShell({
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
	});

	logger.debug('Side-channel shell created', {
		channelId: sideShell.channelId,
	});

	const outputChunks: ArrayBuffer[] = [];
	let completed = false;

	// Add listener to capture output
	const listenerId = sideShell.addListener(
		(event: ListenerEvent) => {
			if (isTerminalChunk(event) && event.bytes) {
				outputChunks.push(event.bytes);
			}
		},
		{ cursor: { mode: 'live' } },
	);

	// Cleanup handle to cancel polling when timeout fires
	const cleanupRef: { current: (() => void) | null } = { current: null };

	try {
		// Send the command followed by exit code capture and end marker
		// Format: command runs, capture exit code, echo marker, echo exit code
		const fullCommand = `${command}; __EC__=$?; echo "${endMarker}"; echo "EXIT_CODE:$__EC__"\n`;
		const encodedCommand = encoder.encode(fullCommand);
		await sideShell.sendData(encodedCommand.buffer as ArrayBuffer);

		// Wait for completion or timeout
		const result = await Promise.race([
			waitForMarker(
				outputChunks,
				endMarker,
				decoder,
				() => completed,
				(cleanup) => {
					cleanupRef.current = cleanup;
				},
			),
			new Promise<SideChannelResult>((_, reject) =>
				setTimeout(() => reject(new Error('Command timed out')), timeoutMs),
			),
		]);

		completed = true;
		return result;
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		logger.error('Side-channel command failed', { error: errorMessage });
		return {
			success: false,
			output: '',
			error: errorMessage,
		};
	} finally {
		completed = true;
		// Clean up polling timer if still running
		cleanupRef.current?.();
		// Clean up shell resources
		sideShell.removeListener(listenerId);
		try {
			await sideShell.close();
			logger.debug('Side-channel shell closed');
		} catch (closeErr) {
			logger.warn('Failed to close side-channel shell', { error: closeErr });
		}
	}
}

async function waitForMarker(
	chunks: ArrayBuffer[],
	marker: string,
	decoder: TextDecoder,
	isCompleted: () => boolean,
	onCleanup: (cleanup: () => void) => void,
): Promise<SideChannelResult> {
	return new Promise((resolve) => {
		let pendingTimeoutId: ReturnType<typeof setTimeout> | null = null;

		// Provide cleanup function to caller so they can cancel polling
		onCleanup(() => {
			if (pendingTimeoutId !== null) {
				clearTimeout(pendingTimeoutId);
				pendingTimeoutId = null;
			}
		});

		const checkForCompletion = () => {
			// Clear reference since we're now executing
			pendingTimeoutId = null;

			// Stop polling if parent has completed/aborted
			if (isCompleted()) return;

			// Combine all chunks into a single string
			const totalLength = chunks.reduce(
				(sum, chunk) => sum + chunk.byteLength,
				0,
			);
			const combined = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				combined.set(new Uint8Array(chunk), offset);
				offset += chunk.byteLength;
			}

			const output = decoder.decode(combined);

			// Look for marker as a standalone line (not part of command echo)
			// The marker appears alone when echoed, but inside the command when echoed back
			const markerLineRegex = new RegExp(`^${marker}\\s*$`, 'm');
			if (markerLineRegex.test(output)) {
				// Extract output before the marker, removing the command echo and marker
				const lines = output.split('\n');
				const markerLineIndex = lines.findIndex(
					(line) => line.trim() === marker,
				);

				// Get lines between command echo and marker (skip first line which is command echo)
				const relevantLines = lines.slice(1, markerLineIndex);
				const cleanOutput = relevantLines.join('\n').trim();

				// Parse exit code from output (appears after marker as "EXIT_CODE:N")
				const exitCodeMatch = output.match(/EXIT_CODE:(\d+)/);
				const exitCode =
					exitCodeMatch?.[1] != null ? parseInt(exitCodeMatch[1], 10) : null;

				// Success is determined by exit code: 0 = success, non-zero = failure
				// Fall back to string heuristics only if exit code couldn't be parsed
				const hasError =
					exitCode !== null
						? exitCode !== 0
						: output.includes('error:') ||
							output.includes('Error:') ||
							output.includes('fatal:') ||
							output.includes('command not found');

				// Extract GitHub issue URL from raw output (before cleaning strips it)
				const issueUrlMatch = output.match(
					/https:\/\/github\.com\/[\w./-]+\/issues\/\d+/,
				);
				const issueUrl = issueUrlMatch ? issueUrlMatch[0] : undefined;

				resolve({
					success: !hasError,
					output: cleanOutput,
					error: hasError ? cleanOutput : undefined,
					issueUrl,
				});
				return;
			}

			// Schedule next check, tracking the timeout ID for cleanup
			pendingTimeoutId = setTimeout(checkForCompletion, 100);
		};

		checkForCompletion();
	});
}
