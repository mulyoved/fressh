import {
	type ShellTerminalListenerRegistration,
	type ShellTerminalSourcePort,
} from './session-contracts';
import { type ShellTerminalNativeSource } from './session-terminal-source';
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
		const ownedShell = shell;
		const registrations = new WeakMap<
			ShellTerminalListenerRegistration,
			{ id: bigint; removed: boolean }
		>();
		const requireCurrent = (): ShellTerminalNativeSource => {
			if (
				disposed ||
				generation !== ownedGeneration ||
				ownedShell === undefined
			) {
				throw new Error('Shell terminal source superseded.');
			}
			return ownedShell;
		};
		const port: ShellTerminalSourcePort = {
			key,
			generation: ownedGeneration,
			connectionId,
			channelId,
			getNativeOutputDiagnostics: () => {
				if (
					disposed ||
					generation !== ownedGeneration ||
					ownedShell === undefined
				) {
					return null;
				}
				const stats = ownedShell.bufferStats();
				return {
					currentSeq: ownedShell.currentSeq().toString(),
					ringBytesCount: stats.ringBytesCount.toString(),
					usedBytes: stats.usedBytes.toString(),
					headSeq: stats.headSeq.toString(),
					tailSeq: stats.tailSeq.toString(),
					droppedBytesTotal: stats.droppedBytesTotal.toString(),
					chunksCount: stats.chunksCount.toString(),
				};
			},
			isAvailable: () =>
				!disposed && generation === ownedGeneration && ownedShell !== undefined,
			readBuffer: async (cursor) => {
				const owner = requireCurrent();
				const result = await owner.readBuffer(cursor);
				requireCurrent();
				return result;
			},
			addListener: async (listener, options) => {
				const owner = requireCurrent();
				const id = await owner.addListener(listener, options);
				if (disposed || generation !== ownedGeneration) {
					owner.removeListener(id);
					throw new Error('Shell terminal source superseded.');
				}
				const registration = Object.freeze({ id });
				registrations.set(registration, { id, removed: false });
				return registration;
			},
			removeListener: (registration) => {
				const owned = registrations.get(registration);
				if (!owned || owned.removed || ownedShell === undefined) return;
				owned.removed = true;
				ownedShell.removeListener(owned.id);
			},
			sendData: async (bytes) => {
				const owner = requireCurrent();
				const copied = new Uint8Array(bytes);
				await owner.sendData(copied.buffer as ArrayBuffer);
				requireCurrent();
			},
			resizePty: async (cols, rows) => {
				const owner = requireCurrent();
				await owner.resizePty(cols, rows);
				requireCurrent();
			},
		};
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
