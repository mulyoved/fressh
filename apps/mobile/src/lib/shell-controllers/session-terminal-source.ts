import {
	type ShellTerminalListenerRegistration,
	type ShellTerminalSourcePort,
} from './session-contracts';
import { type ShellTransportKey } from './source-keys';

export type ShellTerminalNativeSource = {
	bufferStats(): {
		ringBytesCount: bigint;
		usedBytes: bigint;
		headSeq: bigint;
		tailSeq: bigint;
		droppedBytesTotal: bigint;
		chunksCount: bigint;
	};
	currentSeq(): bigint;
	readBuffer(
		cursor: Parameters<ShellTerminalSourcePort['readBuffer']>[0],
	): ReturnType<ShellTerminalSourcePort['readBuffer']>;
	addListener(
		listener: Parameters<ShellTerminalSourcePort['addListener']>[0],
		options: Parameters<ShellTerminalSourcePort['addListener']>[1],
	): bigint | Promise<bigint>;
	removeListener(id: bigint): void;
	sendData(bytes: ArrayBuffer): Promise<void>;
	resizePty(cols: number, rows: number): Promise<void>;
};

export function createShellTerminalSourcePort({
	channelId,
	connectionId,
	generation,
	getCurrentGeneration,
	key,
	shell,
}: {
	channelId: number;
	connectionId: string;
	generation: number;
	getCurrentGeneration(): number;
	key: ShellTransportKey;
	shell: ShellTerminalNativeSource | undefined;
}): ShellTerminalSourcePort {
	const registrations = new WeakMap<
		ShellTerminalListenerRegistration,
		{ id: bigint; removed: boolean }
	>();
	const requireCurrent = () => {
		if (getCurrentGeneration() !== generation || shell === undefined) {
			throw new Error('Shell terminal source superseded.');
		}
		return shell;
	};
	return {
		key,
		generation,
		connectionId,
		channelId,
		isAvailable: () =>
			getCurrentGeneration() === generation && shell !== undefined,
		getNativeOutputDiagnostics: () => {
			if (getCurrentGeneration() !== generation || shell === undefined) {
				return null;
			}
			const stats = shell.bufferStats();
			return {
				currentSeq: shell.currentSeq().toString(),
				ringBytesCount: stats.ringBytesCount.toString(),
				usedBytes: stats.usedBytes.toString(),
				headSeq: stats.headSeq.toString(),
				tailSeq: stats.tailSeq.toString(),
				droppedBytesTotal: stats.droppedBytesTotal.toString(),
				chunksCount: stats.chunksCount.toString(),
			};
		},
		readBuffer: async (cursor) => {
			const owner = requireCurrent();
			const result = await owner.readBuffer(cursor);
			requireCurrent();
			return result;
		},
		addListener: async (listener, options) => {
			const owner = requireCurrent();
			const id = await owner.addListener(listener, options);
			if (getCurrentGeneration() !== generation) {
				owner.removeListener(id);
				throw new Error('Shell terminal source superseded.');
			}
			const registration = Object.freeze({ id });
			registrations.set(registration, { id, removed: false });
			return registration;
		},
		removeListener: (registration) => {
			const owned = registrations.get(registration);
			if (!owned || owned.removed || shell === undefined) return;
			owned.removed = true;
			shell.removeListener(owned.id);
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
}
