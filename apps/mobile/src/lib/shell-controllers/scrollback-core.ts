import { type ScrollTraceSink } from '../scroll-trace';
import {
	handleTmuxScrollbackEnterRequested,
	registerTmuxScrollbackRemoteCopyModeExitCleanup,
	resetTmuxScrollbackRuntimeState,
} from '../tmux-scrollback';
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
import { handleScrollbackBatch } from './scrollback-batch-coordinator';
import {
	createScrollbackEntryCoordinator,
	type ScrollbackEnterRequestToken,
} from './scrollback-entry-coordinator';
import { createScrollbackFailureCoordinator } from './scrollback-failure-coordinator';
import { createScrollbackLocalUiCoordinator } from './scrollback-local-ui-coordinator';
import { handleScrollbackModeChange } from './scrollback-mode-coordinator';
import { handleShellWorkmuxScrollbackDisposeExitFailureActions } from './scrollback-policy';
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
	source?: 'touch-scroll' | 'selection-handle';
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
	let targetOwnershipRevision = 0;
	let nextTraceId = 0;
	let activeTraceId = 'scroll-0';
	let disposed = false;
	let nextResetInvocationRevision = 0;
	type ResetOperationKey = Readonly<{
		failurePolicy: 'notify' | 'suppress';
		invocationRevision: number;
		remoteCopyModeGeneration: number;
		requiresDurableTargetExit: boolean;
		targetOwnershipRevision: number;
	}>;
	type PendingResetOperation = ResetOperationKey &
		Readonly<{ cleanup: Promise<boolean> }>;
	const pendingResetOperations = new WeakMap<
		WorkmuxScrollbackCommandExecutor,
		PendingResetOperation
	>();

	type CleanupOwnership = Readonly<{
		targetOwnershipRevision: number;
		remoteCopyModeGeneration: number;
		targetKey: ShellTargetKey;
		targetName: string;
	}>;
	const createSafeWarn =
		(logger: ShellScrollbackLogger | undefined) =>
		(message: string, error?: unknown): void => {
			try {
				logger?.warn(message, error);
			} catch {
				// Logging is best-effort and must not interrupt owned cleanup.
			}
		};

	const warn = (message: string, error?: unknown): void => {
		createSafeWarn(context?.logger)(message, error);
	};

	const captureCleanupOwnership = (
		ownerContext: ShellScrollbackContext,
	): CleanupOwnership => ({
		targetOwnershipRevision,
		remoteCopyModeGeneration: remoteCopyModeGeneration.current,
		targetKey: ownerContext.targetKey,
		targetName: ownerContext.targetName,
	});

	const isCleanupFailureCurrent = (ownership: CleanupOwnership): boolean =>
		!disposed &&
		targetOwnershipRevision === ownership.targetOwnershipRevision &&
		context?.targetKey === ownership.targetKey &&
		context.targetName === ownership.targetName;

	const isCleanupSuccessCurrent = (ownership: CleanupOwnership): boolean =>
		isCleanupFailureCurrent(ownership) &&
		remoteCopyModeGeneration.current === ownership.remoteCopyModeGeneration;

	const captureResetOperationKey = (
		requiresDurableTargetExit: boolean,
		failurePolicy: 'notify' | 'suppress',
	): ResetOperationKey => ({
		failurePolicy,
		invocationRevision: ++nextResetInvocationRevision,
		remoteCopyModeGeneration: remoteCopyModeGeneration.current,
		requiresDurableTargetExit,
		targetOwnershipRevision,
	});

	const getPendingResetOperation = (
		ownerExecutor: WorkmuxScrollbackCommandExecutor,
		requiresDurableTargetExit: boolean,
		failurePolicy: 'notify' | 'suppress',
	): Promise<boolean> | null => {
		const pending = pendingResetOperations.get(ownerExecutor);
		return pending?.targetOwnershipRevision === targetOwnershipRevision &&
			pending.remoteCopyModeGeneration === remoteCopyModeGeneration.current &&
			pending.requiresDurableTargetExit === requiresDurableTargetExit &&
			pending.failurePolicy === failurePolicy
			? pending.cleanup
			: null;
	};

	const recordPendingResetOperation = (
		ownerExecutor: WorkmuxScrollbackCommandExecutor,
		key: ResetOperationKey,
		cleanup: Promise<boolean> | null,
	): void => {
		if (!cleanup) return;
		if (
			key.targetOwnershipRevision !== targetOwnershipRevision ||
			key.remoteCopyModeGeneration !== remoteCopyModeGeneration.current ||
			executor !== ownerExecutor
		) {
			return;
		}
		const existing = pendingResetOperations.get(ownerExecutor);
		if (existing && existing.invocationRevision > key.invocationRevision)
			return;
		const pending: PendingResetOperation = {
			...key,
			cleanup,
		};
		pendingResetOperations.set(ownerExecutor, pending);
		const clearIfCurrent = () => {
			if (pendingResetOperations.get(ownerExecutor) !== pending) return;
			pendingResetOperations.delete(ownerExecutor);
		};
		void cleanup.then(clearIfCurrent, clearIfCurrent);
	};

	const registerCleanup = ({
		cleanup,
		failureMessage,
		logger,
		ownership,
		remoteWasActive,
		restoreRemoteOnFailure,
		currentAfterDispose = false,
		clearRemoteOnSuccess = true,
		reportResolvedFalse = true,
	}: {
		cleanup: Promise<boolean> | null | undefined;
		failureMessage: string;
		logger: ShellScrollbackLogger | undefined;
		ownership: CleanupOwnership | null;
		remoteWasActive: boolean;
		restoreRemoteOnFailure: boolean;
		currentAfterDispose?: boolean;
		clearRemoteOnSuccess?: boolean;
		reportResolvedFalse?: boolean;
	}): Promise<boolean> | null => {
		if (!cleanup) return null;
		const safeWarn = createSafeWarn(logger);
		const isSuccessCurrent = () =>
			currentAfterDispose ||
			(ownership !== null && isCleanupSuccessCurrent(ownership));
		const isFailureCurrent = () =>
			currentAfterDispose ||
			(ownership !== null && isCleanupFailureCurrent(ownership));
		const register = (barrier: WorkmuxScrollbackLiveInputCleanupBarrier) =>
			registerTmuxScrollbackRemoteCopyModeExitCleanup({
				barrier,
				cleanup,
				remoteCopyModeActiveRef: remoteCopyModeActive,
				remoteCopyModeWasActive: remoteWasActive,
				freshness: currentAfterDispose
					? { kind: 'always' }
					: {
							kind: 'predicates',
							isSuccessCurrent,
							isFailureCurrent,
						},
				failureOwnership: restoreRemoteOnFailure
					? { kind: 'restore' }
					: { kind: 'ignore' },
				successOwnership: clearRemoteOnSuccess ? 'clear' : 'preserve',
				failureReporting: {
					kind: 'report',
					report: (error, failure) => {
						if (failure.kind === 'rejected' || reportResolvedFalse) {
							safeWarn(failureMessage, error);
						}
					},
				},
			});
		try {
			return register(cleanupBarrier);
		} catch (error) {
			safeWarn(failureMessage, error);
			if (restoreRemoteOnFailure && isFailureCurrent()) {
				remoteCopyModeActive.current = true;
			}
			return register({ current: () => null, track: (value) => value ?? null });
		}
	};

	const safelyPublish = (snapshot: ShellScrollbackState): void => {
		try {
			publisher.publish(snapshot);
		} catch (error) {
			warn('Scrollback state subscriber failed', error);
		}
	};

	const advanceRequestFreshness = (): void => {
		requestGenerations.enter += 1;
		requestGenerations.liveInput += 1;
	};

	const clearLocalState = (): void => {
		resetTmuxScrollbackLocalExitRequests(localExitRequestIds);
		clearTmuxScrollbackLineAccumulator(lineAccumulator);
		activeTraceId = `scroll-${nextTraceId}`;
	};

	const targetsEqual = (
		left: ShellScrollbackContext,
		right: ShellScrollbackContext,
	): boolean =>
		left.targetKey === right.targetKey && left.targetName === right.targetName;

	const resetExecutor = ({
		failurePolicy,
		ownerContext,
		remoteWasActive,
	}: {
		failurePolicy: 'notify' | 'suppress';
		ownerContext: ShellScrollbackContext;
		remoteWasActive: boolean;
	}): Promise<boolean> | null => {
		const activeExecutor = executor;
		if (!activeExecutor) return null;
		const pending = getPendingResetOperation(
			activeExecutor,
			remoteWasActive,
			failurePolicy,
		);
		if (pending) return pending;
		remoteCopyModeGeneration.current += 1;
		const ownership = captureCleanupOwnership(ownerContext);
		const operationKey = captureResetOperationKey(
			remoteWasActive,
			failurePolicy,
		);
		let cleanup: Promise<boolean> | null = null;
		try {
			cleanup = resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor: activeExecutor,
				targetName: remoteWasActive ? ownerContext.targetName : undefined,
				failurePolicy,
			});
		} catch (error) {
			createSafeWarn(ownerContext.logger)(
				'Workmux scrollback reset failed',
				error,
			);
			if (remoteWasActive && isCleanupFailureCurrent(ownership)) {
				remoteCopyModeActive.current = true;
			}
			return null;
		}
		recordPendingResetOperation(activeExecutor, operationKey, cleanup);
		void registerCleanup({
			cleanup,
			failureMessage: 'Workmux scrollback reset failed',
			logger: ownerContext.logger,
			ownership,
			remoteWasActive,
			restoreRemoteOnFailure: remoteWasActive,
			reportResolvedFalse: false,
		});
		return cleanup;
	};

	const safelyTrace = (
		ownerContext: ShellScrollbackContext,
		event: Parameters<ScrollTraceSink>[0],
	): void => {
		try {
			ownerContext.trace({ traceId: activeTraceId, ...event });
		} catch (error) {
			createSafeWarn(ownerContext.logger)(
				'Workmux scrollback trace failed',
				error,
			);
		}
	};

	const isTerminalInstanceCurrent = (
		ownerContext: ShellScrollbackContext,
		instanceId: string,
	): boolean => {
		try {
			return ownerContext.terminalView.isCurrentInstance(instanceId);
		} catch (error) {
			createSafeWarn(ownerContext.logger)(
				'Scrollback terminal instance check failed',
				error,
			);
			return false;
		}
	};

	const clearLocalScrollbackUiState = createScrollbackLocalUiCoordinator({
		getCurrentState: () => ({
			context,
			runtimeInstanceId,
			snapshot: publisher.getSnapshot(),
		}),
		isTerminalInstanceCurrent,
		lineAccumulator,
		localExitRequestIds,
		publish: safelyPublish,
		warn: (ownerContext, message, error) =>
			createSafeWarn(ownerContext.logger)(message, error),
	});

	const clearScrollbackState = (
		ownerContext: ShellScrollbackContext,
		failurePolicy: 'notify' | 'suppress' = 'notify',
	): Promise<boolean> | null => {
		clearLocalScrollbackUiState(ownerContext);
		return resetExecutor({
			failurePolicy,
			ownerContext,
			remoteWasActive: remoteCopyModeActive.current,
		});
	};

	const entryCoordinator = createScrollbackEntryCoordinator({
		getCurrentState: () => ({
			context,
			disposed,
			executor,
			remoteCopyModeGeneration: remoteCopyModeGeneration.current,
			requestGeneration: requestGenerations.enter,
			runtimeInstanceId,
			targetOwnershipRevision,
		}),
		isTerminalInstanceCurrent,
		registerRollbackCleanup: ({ cleanup, logger, ownership }) => {
			void registerCleanup({
				cleanup,
				failureMessage: 'Workmux scrollback enter rollback failed',
				logger,
				ownership,
				remoteWasActive: true,
				restoreRemoteOnFailure: true,
			});
		},
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		warn: (logger, message, error) => createSafeWarn(logger)(message, error),
	});
	const handleCommandFailure = createScrollbackFailureCoordinator({
		clearLocalState: clearLocalScrollbackUiState,
		clearState: (ownerContext, failurePolicy) => {
			void clearScrollbackState(ownerContext, failurePolicy);
		},
		isCurrentContext: (ownerContext) => !disposed && context === ownerContext,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		trace: safelyTrace,
		warn: (logger, message, error) => createSafeWarn(logger)(message, error),
	});

	const buildExecutor = (nextContext: ShellScrollbackContext): void => {
		const capturedExecutorRevision = executorRevision;
		const safeWarn = createSafeWarn(nextContext.logger);
		const isBuildCurrent = () =>
			!disposed &&
			executorRevision === capturedExecutorRevision &&
			context?.targetKey === nextContext.targetKey &&
			context.targetName === nextContext.targetName &&
			context.workmuxScroll === nextContext.workmuxScroll;
		let createdExecutor: WorkmuxScrollbackCommandExecutor | null = null;
		const isCurrentExecutor = () =>
			createdExecutor !== null &&
			isBuildCurrent() &&
			executor === createdExecutor &&
			executorRevision === capturedExecutorRevision;
		try {
			createdExecutor = createExecutor({
				scrollTransport: nextContext.workmuxScroll,
				onFailure: (message, failureContext) => {
					if (!isCurrentExecutor()) return;
					const currentContext = context;
					if (currentContext === null) return;
					const enterOwnerCurrent =
						failureContext.commandKind === 'enter'
							? entryCoordinator.isAttributedOwnerCurrent(
									failureContext.operationOwner,
								)
							: null;
					if (enterOwnerCurrent === false) {
						createSafeWarn(currentContext.logger)(message);
						return;
					}
					handleCommandFailure(currentContext, message, failureContext);
				},
				onDisposeExitFailure: (message) => {
					if (!isCurrentExecutor()) return;
					const currentContext = context;
					if (currentContext === null) return;
					if (!remoteCopyModeActive.current) {
						remoteCopyModeGeneration.current += 1;
						remoteCopyModeActive.current = true;
					}
					try {
						handleShellWorkmuxScrollbackDisposeExitFailureActions({
							message,
							warn: (warning) => currentContext.logger.warn(warning),
						});
					} catch {
						// Suppressed cleanup failures cannot strand executor state.
					}
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
		} catch (error) {
			if (isBuildCurrent()) {
				executor = null;
				safeWarn('Workmux scrollback executor creation failed', error);
			}
			return;
		}
		if (!isBuildCurrent()) {
			let cleanup: Promise<boolean> | null = null;
			try {
				cleanup = createdExecutor.dispose();
			} catch (error) {
				safeWarn('Stale Workmux scrollback executor disposal failed', error);
				return;
			}
			void registerCleanup({
				cleanup,
				failureMessage: 'Stale Workmux scrollback executor disposal failed',
				logger: nextContext.logger,
				ownership: null,
				remoteWasActive: false,
				restoreRemoteOnFailure: false,
				currentAfterDispose: true,
				clearRemoteOnSuccess: false,
			});
			return;
		}
		executor = createdExecutor;
	};

	const replaceExecutor = (nextContext: ShellScrollbackContext): void => {
		const previousExecutor = executor;
		const previousContext = context;
		const targetChanged =
			previousContext !== null && !targetsEqual(previousContext, nextContext);
		if (targetChanged) targetOwnershipRevision += 1;
		executor = null;
		executorRevision += 1;
		const replacementRevision = executorRevision;
		advanceRequestFreshness();
		remoteCopyModeGeneration.current += 1;
		const ownership = previousContext
			? captureCleanupOwnership(previousContext)
			: null;
		const remoteWasActive = remoteCopyModeActive.current;
		const restoreRemoteOnFailure = previousContext !== null && !targetChanged;
		const previousSafeWarn = createSafeWarn(previousContext?.logger);
		clearLocalState();
		if (targetChanged) remoteCopyModeActive.current = false;
		if (previousExecutor) {
			let cleanup: Promise<boolean> | null = null;
			try {
				cleanup = previousExecutor.dispose({
					targetName: remoteWasActive ? previousContext?.targetName : undefined,
				});
			} catch (error) {
				previousSafeWarn('Workmux scrollback executor disposal failed', error);
				if (
					remoteWasActive &&
					restoreRemoteOnFailure &&
					ownership !== null &&
					isCleanupFailureCurrent(ownership)
				) {
					remoteCopyModeActive.current = true;
				}
			}
			void registerCleanup({
				cleanup,
				failureMessage: 'Workmux scrollback executor disposal failed',
				logger: previousContext?.logger,
				ownership,
				remoteWasActive,
				restoreRemoteOnFailure: remoteWasActive && restoreRemoteOnFailure,
			});
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
		advanceRequestFreshness();
		const transitionGeneration = requestGenerations.liveInput;
		clearLocalState();
		if (context === null) {
			safelyPublish({ ...initialState, runtimeInstanceId: instanceId });
			return;
		}
		const ownerContext = context;
		const remoteWasActive = remoteCopyModeActive.current;
		void resetExecutor({
			failurePolicy: 'suppress',
			ownerContext,
			remoteWasActive,
		});
		if (
			disposed ||
			runtimeInstanceId !== instanceId ||
			requestGenerations.liveInput !== transitionGeneration
		) {
			return;
		}
		safelyPublish({ ...initialState, runtimeInstanceId: instanceId });
	};

	const invalidate = (_reason: ControllerInvalidationReason): void => {
		if (disposed || context === null) return;
		advanceRequestFreshness();
		const invalidationGeneration = requestGenerations.liveInput;
		const ownerContext = context;
		const remoteWasActive = remoteCopyModeActive.current;
		clearLocalState();
		void resetExecutor({
			failurePolicy: 'suppress',
			ownerContext,
			remoteWasActive,
		});
		if (disposed || requestGenerations.liveInput !== invalidationGeneration) {
			return;
		}
		safelyPublish({ ...initialState, runtimeInstanceId });
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		targetOwnershipRevision += 1;
		executorRevision += 1;
		advanceRequestFreshness();
		remoteCopyModeGeneration.current += 1;
		const activeExecutor = executor;
		const disposeContext = context;
		const disposeSafeWarn = createSafeWarn(disposeContext?.logger);
		executor = null;
		const remoteWasActive = remoteCopyModeActive.current;
		clearLocalState();
		remoteCopyModeActive.current = false;
		try {
			safelyPublish(initialState);
			if (activeExecutor) {
				let cleanup: Promise<boolean> | null = null;
				try {
					cleanup = activeExecutor.dispose({
						targetName: remoteWasActive ? context?.targetName : undefined,
					});
				} catch (error) {
					disposeSafeWarn('Workmux scrollback executor disposal failed', error);
				}
				void registerCleanup({
					cleanup,
					failureMessage: 'Workmux scrollback executor disposal failed',
					logger: disposeContext?.logger,
					ownership: null,
					remoteWasActive,
					restoreRemoteOnFailure: false,
					currentAfterDispose: true,
				});
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
			const ownerContext = context;
			if (ownerContext === null) return;
			handleScrollbackModeChange({
				event,
				getCurrentState: () => ({
					...publisher.getSnapshot(),
					disposed,
				}),
				isTerminalInstanceCurrent: (instanceId) =>
					isTerminalInstanceCurrent(ownerContext, instanceId),
				localExitRequestIds,
				onActivated: () => {
					nextTraceId += 1;
					activeTraceId = `scroll-${nextTraceId}`;
				},
				publish: safelyPublish,
				remoteCopyModeActive: remoteCopyModeActive.current,
				resetRemote: () => {
					void resetExecutor({
						failurePolicy: 'notify',
						ownerContext,
						remoteWasActive: remoteCopyModeActive.current,
					});
				},
				trace: (traceEvent) => safelyTrace(ownerContext, traceEvent),
			});
		},
		onScrollbackEnterRequested: async (event) => {
			requestGenerations.enter += 1;
			const requestGeneration = requestGenerations.enter;
			const requestTargetOwnershipRevision = targetOwnershipRevision;
			const ownerContext = context;
			const ownerExecutor = executor;
			if (
				disposed ||
				ownerContext === null ||
				ownerExecutor === null ||
				runtimeInstanceId !== event.instanceId
			) {
				return;
			}
			const baseIsCurrent = () =>
				!disposed &&
				requestGenerations.enter === requestGeneration &&
				context === ownerContext &&
				executor === ownerExecutor &&
				runtimeInstanceId === event.instanceId &&
				targetOwnershipRevision === requestTargetOwnershipRevision;
			if (!isTerminalInstanceCurrent(ownerContext, event.instanceId)) return;
			if (!baseIsCurrent()) return;
			let activity: ShellActivitySnapshot;
			try {
				activity = ownerContext.getActivitySnapshot();
			} catch (error) {
				createSafeWarn(ownerContext.logger)(
					'Scrollback activity check failed',
					error,
				);
				return;
			}
			if (!baseIsCurrent()) return;
			const token: ScrollbackEnterRequestToken = Object.freeze({
				activityGeneration: activity.generation,
				context: ownerContext,
				executor: ownerExecutor,
				instanceId: event.instanceId,
				remoteCopyModeGeneration: remoteCopyModeGeneration.current,
				requestGeneration,
				targetOwnershipRevision: requestTargetOwnershipRevision,
			});
			if (!activity.interactive || !activity.appActive) {
				if (entryCoordinator.isInternallyCurrent(token)) {
					clearLocalScrollbackUiState(ownerContext);
				}
				return;
			}
			if (!entryCoordinator.validate(token)) return;
			let selectionModeEnabled: boolean;
			try {
				selectionModeEnabled = ownerContext.getSelectionModeEnabled();
			} catch (error) {
				createSafeWarn(ownerContext.logger)(
					'Scrollback selection check failed',
					error,
				);
				return;
			}
			if (!entryCoordinator.validate(token)) return;
			entryCoordinator.track(token);
			try {
				await handleTmuxScrollbackEnterRequested({
					event,
					isAppActive: activity.appActive,
					currentInstanceId: runtimeInstanceId,
					shellAvailable: ownerContext.shellAvailable,
					selectionModeEnabled,
					tmuxEnabled: ownerContext.tmuxEnabled,
					connectionAvailable: ownerContext.connectionAvailable,
					targetName: ownerContext.targetName,
					commandExecutor: ownerExecutor,
					remoteCopyModeActiveRef: remoteCopyModeActive,
					remoteCopyModeGenerationRef: remoteCopyModeGeneration,
					clearLocalScrollbackUiState: () =>
						clearLocalScrollbackUiState(ownerContext),
					sendScrollbackEnterAck: (requestId, instanceId) =>
						ownerContext.terminalView.sendScrollbackEnterAck(
							requestId,
							instanceId,
						),
					isRequestCurrent: () => entryCoordinator.validate(token),
					operationOwner: token,
					onEnterCommandSettled: () => entryCoordinator.release(token),
					rollbackEnteredCopyMode: () => entryCoordinator.rollback(token),
					trace: (traceEvent) => safelyTrace(ownerContext, traceEvent),
				});
			} catch (error) {
				createSafeWarn(ownerContext.logger)(
					'Workmux scrollback enter failed',
					error,
				);
				if (entryCoordinator.validate(token)) {
					clearLocalScrollbackUiState(ownerContext);
				}
			} finally {
				entryCoordinator.release(token);
			}
		},
		onScrollbackBatch: (event) => {
			const ownerContext = context;
			const ownerExecutor = executor;
			if (disposed || ownerContext === null || ownerExecutor === null) return;
			handleScrollbackBatch({
				context: ownerContext,
				event,
				executor: ownerExecutor,
				getCurrentState: () => ({
					context,
					disposed,
					executor,
					runtimeInstanceId,
					targetOwnershipRevision,
				}),
				isTerminalInstanceCurrent,
				lineAccumulator,
				onCurrentFailure: (message) =>
					handleCommandFailure(ownerContext, message, {
						commandKind: 'scroll',
					}),
				remoteCopyModeActive: remoteCopyModeActive.current,
				scrollbackActive: publisher.getSnapshot().active,
				trace: (traceEvent) => safelyTrace(ownerContext, traceEvent),
				warn: (message, error) =>
					createSafeWarn(ownerContext.logger)(message, error),
			});
		},
		sendSegments: async () => ({ status: 'unavailable' }),
		clear: (options) => {
			const ownerContext = context;
			if (disposed || ownerContext === null || executor === null) return null;
			return clearScrollbackState(
				ownerContext,
				options?.failurePolicy ?? 'notify',
			);
		},
		jumpToLive: () => {
			const ownerContext = context;
			const instanceId = runtimeInstanceId;
			if (
				disposed ||
				ownerContext === null ||
				executor === null ||
				instanceId === null ||
				!isTerminalInstanceCurrent(ownerContext, instanceId)
			) {
				return;
			}
			void clearScrollbackState(ownerContext);
		},
		invalidate,
		dispose,
	};
}
