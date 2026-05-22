// eslint-disable-next-line import/consistent-type-specifier-style -- keep Node integration tests from loading the native React Native package
import type {
	ListenerEvent,
	SshConnection,
	TerminalChunk,
} from '@fressh/react-native-uniffi-russh';

export type SshJsonlListenerHandle = {
	stop: () => Promise<void>;
};

export async function startSshJsonlListener(input: {
	connection: SshConnection;
	command: string;
	onLine: (line: string) => void;
	onExit: (error?: unknown) => void;
}): Promise<SshJsonlListenerHandle> {
	const shell = await input.connection.startShell({
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
	});
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	let stopped = false;

	const listenerId = shell.addListener(
		(event) => {
			if (stopped || !isStdoutTerminalChunk(event)) return;

			buffer += decoder.decode(event.bytes, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) input.onLine(trimmed);
			}
		},
		{ cursor: { mode: 'live' } },
	);

	try {
		await shell.sendData(
			encoder.encode(`${input.command}\n`).buffer as ArrayBuffer,
		);
	} catch (error) {
		console.warn('failed to start JSONL listener command', error);
		input.onExit(error);
	}

	return {
		stop: async () => {
			if (stopped) return;

			stopped = true;
			shell.removeListener(listenerId);
			try {
				await shell.close();
			} catch (error) {
				console.warn('failed to close JSONL listener shell', error);
			}
		},
	};
}

function isTerminalChunk(event: ListenerEvent): event is TerminalChunk {
	return 'bytes' in event && 'stream' in event;
}

function isStdoutTerminalChunk(event: ListenerEvent): event is TerminalChunk {
	return isTerminalChunk(event) && event.stream === 'stdout' && !!event.bytes;
}
