import { type ScrollTraceSink } from '../scroll-trace';
import { resetTmuxScrollbackRuntimeState } from '../tmux-scrollback';
import { resetTmuxScrollbackLocalExitRequests } from '../tmux-scrollback-local-exit';
import { type WorkmuxControlChannel } from '../workmux-control-channel';
import {
	clearTmuxScrollbackLineAccumulator,
	createTmuxScrollbackLineAccumulator,
	type TmuxScrollbackLineAccumulator,
} from '../workmux-scrollback-batch';
import {
	createWorkmuxScrollbackCommandExecutor,
	type WorkmuxScrollbackCommandExecutor,
} from '../workmux-scrollback-executor';
import {
	createWorkmuxScrollbackLiveInputCleanupBarrier,
	type WorkmuxScrollbackLiveInputCleanupBarrier,
} from '../workmux-scrollback-live-input';
import { type ShellActivitySnapshot } from './activity-core';
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
	type ControllerOutcome,
} from './controller-core';
import { type ShellTargetKey } from './source-keys';
// eslint-disable-next-line import/consistent-type-specifier-style -- Keep this plain-TypeScript core free from React Native module evaluation.
import type { ShellTerminalViewPort } from './terminal';
import { type ShellTerminalTransportPort } from './terminal-transport';

export type ShellScrollbackState = {
	active: boolean;
	phase: 'dragging' | 'active';
	runtimeInstanceId: string | null;
};

export type ScrollbackModeChangeEvent = {
	active: boolean;
	phase: 'dragging' | 'active';
	instanceId: string;
	requestId?: number;
};

export type ScrollbackEnterRequestedEvent = {
	instanceId: string;
	requestId: number;
};

export type ScrollbackBatchEvent = {
	direction: 'up' | 'down';
	pages: number;
	lines: number;
	pageStep: number;
	instanceId: string;
	seq?: number;
	ts?: number;
};

export type ShellLiveInputOptions = {
	interSegmentDelayMs?: number;
	onAccepted?: () => void;
};

export type ShellScrollbackInputPort = {
	sendSegments(
		segments: readonly Uint8Array<ArrayBuffer>[],
		options?: ShellLiveInputOptions,
	): Promise<ControllerOutcome<{ message: string }>>;
};

export type ShellScrollbackFeedback = {
	alert(
		title: string,
		message: string,
		buttons?: { text: string; onPress?: () => void }[],
	): void;
	copyMessage(message: string): void;
};

export type ShellScrollbackLogger = {
	warn(message: string, error?: unknown): void;
};

export type ShellScrollbackContext = {
	targetKey: ShellTargetKey;
	targetName: string;
	connectionAvailable: boolean;
	shellAvailable: boolean;
	tmuxEnabled: boolean;
	getActivitySnapshot(): ShellActivitySnapshot;
	getSelectionModeEnabled(): boolean;
	terminalTransport: ShellTerminalTransportPort;
	terminalView: ShellTerminalViewPort;
	workmuxScroll: WorkmuxControlChannel['scroll'];
	trace: ScrollTraceSink;
	feedback: ShellScrollbackFeedback;
	logger: ShellScrollbackLogger;
};

export type ShellScrollbackControllerCore =
	ControllerCore<ShellScrollbackState> & {
		setContext(context: ShellScrollbackContext): void;
		onTerminalRuntimeChanged(instanceId: string | null): void;
		onScrollbackModeChange(event: ScrollbackModeChangeEvent): void;
		onScrollbackEnterRequested(
			event: ScrollbackEnterRequestedEvent,
		): Promise<void>;
		onScrollbackBatch(event: ScrollbackBatchEvent): void;
		sendSegments(
			segments: readonly Uint8Array<ArrayBuffer>[],
			options?: ShellLiveInputOptions,
		): Promise<ControllerOutcome<{ message: string }>>;
		clear(options?: {
			failurePolicy?: 'notify' | 'suppress';
		}): Promise<boolean> | null;
		jumpToLive(): void;
	};

type CreateExecutorInput = Parameters<
	typeof createWorkmuxScrollbackCommandExecutor
>[0];

export type CreateShellScrollbackControllerCoreInput = {
	createExecutor?(input: CreateExecutorInput): WorkmuxScrollbackCommandExecutor;
	lineAccumulator?: TmuxScrollbackLineAccumulator;
	cleanupBarrier?: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActive?: { current: boolean };
	remoteCopyModeGeneration?: { current: number };
	localExitRequestIds?: Set<number>;
};

const initialState: ShellScrollbackState = {
	active: false,
	phase: 'active',
	runtimeInstanceId: null,
};

export function createShellScrollbackControllerCore(
	input: CreateShellScrollbackControllerCoreInput = {},
): ShellScrollbackControllerCore {
	const publisher = createControllerPublisher(initialState);
	const createExecutor =
		input.createExecutor ?? createWorkmuxScrollbackCommandExecutor;
	const lineAccumulator =
		input.lineAccumulator ?? createTmuxScrollbackLineAccumulator();
	const cleanupBarrier =
		input.cleanupBarrier ?? createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActive = input.remoteCopyModeActive ?? { current: false };
	const remoteCopyModeGeneration = input.remoteCopyModeGeneration ?? {
		current: 0,
	};
	const localExitRequestIds = input.localExitRequestIds ?? new Set<number>();
	let context: ShellScrollbackContext | null = null;
	let executor: WorkmuxScrollbackCommandExecutor | null = null;
	let runtimeInstanceId: string | null = null;
	const requestGenerations = { enter: 0, liveInput: 0 };
	let executorRevision = 0;
	let nextTraceId = 0;
	let activeTraceId = 'scroll-0';
	let disposed = false;

	const warn = (message: string, error?: unknown): void => {
		try {
			context?.logger.warn(message, error);
		} catch {
			// Logging is best-effort and must not interrupt owned cleanup.
		}
	};

	const observeCleanup = (
		cleanup: Promise<boolean> | null | undefined,
		failureMessage: string,
		restoreRemoteOnFailure = false,
		cleanupGeneration = remoteCopyModeGeneration.current,
	): Promise<boolean> | null => {
		if (!cleanup) return cleanup ?? null;
		const restoreRemoteOwnership = (): void => {
			if (
				!disposed &&
				restoreRemoteOnFailure &&
				remoteCopyModeGeneration.current === cleanupGeneration
			) {
				remoteCopyModeActive.current = true;
			}
		};
		const observeResult = (result: Promise<boolean>): void => {
			void result.then(
				(exited) => {
					if (!exited) restoreRemoteOwnership();
				},
				(error) => {
					restoreRemoteOwnership();
					if (remoteCopyModeGeneration.current === cleanupGeneration) {
						warn(failureMessage, error);
					}
				},
			);
		};
		let tracked: Promise<boolean>;
		try {
			tracked = cleanupBarrier.track(cleanup) ?? cleanup;
		} catch (error) {
			warn(failureMessage, error);
			observeResult(cleanup);
			return cleanup;
		}
		observeResult(tracked);
		return tracked;
	};

	const safelyPublish = (snapshot: ShellScrollbackState): void => {
		try {
			publisher.publish(snapshot);
		} catch (error) {
			warn('Scrollback state subscriber failed', error);
		}
	};

	const advanceFreshness = (): void => {
		requestGenerations.enter += 1;
		requestGenerations.liveInput += 1;
		remoteCopyModeGeneration.current += 1;
	};

	const clearOwnedState = (): void => {
		resetTmuxScrollbackLocalExitRequests(localExitRequestIds);
		clearTmuxScrollbackLineAccumulator(lineAccumulator);
		remoteCopyModeActive.current = false;
		activeTraceId = `scroll-${nextTraceId}`;
	};

	const resetExecutor = (failurePolicy: 'notify' | 'suppress'): void => {
		const activeExecutor = executor;
		if (!activeExecutor) return;
		const remoteWasActive = remoteCopyModeActive.current;
		const cleanupGeneration = remoteCopyModeGeneration.current;
		let cleanup: Promise<boolean> | null = null;
		try {
			cleanup = resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor: activeExecutor,
				targetName: remoteCopyModeActive.current
					? context?.targetName
					: undefined,
				failurePolicy,
			});
		} catch (error) {
			warn('Workmux scrollback reset failed', error);
		}
		void observeCleanup(
			cleanup,
			'Workmux scrollback reset failed',
			remoteWasActive,
			cleanupGeneration,
		);
	};

	const buildExecutor = (nextContext: ShellScrollbackContext): void => {
		const capturedExecutorRevision = executorRevision;
		let createdExecutor: WorkmuxScrollbackCommandExecutor | null = null;
		const isCurrentExecutor = () =>
			!disposed &&
			createdExecutor !== null &&
			executor === createdExecutor &&
			executorRevision === capturedExecutorRevision;
		try {
			createdExecutor = createExecutor({
				scrollTransport: nextContext.workmuxScroll,
				onFailure: (message) => {
					if (isCurrentExecutor()) warn(message);
				},
				onDisposeExitFailure: (message) => {
					if (isCurrentExecutor()) warn(message);
				},
				onTrace: (event) => {
					if (!isCurrentExecutor()) return;
					try {
						context?.trace({ traceId: activeTraceId, ...event });
					} catch (error) {
						warn('Workmux scrollback trace failed', error);
					}
				},
			});
			executor = createdExecutor;
		} catch (error) {
			executor = null;
			warn('Workmux scrollback executor creation failed', error);
		}
	};

	const replaceExecutor = (nextContext: ShellScrollbackContext): void => {
		const previousExecutor = executor;
		const previousContext = context;
		executor = null;
		executorRevision += 1;
		const replacementRevision = executorRevision;
		advanceFreshness();
		const remoteWasActive = remoteCopyModeActive.current;
		const cleanupGeneration = remoteCopyModeGeneration.current;
		clearOwnedState();
		if (previousExecutor) {
			let cleanup: Promise<boolean> | null = null;
			try {
				cleanup = previousExecutor.dispose({
					targetName: remoteWasActive ? previousContext?.targetName : undefined,
				});
			} catch (error) {
				warn('Workmux scrollback executor disposal failed', error);
			}
			void observeCleanup(
				cleanup,
				'Workmux scrollback executor disposal failed',
				remoteWasActive,
				cleanupGeneration,
			);
		}
		if (disposed || executorRevision !== replacementRevision) return;
		context = nextContext;
		buildExecutor(nextContext);
	};

	const setContext = (nextContext: ShellScrollbackContext): void => {
		if (disposed) return;
		const normalizedContext = {
			...nextContext,
			targetName: nextContext.targetName.trim() || 'main',
		};
		const requiresExecutorReplacement =
			executor === null ||
			context === null ||
			context.targetKey !== normalizedContext.targetKey ||
			context.targetName !== normalizedContext.targetName ||
			context.workmuxScroll !== normalizedContext.workmuxScroll;
		if (requiresExecutorReplacement) {
			replaceExecutor(normalizedContext);
			return;
		}
		context = normalizedContext;
	};

	const onTerminalRuntimeChanged = (instanceId: string | null): void => {
		if (disposed || runtimeInstanceId === instanceId) return;
		runtimeInstanceId = instanceId;
		advanceFreshness();
		const transitionGeneration = requestGenerations.liveInput;
		resetExecutor('suppress');
		if (
			disposed ||
			runtimeInstanceId !== instanceId ||
			requestGenerations.liveInput !== transitionGeneration
		) {
			return;
		}
		clearOwnedState();
		safelyPublish({ ...initialState, runtimeInstanceId: instanceId });
	};

	const invalidate = (_reason: ControllerInvalidationReason): void => {
		if (disposed) return;
		advanceFreshness();
		const invalidationGeneration = requestGenerations.liveInput;
		resetExecutor('suppress');
		if (disposed || requestGenerations.liveInput !== invalidationGeneration) {
			return;
		}
		clearOwnedState();
		safelyPublish({ ...initialState, runtimeInstanceId });
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		executorRevision += 1;
		advanceFreshness();
		const activeExecutor = executor;
		executor = null;
		const remoteWasActive = remoteCopyModeActive.current;
		clearOwnedState();
		try {
			safelyPublish(initialState);
			if (activeExecutor) {
				let cleanup: Promise<boolean> | null = null;
				try {
					cleanup = activeExecutor.dispose({
						targetName: remoteWasActive ? context?.targetName : undefined,
					});
				} catch (error) {
					warn('Workmux scrollback executor disposal failed', error);
				}
				void observeCleanup(
					cleanup,
					'Workmux scrollback executor disposal failed',
				);
			}
		} finally {
			context = null;
			publisher.disposePublisher();
		}
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setContext,
		onTerminalRuntimeChanged,
		onScrollbackModeChange: (event) => {
			if (disposed || event.instanceId !== runtimeInstanceId) return;
			const current = publisher.getSnapshot();
			if (event.active && !current.active) {
				nextTraceId += 1;
				activeTraceId = `scroll-${nextTraceId}`;
			}
			if (current.active === event.active && current.phase === event.phase) {
				return;
			}
			safelyPublish({
				active: event.active,
				phase: event.phase,
				runtimeInstanceId,
			});
		},
		onScrollbackEnterRequested: async () => {
			if (disposed) return;
			// Task 1 intentionally fails closed while still superseding older requests.
			requestGenerations.enter += 1;
		},
		onScrollbackBatch: () => {},
		sendSegments: async () => ({ status: 'unavailable' }),
		clear: () => null,
		jumpToLive: () => {},
		invalidate,
		dispose,
	};
}
