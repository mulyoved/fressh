import { OrderedWriter } from '../ordered-writer';
import { type ControllerInvalidationReason } from './controller-core';
import { type ShellTransportKey } from './source-keys';

export type TerminalRuntimeKey = string & {
	readonly __terminalRuntimeKey: true;
};

export type TerminalInputLease = {
	readonly runtimeKey: TerminalRuntimeKey;
	readonly writerGeneration: number;
};

export type ShellTerminalTransportPort = {
	captureLease(): TerminalInputLease | null;
	isLeaseCurrent(lease: TerminalInputLease): boolean;
	sendBatch(
		lease: TerminalInputLease,
		segments: readonly Uint8Array<ArrayBufferLike>[],
		options?: { interSegmentDelayMs?: number; isCurrent?: () => boolean },
	): Promise<void>;
};

export type ShellTerminalTransportController = ShellTerminalTransportPort & {
	setShell(
		transportKey: ShellTransportKey,
		send: (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>,
	): void;
	clearShell(): void;
	setRuntimeInstance(instanceId: string): void;
	clearRuntime(): void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export function createShellTerminalTransport(input: {
	onSendFailure(error: unknown): void;
	createAbortController?(): AbortController;
}): ShellTerminalTransportController {
	type BatchEntry = {
		writer: OrderedWriter;
		lease: TerminalInputLease;
		segments: Uint8Array<ArrayBufferLike>[];
		interSegmentDelayMs?: number;
		callerIsCurrent?: () => boolean;
		abortController: AbortController | null;
		resolve(): void;
		reject(error: unknown): void;
		settled: boolean;
	};

	let transportKey: ShellTransportKey | null = null;
	let runtimeInstanceId: string | null = null;
	let runtimeKey: TerminalRuntimeKey | null = null;
	let send: ((bytes: Uint8Array<ArrayBufferLike>) => Promise<void>) | null =
		null;
	let writer: OrderedWriter | null = null;
	let writerGeneration = 0;
	let disposed = false;
	let activeEntry: BatchEntry | null = null;
	let pendingEntries: (BatchEntry | undefined)[] = [];
	let pendingHead = 0;
	const ownedLeases = new WeakSet<TerminalInputLease>();
	const createAbortController =
		input.createAbortController ?? (() => new AbortController());

	const refreshRuntimeKey = () => {
		runtimeKey =
			transportKey !== null && runtimeInstanceId !== null
				? (JSON.stringify([
						transportKey,
						runtimeInstanceId,
					]) as TerminalRuntimeKey)
				: null;
	};

	const isLeaseCurrent = (lease: TerminalInputLease) => {
		return (
			ownedLeases.has(lease) &&
			!disposed &&
			writer !== null &&
			runtimeKey !== null &&
			lease.runtimeKey === runtimeKey &&
			lease.writerGeneration === writerGeneration
		);
	};

	const isEntryCurrent = (entry: BatchEntry) => {
		try {
			if (entry.callerIsCurrent?.() === false) return false;
		} catch {
			return false;
		}
		return isLeaseCurrent(entry.lease);
	};

	const releaseEntry = (entry: BatchEntry) => {
		entry.segments = [];
		entry.callerIsCurrent = undefined;
		entry.abortController = null;
	};

	const resolveEntry = (entry: BatchEntry) => {
		if (entry.settled) return;
		entry.settled = true;
		releaseEntry(entry);
		entry.resolve();
	};

	const rejectEntry = (entry: BatchEntry, error: unknown) => {
		if (entry.settled) return;
		entry.settled = true;
		releaseEntry(entry);
		entry.reject(error);
	};

	const reportFailure = (error: unknown) => {
		try {
			void Promise.resolve(input.onSendFailure(error)).catch(() => {});
		} catch {
			// Feedback must not mask the original transport failure.
		}
	};

	const dequeuePendingEntry = () => {
		const entry = pendingEntries[pendingHead];
		if (entry === undefined) {
			pendingEntries = [];
			pendingHead = 0;
			return undefined;
		}
		pendingEntries[pendingHead] = undefined;
		pendingHead += 1;
		if (pendingHead === pendingEntries.length) {
			pendingEntries = [];
			pendingHead = 0;
		} else if (
			pendingHead >= 1_024 &&
			pendingHead * 2 >= pendingEntries.length
		) {
			pendingEntries = pendingEntries.slice(pendingHead);
			pendingHead = 0;
		}
		return entry;
	};

	const startNextEntry = () => {
		if (activeEntry !== null) return;
		while (activeEntry === null) {
			const entry = dequeuePendingEntry();
			if (entry === undefined) return;
			activeEntry = entry;
			if (!isEntryCurrent(entry)) {
				resolveEntry(entry);
				if (activeEntry === entry) activeEntry = null;
				continue;
			}

			void (async () => {
				let sendAttempted = false;
				try {
					if ((entry.interSegmentDelayMs ?? 0) > 0) {
						entry.abortController = createAbortController();
						if (
							entry.abortController.signal.aborted ||
							!isEntryCurrent(entry)
						) {
							entry.abortController.abort();
							resolveEntry(entry);
							return;
						}
					}
					sendAttempted = true;
					await entry.writer.sendBatch(entry.segments, {
						interSegmentDelayMs: entry.interSegmentDelayMs,
						isCurrent: () => isEntryCurrent(entry),
						signal: entry.abortController?.signal,
					});
					resolveEntry(entry);
				} catch (error) {
					if (sendAttempted && isEntryCurrent(entry)) {
						reportFailure(error);
					}
					rejectEntry(entry, error);
				} finally {
					if (activeEntry === entry) activeEntry = null;
					startNextEntry();
				}
			})();
			return;
		}
	};

	const staleQueuedEntries = () => {
		activeEntry?.abortController?.abort();
		const staleEntries = pendingEntries;
		const staleHead = pendingHead;
		pendingEntries = [];
		pendingHead = 0;
		for (let index = staleHead; index < staleEntries.length; index += 1) {
			const entry = staleEntries[index];
			if (entry !== undefined) resolveEntry(entry);
			staleEntries[index] = undefined;
		}
	};

	return {
		captureLease: () => {
			if (disposed || writer === null || runtimeKey === null) return null;
			const lease = Object.freeze({ runtimeKey, writerGeneration });
			ownedLeases.add(lease);
			return lease;
		},
		isLeaseCurrent,
		sendBatch: (lease, segments, options) => {
			const capturedWriter = writer;
			if (capturedWriter === null || !isLeaseCurrent(lease)) {
				return Promise.resolve();
			}
			const segmentSnapshot = segments.map(
				(segment) => new Uint8Array(segment),
			);
			return new Promise<void>((resolve, reject) => {
				pendingEntries.push({
					writer: capturedWriter,
					lease,
					segments: segmentSnapshot,
					interSegmentDelayMs: options?.interSegmentDelayMs,
					callerIsCurrent: options?.isCurrent,
					abortController: null,
					resolve,
					reject,
					settled: false,
				});
				startNextEntry();
			});
		},
		setShell: (nextTransportKey, nextSend) => {
			if (disposed) return;
			if (transportKey === nextTransportKey && send === nextSend) return;
			writerGeneration += 1;
			staleQueuedEntries();
			transportKey = nextTransportKey;
			send = nextSend;
			writer = new OrderedWriter(nextSend);
			refreshRuntimeKey();
		},
		clearShell: () => {
			if (disposed) return;
			writerGeneration += 1;
			staleQueuedEntries();
			transportKey = null;
			send = null;
			writer = null;
			refreshRuntimeKey();
		},
		setRuntimeInstance: (nextInstanceId) => {
			if (disposed) return;
			if (runtimeInstanceId === nextInstanceId) return;
			writerGeneration += 1;
			staleQueuedEntries();
			runtimeInstanceId = nextInstanceId;
			refreshRuntimeKey();
		},
		clearRuntime: () => {
			if (disposed) return;
			writerGeneration += 1;
			staleQueuedEntries();
			runtimeInstanceId = null;
			refreshRuntimeKey();
		},
		invalidate: () => {
			if (disposed) return;
			writerGeneration += 1;
			staleQueuedEntries();
		},
		dispose: () => {
			if (disposed) return;
			writerGeneration += 1;
			staleQueuedEntries();
			disposed = true;
			transportKey = null;
			runtimeInstanceId = null;
			runtimeKey = null;
			send = null;
			writer = null;
		},
	};
}
