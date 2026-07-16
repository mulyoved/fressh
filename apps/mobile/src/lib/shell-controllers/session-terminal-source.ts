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
		{
			id: bigint;
			owner: ShellTerminalNativeSource;
			state: { active: boolean };
			removed: boolean;
		}
	>();
	type PendingListenerRemoval = {
		owner: ShellTerminalNativeSource;
		id: bigint;
		registration?: ShellTerminalListenerRegistration;
		attempts: number;
		retryScheduled: boolean;
		complete?: () => void;
	};
	const pendingListenerRemovals = new Set<PendingListenerRemoval>();
	const completeListenerRemoval = (pending: PendingListenerRemoval) => {
		if (!pendingListenerRemovals.delete(pending)) return;
		pending.complete?.();
	};
	const abandonListenerRemoval = (pending: PendingListenerRemoval) => {
		pendingListenerRemovals.delete(pending);
	};
	const scheduleFinalListenerRemoval = (pending: PendingListenerRemoval) => {
		if (pending.retryScheduled) return;
		pending.retryScheduled = true;
		queueMicrotask(() => {
			if (!pendingListenerRemovals.has(pending)) return;
			try {
				pending.attempts += 1;
				pending.owner.removeListener(pending.id);
				completeListenerRemoval(pending);
			} catch {
				// Stop automatic work after the bounded final attempt. A public
				// registration remains explicitly removable by its owner.
				abandonListenerRemoval(pending);
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
		registration?: ShellTerminalListenerRegistration,
	) => {
		const pending = {
			owner,
			id,
			...(registration ? { registration } : {}),
			attempts: 1,
			retryScheduled: false,
			complete,
		} satisfies PendingListenerRemoval;
		pendingListenerRemovals.add(pending);
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
			const state = { active: true };
			const id = await owner.addListener((event) => {
				if (!state.active) return;
				if (getCurrentGeneration() !== generation) {
					state.active = false;
					return;
				}
				listener(event);
			}, options);
			if (getCurrentGeneration() !== generation) {
				state.active = false;
				try {
					retireListener(owner, id);
				} catch {
					retryPendingListenerRemovals();
				}
				throw new Error('Shell terminal source superseded.');
			}
			const registration = Object.freeze(
				{},
			) as ShellTerminalListenerRegistration;
			registrations.set(registration, {
				id,
				owner,
				state,
				removed: false,
			});
			return registration;
		},
		removeListener: (registration) => {
			const owned = registrations.get(registration);
			if (!owned || owned.removed) return;
			owned.state.active = false;
			const wasPending = [...pendingListenerRemovals].some(
				(pending) => pending.registration === registration,
			);
			retryPendingListenerRemovals();
			if (owned.removed || wasPending) return;
			try {
				retireListener(
					owned.owner,
					owned.id,
					() => {
						owned.removed = true;
					},
					registration,
				);
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
