import { type ShellTerminalSourcePort } from './session-contracts';
import {
	createShellTerminalSourcePort,
	type ShellTerminalNativeSource,
} from './session-terminal-source';
import { type ShellTransportKey } from './source-keys';

export type ShellTransportPublication = {
	readonly generation: number;
	readonly port: ShellTerminalSourcePort;
};

export type ShellTransportOwner = {
	getPublication(): ShellTransportPublication;
	update(
		shell: ShellTerminalNativeSource | undefined,
	): ShellTransportPublication;
	dispose(): void;
};

export function createShellTransportOwner({
	channelId,
	connectionId,
	key,
	shell: initialShell,
}: {
	channelId: number;
	connectionId: string;
	key: ShellTransportKey;
	shell: ShellTerminalNativeSource | undefined;
}): ShellTransportOwner {
	let generation = 0;
	let shell = initialShell;
	let disposed = false;
	let publication = createPublication();

	function createPublication(): ShellTransportPublication {
		const ownedGeneration = generation;
		const port = createShellTerminalSourcePort({
			key,
			generation: ownedGeneration,
			connectionId,
			channelId,
			getCurrentGeneration: () => generation,
			shell,
		});
		return { generation: ownedGeneration, port };
	}

	return {
		getPublication: () => publication,
		update: (nextShell) => {
			if (disposed || shell === nextShell) return publication;
			shell = nextShell;
			generation += 1;
			publication = createPublication();
			return publication;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation += 1;
		},
	};
}
