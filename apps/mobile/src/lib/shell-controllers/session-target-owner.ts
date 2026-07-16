import { type RegisteredSshConnection } from '../ssh-registry-store';
import { executeSideChannelCommand } from '../ssh-side-channel';
import {
	type ShellHostCommandPort,
	type ShellWorkmuxPort,
} from './session-contracts';
import { type ShellDiagnosticPort } from './session-diagnostics';
import {
	createShellSessionWorkmuxOwner,
	createShellSessionWorkmuxInput,
	type ShellSessionWorkmuxOwner,
} from './session-workmux';
import { type ShellTargetKey } from './source-keys';

export type ShellTargetPublication = {
	readonly generation: number;
	readonly key: ShellTargetKey;
	readonly hostCommands: ShellHostCommandPort;
	readonly workmux: ShellWorkmuxPort;
};

export type ShellTargetOwner = {
	activate(): void;
	getPublication(): ShellTargetPublication;
	update(input: ShellTargetOwnerSource): ShellTargetPublication;
	dispose(reason: 'reconnect' | 'unmount'): void;
};

export type ShellTargetOwnerSource = {
	key: ShellTargetKey;
	connection: RegisteredSshConnection | null;
};

function createWorkmuxInput(
	source: ShellTargetOwnerSource,
	diagnostics: ShellDiagnosticPort,
): ReturnType<typeof createShellSessionWorkmuxInput> {
	return createShellSessionWorkmuxInput({
		key: source.key,
		connection: source.connection,
		diagnostics,
	});
}

function createHostCommandPort({
	connection,
	generation,
	getGeneration,
	key,
}: ShellTargetOwnerSource & {
	generation: number;
	getGeneration(): number;
}): ShellHostCommandPort {
	const isCurrent = () => getGeneration() === generation;
	return {
		key,
		run: async (command, timeoutMs) => {
			if (!isCurrent()) return { status: 'superseded' };
			if (!connection) return { status: 'unavailable' };
			try {
				const result = await executeSideChannelCommand(
					connection,
					command,
					timeoutMs,
				);
				if (!isCurrent()) return { status: 'superseded' };
				if (!result.success) {
					return {
						status: 'failed',
						failure: { message: result.error || 'Host command failed.' },
						output: result.output,
					};
				}
				return {
					status: 'completed',
					output: result.output,
					...(result.issueUrl ? { issueUrl: result.issueUrl } : {}),
				};
			} catch (error) {
				return isCurrent()
					? {
							status: 'failed',
							failure: {
								message: error instanceof Error ? error.message : String(error),
							},
						}
					: { status: 'superseded' };
			}
		},
	};
}

export function createShellTargetOwner({
	diagnostics,
	source: initialSource,
}: {
	diagnostics: ShellDiagnosticPort;
	source: ShellTargetOwnerSource;
}): ShellTargetOwner {
	let generation = 0;
	let source = initialSource;
	let disposed = false;
	const workmuxOwner: ShellSessionWorkmuxOwner = createShellSessionWorkmuxOwner(
		createWorkmuxInput(initialSource, diagnostics),
		{ deferActivation: true },
	);
	let publication = createPublication();

	function createPublication(): ShellTargetPublication {
		return {
			generation,
			key: source.key,
			hostCommands: createHostCommandPort({
				...source,
				generation,
				getGeneration: () => generation,
			}),
			workmux: workmuxOwner.getPort(),
		};
	}

	return {
		activate: workmuxOwner.activate,
		getPublication: () => publication,
		update: (nextSource) => {
			if (
				disposed ||
				(source.key === nextSource.key &&
					source.connection === nextSource.connection)
			) {
				return publication;
			}
			source = nextSource;
			generation += 1;
			workmuxOwner.replace(createWorkmuxInput(source, diagnostics));
			publication = createPublication();
			return publication;
		},
		dispose: (reason) => {
			if (disposed) return;
			disposed = true;
			generation += 1;
			workmuxOwner.dispose(reason);
		},
	};
}
