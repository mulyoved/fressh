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
	type PendingListenerRemoval = {
		owner: ShellTerminalNativeSource;
		id: bigint;
		attempts: number;
		retryScheduled: boolean;
		complete?: () => void;
	};
	const pendingListenerRemovals = new Map<bigint, PendingListenerRemoval>();
	const completeListenerRemoval = (pending: PendingListenerRemoval) => {
		if (pendingListenerRemovals.get(pending.id) !== pending) return;
		pendingListenerRemovals.delete(pending.id);
		pending.complete?.();
	};
	const scheduleFinalListenerRemoval = (pending: PendingListenerRemoval) => {
		if (pending.retryScheduled) return;
		pending.retryScheduled = true;
		queueMicrotask(() => {
			if (pendingListenerRemovals.get(pending.id) !== pending) return;
			try {
				pending.attempts += 1;
				pending.owner.removeListener(pending.id);
			} catch {
				// Native retirement is best-effort after the bounded final attempt.
			} finally {
				completeListenerRemoval(pending);
			}
		});
	};
	const retryPendingListenerRemovals = () => {
		for (const pending of pendingListenerRemovals.values()) {
			if (pending.attempts >= 2) {
				scheduleFinalListenerRemoval(pending);
				continue;
			}
			try {
				pending.attempts += 1;
				pending.owner.removeListener(pending.id);
				completeListenerRemoval(pending);
			} catch {
				scheduleFinalListenerRemoval(pending);
			}
		}
	};
	const retireListener = (
		owner: ShellTerminalNativeSource,
		id: bigint,
		complete?: () => void,
	) => {
		const pending = {
			owner,
			id,
			attempts: 1,
			retryScheduled: false,
			complete,
		} satisfies PendingListenerRemoval;
		pendingListenerRemovals.set(id, pending);
		owner.removeListener(id);
		completeListenerRemoval(pending);
	};
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
			retryPendingListenerRemovals();
			const id = await owner.addListener(listener, options);
			if (getCurrentGeneration() !== generation) {
				try {
					retireListener(owner, id);
				} catch {
					retryPendingListenerRemovals();
				}
				throw new Error('Shell terminal source superseded.');
			}
			const registration = Object.freeze({ id });
			registrations.set(registration, { id, removed: false });
			return registration;
		},
		removeListener: (registration) => {
			const owned = registrations.get(registration);
			if (!owned || owned.removed || shell === undefined) return;
			const wasPending = pendingListenerRemovals.has(owned.id);
			retryPendingListenerRemovals();
			if (owned.removed || wasPending) return;
			try {
				retireListener(shell, owned.id, () => {
					owned.removed = true;
				});
			} catch (error) {
				retryPendingListenerRemovals();
				if (!owned.removed) throw error;
			}
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
