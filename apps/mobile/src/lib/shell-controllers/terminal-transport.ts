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
}): ShellTerminalTransportController {
	type LeaseMetadata = {
		runtimeKey: TerminalRuntimeKey;
		writerGeneration: number;
	};
	type BatchEntry = {
		writer: OrderedWriter;
		lease: TerminalInputLease;
		segments: Uint8Array<ArrayBufferLike>[];
		interSegmentDelayMs?: number;
		callerIsCurrent?: () => boolean;
		abortController: AbortController;
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
	const pendingEntries: BatchEntry[] = [];
	const leaseMetadata = new WeakMap<TerminalInputLease, LeaseMetadata>();

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
		const metadata = leaseMetadata.get(lease);
		return (
			metadata !== undefined &&
			!disposed &&
			writer !== null &&
			runtimeKey !== null &&
			metadata.runtimeKey === runtimeKey &&
			metadata.writerGeneration === writerGeneration
		);
	};

	const isEntryCurrent = (entry: BatchEntry) => {
		if (!isLeaseCurrent(entry.lease)) return false;
		try {
			return entry.callerIsCurrent?.() !== false;
		} catch {
			return false;
		}
	};

	const releaseEntry = (entry: BatchEntry) => {
		entry.segments = [];
		entry.callerIsCurrent = undefined;
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

	const startNextEntry = () => {
		if (activeEntry !== null) return;
		let entry = pendingEntries.shift();
		while (entry !== undefined && !isEntryCurrent(entry)) {
			resolveEntry(entry);
			entry = pendingEntries.shift();
		}
		if (entry === undefined) return;

		activeEntry = entry;
		void (async () => {
			try {
				await entry.writer.sendBatch(entry.segments, {
					interSegmentDelayMs: entry.interSegmentDelayMs,
					isCurrent: () => isEntryCurrent(entry),
					signal: entry.abortController.signal,
				});
				resolveEntry(entry);
			} catch (error) {
				if (isEntryCurrent(entry)) reportFailure(error);
				rejectEntry(entry, error);
			} finally {
				activeEntry = null;
				startNextEntry();
			}
		})();
	};

	const staleQueuedEntries = () => {
		activeEntry?.abortController.abort();
		const staleEntries = pendingEntries.splice(0);
		for (const entry of staleEntries) resolveEntry(entry);
	};

	return {
		captureLease: () => {
			if (disposed || writer === null || runtimeKey === null) return null;
			const metadata = { runtimeKey, writerGeneration };
			const lease = Object.freeze({ ...metadata });
			leaseMetadata.set(lease, metadata);
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
					abortController: new AbortController(),
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
