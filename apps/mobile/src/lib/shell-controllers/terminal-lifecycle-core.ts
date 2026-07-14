// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid loading the React Native package in Node core tests.
import type {
	BufferReadResult,
	Cursor,
	ListenerEvent,
	SshShell,
} from '@fressh/react-native-uniffi-russh';
// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid loading the React Native WebView package in Node core tests.
import type { XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import { type ShellListenerOwner } from '../terminal-shell-listener';
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
} from './controller-core';
// eslint-disable-next-line import/consistent-type-specifier-style -- A pure type import must not become a runtime dependency in Node tests.
import type { ShellTransportKey } from './source-keys';
import { type TerminalOutputDiagnosticSnapshot } from './terminal-output-diagnostics';
// eslint-disable-next-line import/consistent-type-specifier-style -- A pure type import keeps the transport implementation out of core tests.
import type { TerminalRuntimeKey } from './terminal-transport';

type MaybePromise<T> = T | Promise<T>;

export type TerminalLifecycleShell = ShellListenerOwner & {
	readonly connectionId: string;
	readonly channelId: number;
	bufferStats(): ReturnType<SshShell['bufferStats']>;
	currentSeq(): ReturnType<SshShell['currentSeq']>;
	readBuffer(cursor: Cursor): MaybePromise<BufferReadResult>;
	addListener(
		listener: (event: ListenerEvent) => void,
		options: { cursor: Cursor },
	): MaybePromise<bigint>;
};

export type TerminalLifecycleState = {
	ready: boolean;
	hasRendered: boolean;
	runtimeKey: TerminalRuntimeKey | null;
};

export type TerminalLifecycleController =
	ControllerCore<TerminalLifecycleState> & {
		setShell(
			transportKey: ShellTransportKey | null,
			shell: TerminalLifecycleShell | null | undefined,
		): void;
		setViewModes(modes: {
			systemKeyboardEnabled: boolean;
			selectionModeEnabled: boolean;
		}): void;
		handleInitialized(instanceId: string): void;
		handleLoadStart(): void;
		attach(): Promise<void>;
		detach(): void;
		getRuntimeKey(): TerminalRuntimeKey | null;
		getRuntimeInstanceId(): string | null;
		getOutputDiagnostics(): TerminalOutputDiagnosticSnapshot | null;
		isCurrentInstance(instanceId: string): boolean;
		isAttached(): boolean;
	};

export type TerminalLifecycleLogger = {
	info(message: string, details?: unknown): void;
	warn(message: string, error: unknown): void;
};

type LifecycleTransport = {
	setRuntimeInstance(instanceId: string): void;
	clearRuntime(): void;
	invalidate(reason: ControllerInvalidationReason): void;
};

type LifecycleSize = {
	invalidate(reason: ControllerInvalidationReason): void;
};

type LifecycleXterm = Pick<
	XtermWebViewHandle,
	| 'write'
	| 'writeMany'
	| 'flush'
	| 'getOutputDiagnostics'
	| 'focus'
	| 'setSystemKeyboardEnabled'
	| 'setSelectionModeEnabled'
>;

export type CreateTerminalLifecycleControllerInput = {
	getXterm(): LifecycleXterm | null;
	transport: LifecycleTransport;
	size: LifecycleSize;
	platformOS: string;
	logger: TerminalLifecycleLogger;
	onRuntimeChanged(
		runtimeKey: TerminalRuntimeKey | null,
		instanceId: string | null,
	): void;
};

type Attachment = {
	id: bigint;
	owner: TerminalLifecycleShell;
	runtimeRevision: number;
};

function createRuntimeKey(
	transportKey: ShellTransportKey,
	instanceId: string,
): TerminalRuntimeKey {
	return JSON.stringify([transportKey, instanceId]) as TerminalRuntimeKey;
}

export function createTerminalLifecycleController({
	getXterm,
	transport,
	size,
	platformOS,
	logger,
	onRuntimeChanged,
}: CreateTerminalLifecycleControllerInput): TerminalLifecycleController {
	const publisher = createControllerPublisher<TerminalLifecycleState>({
		ready: false,
		hasRendered: false,
		runtimeKey: null,
	});
	let shell: TerminalLifecycleShell | null = null;
	let transportKey: ShellTransportKey | null = null;
	let runtimeInstanceId: string | null = null;
	let runtimeKey: TerminalRuntimeKey | null = null;
	let viewModes = {
		systemKeyboardEnabled: platformOS === 'android',
		selectionModeEnabled: false,
	};
	let attachment: Attachment | null = null;
	let attachAttempt: {
		owner: TerminalLifecycleShell;
		generation: number;
		runtimeRevision: number;
		xterm: LifecycleXterm;
		promise: Promise<void>;
	} | null = null;
	let firstAttachedRevision: number | null = null;
	let runtimeRevision = 0;
	let generation = 0;
	let disposed = false;
	let hasNotifiedRuntime = false;
	let lastNotifiedRuntimeKey: TerminalRuntimeKey | null = null;
	let lastNotifiedInstanceId: string | null = null;
	let listenerProgress = {
		events: 0,
		bytes: 0,
		lastSeq: null as string | null,
		droppedEvents: 0,
	};

	const advanceRuntimeRevision = (): void => {
		runtimeRevision += 1;
		listenerProgress = {
			events: 0,
			bytes: 0,
			lastSeq: null,
			droppedEvents: 0,
		};
	};

	const safeInfo = (message: string, details?: unknown): void => {
		try {
			logger.info(message, details);
		} catch {
			// Diagnostics cannot change listener ownership.
		}
	};

	const safeWarn = (message: string, error: unknown): void => {
		try {
			logger.warn(message, error);
		} catch {
			// Native callbacks must never receive logger failures.
		}
	};

	const removeAttachment = (owned: Attachment): void => {
		try {
			owned.owner.removeListener(owned.id);
		} catch (error) {
			safeWarn('Failed to remove prior shell listener', error);
		}
	};

	const takeAttachment = (): Attachment | null => {
		const owned = attachment;
		attachment = null;
		return owned;
	};

	const detachOwned = (): void => {
		const owned = takeAttachment();
		if (owned) removeAttachment(owned);
	};

	const detach = (): void => {
		if (disposed) return;
		generation += 1;
		detachOwned();
	};

	const isCurrentXterm = (xterm: LifecycleXterm): boolean => {
		try {
			return getXterm() === xterm;
		} catch {
			return false;
		}
	};

	const isRuntimeCurrent = (
		attemptGeneration: number,
		attemptShell: TerminalLifecycleShell,
		attemptRuntimeRevision: number,
	): boolean =>
		!disposed &&
		generation === attemptGeneration &&
		shell === attemptShell &&
		runtimeRevision === attemptRuntimeRevision &&
		publisher.getSnapshot().ready;

	const isAttemptCurrent = (
		attemptGeneration: number,
		attemptShell: TerminalLifecycleShell,
		attemptRuntimeRevision: number,
		attemptXterm: LifecycleXterm,
	): boolean =>
		isRuntimeCurrent(
			attemptGeneration,
			attemptShell,
			attemptRuntimeRevision,
		) && isCurrentXterm(attemptXterm);

	const attach = (): Promise<void> => {
		if (disposed || !publisher.getSnapshot().ready) return Promise.resolve();
		const attemptShell = shell;
		const xterm = getXterm();
		if (!attemptShell || !xterm || !transportKey || !runtimeKey)
			return Promise.resolve();
		const attemptRuntimeRevision = runtimeRevision;
		if (
			attachment?.runtimeRevision === attemptRuntimeRevision &&
			attachment.owner === attemptShell
		) {
			return Promise.resolve();
		}
		if (
			attachAttempt?.owner === attemptShell &&
			attachAttempt.generation === generation &&
			attachAttempt.runtimeRevision === attemptRuntimeRevision &&
			attachAttempt.xterm === xterm
		) {
			return attachAttempt.promise;
		}

		generation += 1;
		const attemptGeneration = generation;
		detachOwned();
		if (generation !== attemptGeneration) return Promise.resolve();
		const useHead = firstAttachedRevision !== attemptRuntimeRevision;
		const isCurrent = (): boolean =>
			isAttemptCurrent(
				attemptGeneration,
				attemptShell,
				attemptRuntimeRevision,
				xterm,
			);

		const promise = (async (): Promise<void> => {
			xterm.setSystemKeyboardEnabled(viewModes.systemKeyboardEnabled);
			if (!isCurrent()) return;
			xterm.setSelectionModeEnabled(viewModes.selectionModeEnabled);
			if (!isCurrent()) return;

			let cursor: Cursor = { mode: 'live' };
			if (useHead) {
				const result = await attemptShell.readBuffer({ mode: 'head' });
				if (!isCurrent()) return;
				safeInfo('readBuffer(head)', {
					chunks: result.chunks.length,
					nextSeq: result.nextSeq.toString(),
					dropped: result.dropped
						? {
								fromSeq: result.dropped.fromSeq.toString(),
								toSeq: result.dropped.toSeq.toString(),
							}
						: undefined,
				});
				if (!isCurrent()) return;
				if (result.chunks.length > 0) {
					xterm.writeMany(
						result.chunks.map((chunk) => new Uint8Array(chunk.bytes)),
					);
					if (!isCurrent()) return;
					xterm.flush();
					if (!isCurrent()) return;
				}
				cursor = { mode: 'seq', seq: result.nextSeq };
			}

			let listenerCommitted = false;
			const listener = (event: ListenerEvent): void => {
				let currentXterm: LifecycleXterm | null;
				if (!listenerCommitted) {
					if (!isCurrent()) return;
					currentXterm = xterm;
				} else {
					if (
						!isRuntimeCurrent(
							attemptGeneration,
							attemptShell,
							attemptRuntimeRevision,
						)
					)
						return;
					try {
						currentXterm = getXterm();
					} catch {
						return;
					}
				}
				if (!currentXterm) return;
				if ('kind' in event) {
					listenerProgress.droppedEvents += 1;
					safeWarn('listener.dropped', {
						kind: event.kind,
						fromSeq: event.fromSeq.toString(),
						toSeq: event.toSeq.toString(),
					});
					return;
				}
				listenerProgress.events += 1;
				listenerProgress.bytes += event.bytes.byteLength;
				listenerProgress.lastSeq = event.seq.toString();
				try {
					currentXterm.write(new Uint8Array(event.bytes));
				} catch (error) {
					safeWarn('Failed to write shell output', error);
				}
			};
			const id = await attemptShell.addListener(listener, { cursor });
			if (!isCurrent()) {
				removeAttachment({
					id,
					owner: attemptShell,
					runtimeRevision: attemptRuntimeRevision,
				});
				return;
			}

			attachment = {
				id,
				owner: attemptShell,
				runtimeRevision: attemptRuntimeRevision,
			};
			listenerCommitted = true;
			if (useHead) firstAttachedRevision = attemptRuntimeRevision;
			safeInfo(
				useHead ? 'shell listener attached' : 'shell listener attached (live)',
				id.toString(),
			);
			if (!isCurrent()) return;
			if (platformOS === 'ios') {
				try {
					xterm.focus();
				} catch (error) {
					safeWarn('Failed to focus terminal', error);
				}
			}
		})();

		attachAttempt = {
			owner: attemptShell,
			generation: attemptGeneration,
			runtimeRevision: attemptRuntimeRevision,
			xterm,
			promise,
		};
		void promise.then(
			() => {
				if (attachAttempt?.promise === promise) attachAttempt = null;
			},
			() => {
				if (attachAttempt?.promise === promise) attachAttempt = null;
			},
		);
		return promise;
	};

	const publish = (next: TerminalLifecycleState): void => {
		publisher.publish(next);
	};

	type CapturedError = { present: boolean; value: unknown };
	const capture = (captured: CapturedError, task: () => void): void => {
		try {
			task();
		} catch (error) {
			if (!captured.present) {
				captured.present = true;
				captured.value = error;
			}
		}
	};

	const notifyRuntime = (captured: CapturedError, force: boolean): void => {
		if (
			!force &&
			hasNotifiedRuntime &&
			lastNotifiedRuntimeKey === runtimeKey &&
			lastNotifiedInstanceId === runtimeInstanceId
		)
			return;
		const notifiedRuntimeKey = runtimeKey;
		const notifiedInstanceId = runtimeInstanceId;
		hasNotifiedRuntime = true;
		lastNotifiedRuntimeKey = notifiedRuntimeKey;
		lastNotifiedInstanceId = notifiedInstanceId;
		capture(captured, () =>
			onRuntimeChanged(notifiedRuntimeKey, notifiedInstanceId),
		);
	};

	const invalidateRuntime = (reason: ControllerInvalidationReason): void => {
		const operationGeneration = ++generation;
		advanceRuntimeRevision();
		runtimeInstanceId = null;
		runtimeKey = null;
		const oldAttachment = takeAttachment();
		const captured: CapturedError = { present: false, value: undefined };
		if (generation === operationGeneration) {
			capture(captured, transport.clearRuntime);
		}
		if (oldAttachment) removeAttachment(oldAttachment);
		if (generation === operationGeneration) {
			capture(captured, () =>
				publish({
					ready: false,
					hasRendered: publisher.getSnapshot().hasRendered,
					runtimeKey: null,
				}),
			);
		}
		if (generation === operationGeneration) notifyRuntime(captured, false);
		if (generation === operationGeneration) {
			capture(captured, () => size.invalidate(reason));
		}
		if (captured.present) throw captured.value;
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setShell: (nextTransportKey, nextShell) => {
			if (disposed) return;
			const normalizedShell = nextShell ?? null;
			if (transportKey === nextTransportKey && shell === normalizedShell)
				return;
			const operationGeneration = ++generation;
			const transportChanged = transportKey !== nextTransportKey;
			transportKey = nextTransportKey;
			shell = normalizedShell;
			if (transportChanged) advanceRuntimeRevision();
			if (runtimeInstanceId && nextTransportKey) {
				runtimeKey = createRuntimeKey(nextTransportKey, runtimeInstanceId);
			} else {
				runtimeKey = null;
			}
			detachOwned();
			if (generation !== operationGeneration) return;
			const snapshot = publisher.getSnapshot();
			const captured: CapturedError = { present: false, value: undefined };
			capture(captured, () => publish({ ...snapshot, runtimeKey }));
			if (generation === operationGeneration && runtimeInstanceId !== null) {
				notifyRuntime(captured, false);
			}
			if (captured.present) throw captured.value;
		},
		setViewModes: (nextViewModes) => {
			if (disposed) return;
			viewModes = { ...nextViewModes };
		},
		handleInitialized: (instanceId) => {
			if (disposed) return;
			const operationGeneration = ++generation;
			advanceRuntimeRevision();
			firstAttachedRevision = null;
			runtimeInstanceId = instanceId;
			runtimeKey = transportKey
				? createRuntimeKey(transportKey, instanceId)
				: null;
			detachOwned();
			const captured: CapturedError = { present: false, value: undefined };
			if (generation === operationGeneration) {
				capture(captured, () => transport.setRuntimeInstance(instanceId));
			}
			if (generation === operationGeneration) {
				capture(captured, () =>
					publish({ ready: true, hasRendered: true, runtimeKey }),
				);
			}
			if (generation === operationGeneration) notifyRuntime(captured, true);
			if (captured.present) throw captured.value;
		},
		handleLoadStart: () => {
			if (disposed) return;
			invalidateRuntime('runtime-reset');
		},
		attach,
		detach,
		getRuntimeKey: () => runtimeKey,
		getRuntimeInstanceId: () => runtimeInstanceId,
		getOutputDiagnostics: () => {
			const currentShell = shell;
			if (!currentShell) return null;
			const native = currentShell.bufferStats();
			const xterm = getXterm()?.getOutputDiagnostics() ?? null;
			return {
				connectionId: currentShell.connectionId,
				channelId: currentShell.channelId,
				runtimeInstanceId,
				native: {
					currentSeq: currentShell.currentSeq().toString(),
					ringBytesCount: native.ringBytesCount.toString(),
					usedBytes: native.usedBytes.toString(),
					headSeq: native.headSeq.toString(),
					tailSeq: native.tailSeq.toString(),
					droppedBytesTotal: native.droppedBytesTotal.toString(),
					chunksCount: native.chunksCount.toString(),
				},
				listener: { ...listenerProgress },
				xterm: xterm === null ? null : { ...xterm },
			};
		},
		isCurrentInstance: (instanceId) => runtimeInstanceId === instanceId,
		isAttached: () => attachment !== null,
		invalidate: (reason) => {
			if (disposed) return;
			invalidateRuntime(reason);
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation += 1;
			advanceRuntimeRevision();
			runtimeInstanceId = null;
			runtimeKey = null;
			const oldAttachment = takeAttachment();
			const captured: CapturedError = { present: false, value: undefined };
			capture(captured, transport.clearRuntime);
			if (oldAttachment) removeAttachment(oldAttachment);
			capture(captured, () =>
				publish({
					ready: false,
					hasRendered: publisher.getSnapshot().hasRendered,
					runtimeKey: null,
				}),
			);
			notifyRuntime(captured, false);
			capture(captured, () => size.invalidate('unmount'));
			capture(captured, publisher.disposePublisher);
			if (captured.present) throw captured.value;
		},
	};
}
