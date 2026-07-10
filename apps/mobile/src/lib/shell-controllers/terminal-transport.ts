import { OrderedWriter } from '../ordered-writer';
import { type ControllerInvalidationReason } from './controller-core';
import { type ShellTransportKey } from './source-keys';

export type TerminalRuntimeKey = string & {
	readonly __terminalRuntimeKey: true;
};

export type TerminalInputLease = {
	runtimeKey: TerminalRuntimeKey;
	writerGeneration: number;
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
	let transportKey: ShellTransportKey | null = null;
	let runtimeInstanceId: string | null = null;
	let runtimeKey: TerminalRuntimeKey | null = null;
	let send: ((bytes: Uint8Array<ArrayBufferLike>) => Promise<void>) | null =
		null;
	let writer: OrderedWriter | null = null;
	let writerGeneration = 0;
	let disposed = false;
	let batchTail: Promise<void> = Promise.resolve();

	const refreshRuntimeKey = () => {
		runtimeKey =
			transportKey !== null && runtimeInstanceId !== null
				? (JSON.stringify([
						transportKey,
						runtimeInstanceId,
					]) as TerminalRuntimeKey)
				: null;
	};

	const isLeaseCurrent = (lease: TerminalInputLease) =>
		!disposed &&
		writer !== null &&
		runtimeKey !== null &&
		lease.runtimeKey === runtimeKey &&
		lease.writerGeneration === writerGeneration;

	const enqueueBatch = (task: () => Promise<void>) => {
		const next = batchTail.then(task, task);
		batchTail = next.catch(() => {});
		return next;
	};

	return {
		captureLease: () =>
			!disposed && writer !== null && runtimeKey !== null
				? { runtimeKey, writerGeneration }
				: null,
		isLeaseCurrent,
		sendBatch: (lease, segments, options) => {
			const capturedWriter = writer;
			if (capturedWriter === null) return Promise.resolve();
			return enqueueBatch(async () => {
				try {
					await capturedWriter.sendBatch([...segments], {
						interSegmentDelayMs: options?.interSegmentDelayMs,
						isCurrent: () =>
							isLeaseCurrent(lease) && options?.isCurrent?.() !== false,
					});
				} catch (error) {
					if (isLeaseCurrent(lease)) {
						try {
							input.onSendFailure(error);
						} catch {
							// Feedback must not mask the original transport failure.
						}
					}
					throw error;
				}
			});
		},
		setShell: (nextTransportKey, nextSend) => {
			if (disposed) return;
			if (transportKey === nextTransportKey && send === nextSend) return;
			writerGeneration += 1;
			transportKey = nextTransportKey;
			send = nextSend;
			writer = new OrderedWriter(nextSend);
			refreshRuntimeKey();
		},
		clearShell: () => {
			if (disposed) return;
			writerGeneration += 1;
			transportKey = null;
			send = null;
			writer = null;
			refreshRuntimeKey();
		},
		setRuntimeInstance: (nextInstanceId) => {
			if (disposed) return;
			if (runtimeInstanceId === nextInstanceId) return;
			writerGeneration += 1;
			runtimeInstanceId = nextInstanceId;
			refreshRuntimeKey();
		},
		clearRuntime: () => {
			if (disposed) return;
			writerGeneration += 1;
			runtimeInstanceId = null;
			refreshRuntimeKey();
		},
		invalidate: () => {
			if (disposed) return;
			writerGeneration += 1;
		},
		dispose: () => {
			if (disposed) return;
			writerGeneration += 1;
			disposed = true;
			transportKey = null;
			runtimeInstanceId = null;
			runtimeKey = null;
			send = null;
			writer = null;
		},
	};
}
