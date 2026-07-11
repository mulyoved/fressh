// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid loading the React Native package in Node core tests.
import type {
	BufferReadResult,
	Cursor,
	ListenerEvent,
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
// eslint-disable-next-line import/consistent-type-specifier-style -- A pure type import keeps the transport implementation out of core tests.
import type { TerminalRuntimeKey } from './terminal-transport';

type MaybePromise<T> = T | Promise<T>;

export type TerminalLifecycleShell = ShellListenerOwner & {
	readonly connectionId: string;
	readonly channelId: number;
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
	onRuntimeChanged(runtimeKey: TerminalRuntimeKey | null): void;
};

type Attachment = {
	id: bigint;
	owner: TerminalLifecycleShell;
	identity: string;
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
	let attachAttempt: { identity: string; promise: Promise<void> } | null = null;
	let firstAttachedIdentity: string | null = null;
	let generation = 0;
	let disposed = false;

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

	const detachOwned = (): void => {
		const owned = attachment;
		attachment = null;
		if (owned) removeAttachment(owned);
	};

	const detach = (): void => {
		if (disposed) return;
		generation += 1;
		detachOwned();
	};

	const currentIdentity = (): string | null => {
		if (!shell || !transportKey || !runtimeKey) return null;
		return JSON.stringify([transportKey, runtimeKey]);
	};

	const isAttemptCurrent = (
		attemptGeneration: number,
		attemptShell: TerminalLifecycleShell,
		identity: string,
	): boolean => {
		return (
			!disposed &&
			generation === attemptGeneration &&
			shell === attemptShell &&
			currentIdentity() === identity &&
			publisher.getSnapshot().ready
		);
	};

	const attach = (): Promise<void> => {
		if (disposed || !publisher.getSnapshot().ready) return Promise.resolve();
		const attemptShell = shell;
		const xterm = getXterm();
		const identity = currentIdentity();
		if (!attemptShell || !xterm || !identity) return Promise.resolve();
		if (
			attachment?.identity === identity &&
			attachment.owner === attemptShell
		) {
			return Promise.resolve();
		}
		if (attachAttempt?.identity === identity) return attachAttempt.promise;

		generation += 1;
		const attemptGeneration = generation;
		detachOwned();
		const useHead = firstAttachedIdentity !== identity;

		const promise = (async (): Promise<void> => {
			xterm.setSystemKeyboardEnabled(viewModes.systemKeyboardEnabled);
			if (!isAttemptCurrent(attemptGeneration, attemptShell, identity)) return;
			xterm.setSelectionModeEnabled(viewModes.selectionModeEnabled);
			if (!isAttemptCurrent(attemptGeneration, attemptShell, identity)) return;

			let cursor: Cursor = { mode: 'live' };
			if (useHead) {
				const result = await attemptShell.readBuffer({ mode: 'head' });
				if (!isAttemptCurrent(attemptGeneration, attemptShell, identity))
					return;
				safeInfo('readBuffer(head)', {
					chunks: result.chunks.length,
					nextSeq: result.nextSeq,
					dropped: result.dropped,
				});
				if (result.chunks.length > 0) {
					xterm.writeMany(
						result.chunks.map((chunk) => new Uint8Array(chunk.bytes)),
					);
					if (!isAttemptCurrent(attemptGeneration, attemptShell, identity))
						return;
					xterm.flush();
					if (!isAttemptCurrent(attemptGeneration, attemptShell, identity))
						return;
				}
				cursor = { mode: 'seq', seq: result.nextSeq };
			}

			const listener = (event: ListenerEvent): void => {
				if (!isAttemptCurrent(attemptGeneration, attemptShell, identity))
					return;
				if ('kind' in event) {
					safeWarn('listener.dropped', event);
					return;
				}
				try {
					getXterm()?.write(new Uint8Array(event.bytes));
				} catch (error) {
					safeWarn('Failed to write shell output', error);
				}
			};
			const id = await attemptShell.addListener(listener, { cursor });
			if (!isAttemptCurrent(attemptGeneration, attemptShell, identity)) {
				removeAttachment({ id, owner: attemptShell, identity });
				return;
			}

			attachment = { id, owner: attemptShell, identity };
			if (useHead) firstAttachedIdentity = identity;
			safeInfo(
				useHead ? 'shell listener attached' : 'shell listener attached (live)',
				id.toString(),
			);
			if (platformOS === 'ios') {
				try {
					xterm.focus();
				} catch (error) {
					safeWarn('Failed to focus terminal', error);
				}
			}
		})();

		attachAttempt = { identity, promise };
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

	const invalidateRuntime = (reason: ControllerInvalidationReason): void => {
		generation += 1;
		transport.clearRuntime();
		size.invalidate(reason);
		runtimeInstanceId = null;
		runtimeKey = null;
		detachOwned();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setShell: (nextTransportKey, nextShell) => {
			if (disposed) return;
			const normalizedShell = nextShell ?? null;
			if (transportKey === nextTransportKey && shell === normalizedShell)
				return;
			generation += 1;
			detachOwned();
			transportKey = nextTransportKey;
			shell = normalizedShell;
			if (runtimeInstanceId && nextTransportKey) {
				runtimeKey = createRuntimeKey(nextTransportKey, runtimeInstanceId);
			} else {
				runtimeKey = null;
			}
			const snapshot = publisher.getSnapshot();
			publish({ ...snapshot, runtimeKey });
		},
		setViewModes: (nextViewModes) => {
			if (disposed) return;
			viewModes = { ...nextViewModes };
		},
		handleInitialized: (instanceId) => {
			if (disposed) return;
			generation += 1;
			detachOwned();
			firstAttachedIdentity = null;
			runtimeInstanceId = instanceId;
			transport.setRuntimeInstance(instanceId);
			runtimeKey = transportKey
				? createRuntimeKey(transportKey, instanceId)
				: null;
			let publicationError: unknown;
			try {
				publish({ ready: true, hasRendered: true, runtimeKey });
			} catch (error) {
				publicationError = error;
			}
			if (runtimeInstanceId === instanceId && runtimeKey !== null) {
				try {
					onRuntimeChanged(runtimeKey);
				} catch (error) {
					publicationError ??= error;
				}
			}
			if (publicationError !== undefined) throw publicationError;
		},
		handleLoadStart: () => {
			if (disposed) return;
			invalidateRuntime('runtime-reset');
			publish({
				ready: false,
				hasRendered: publisher.getSnapshot().hasRendered,
				runtimeKey: null,
			});
		},
		attach,
		detach,
		getRuntimeKey: () => runtimeKey,
		getRuntimeInstanceId: () => runtimeInstanceId,
		isCurrentInstance: (instanceId) => runtimeInstanceId === instanceId,
		isAttached: () => attachment !== null,
		invalidate: (reason) => {
			if (disposed) return;
			invalidateRuntime(reason);
			publish({
				ready: false,
				hasRendered: publisher.getSnapshot().hasRendered,
				runtimeKey: null,
			});
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation += 1;
			transport.clearRuntime();
			size.invalidate('unmount');
			runtimeInstanceId = null;
			runtimeKey = null;
			detachOwned();
			publisher.disposePublisher();
		},
	};
}
