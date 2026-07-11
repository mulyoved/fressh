import { type ScrollTraceSink } from '../scroll-trace';
import { resetTmuxScrollbackLocalExitRequests } from '../tmux-scrollback-local-exit';
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
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
	type ControllerOutcome,
} from './controller-core';
import { handleScrollbackBatch } from './scrollback-batch-coordinator';
import {
	createSafeScrollbackWarn as createSafeWarn,
	isScrollbackTerminalInstanceCurrent as isTerminalInstanceCurrent,
	traceScrollbackSafely,
} from './scrollback-callback-safety';
import { createScrollbackCleanupCoordinator } from './scrollback-cleanup-coordinator';
import {
	type ScrollbackBatchEvent,
	type ScrollbackEnterRequestedEvent,
	type ScrollbackModeChangeEvent,
	type ScrollbackRequestAuthority,
	type ShellLiveInputOptions,
	type ShellScrollbackContext,
	type ShellScrollbackState,
} from './scrollback-contracts';
import { createScrollbackEntryCoordinator } from './scrollback-entry-coordinator';
import { createScrollbackFailureCoordinator } from './scrollback-failure-coordinator';
import { createScrollbackLiveInputCoordinator } from './scrollback-live-input-coordinator';
import { createScrollbackLocalUiCoordinator } from './scrollback-local-ui-coordinator';
import { createScrollbackModeCoordinator } from './scrollback-mode-coordinator';
import { handleShellWorkmuxScrollbackDisposeExitFailureActions } from './scrollback-policy';
export type * from './scrollback-contracts';

export type ShellScrollbackControllerCore =
	ControllerCore<ShellScrollbackState> & {
		setContext(context: ShellScrollbackContext): void;
		onTerminalRuntimeChanged(instanceId: string | null): void;
		onActivityChanged(): void;
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
	const warn = (message: string, error?: unknown): void => {
		createSafeWarn(context?.logger)(message, error);
	};

	const cleanupCoordinator = createScrollbackCleanupCoordinator({
		cleanupBarrier,
		getCurrentState: () => ({
			context,
			disposed,
			executor,
			targetOwnershipRevision,
		}),
		lineAccumulator,
		remoteCopyModeActive,
		remoteCopyModeGeneration,
		warn: (logger, message, error) => createSafeWarn(logger)(message, error),
	});
	const captureCleanupOwnership = cleanupCoordinator.captureOwnership;
	const isCleanupFailureCurrent = cleanupCoordinator.isFailureCurrent;
	const registerCleanup = cleanupCoordinator.register;
	const resetExecutor = cleanupCoordinator.reset;

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

	const safelyTrace = (
		ownerContext: ShellScrollbackContext,
		event: Parameters<ScrollTraceSink>[0],
	): void => traceScrollbackSafely(ownerContext, activeTraceId, event);

	const runClearLocalScrollbackUiState = createScrollbackLocalUiCoordinator({
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
	const captureClearAuthority = (
		ownerContext: ShellScrollbackContext,
	):
		| (ScrollbackRequestAuthority<WorkmuxScrollbackCommandExecutor> & {
				isCurrent(): boolean;
		  })
		| null => {
		const ownerExecutor = executor;
		const instanceId = runtimeInstanceId;
		const ownerTargetOwnershipRevision = targetOwnershipRevision;
		if (disposed || context !== ownerContext || ownerExecutor === null)
			return null;
		return {
			context: ownerContext,
			executor: ownerExecutor,
			instanceId,
			targetOwnershipRevision: ownerTargetOwnershipRevision,
			isCurrent: () =>
				!disposed &&
				context === ownerContext &&
				executor === ownerExecutor &&
				runtimeInstanceId === instanceId &&
				targetOwnershipRevision === ownerTargetOwnershipRevision,
		};
	};
	const clearLocalScrollbackUiState = (
		ownerContext: ShellScrollbackContext,
	): void => {
		const authority = captureClearAuthority(ownerContext);
		if (!authority) return;
		runClearLocalScrollbackUiState(ownerContext, authority);
	};

	const clearScrollbackState = (
		ownerContext: ShellScrollbackContext,
		failurePolicy: 'notify' | 'suppress' = 'notify',
		providedAuthority?: ReturnType<typeof captureClearAuthority>,
	): Promise<boolean> | null => {
		const authority = providedAuthority ?? captureClearAuthority(ownerContext);
		if (!authority) return null;
		runClearLocalScrollbackUiState(ownerContext, authority);
		if (!authority.isCurrent()) return null;
		return resetExecutor({
			failurePolicy,
			ownerContext,
			remoteWasActive: remoteCopyModeActive.current,
		});
	};
	const liveInputCoordinator = createScrollbackLiveInputCoordinator({
		advanceFreshness: advanceRequestFreshness,
		clearInactive: () => {
			const ownerContext = context;
			return ownerContext === null
				? null
				: clearScrollbackState(ownerContext, 'suppress');
		},
		getCurrentCleanup: cleanupBarrier.current,
		getCurrentState: () => ({
			context,
			disposed,
			liveInputGeneration: requestGenerations.liveInput,
			remoteCopyModeActive: remoteCopyModeActive.current,
			remoteCopyModeGeneration: remoteCopyModeGeneration.current,
			runtimeInstanceId,
			scrollbackActive: publisher.getSnapshot().active,
			targetOwnershipRevision,
		}),
		scrollbackExitDelayMs: 10,
		scrollbackExitKeyPayload: new Uint8Array([0x71]),
		startCleanup: () => {
			const ownerContext = context;
			return ownerContext === null ? null : clearScrollbackState(ownerContext);
		},
	});

	const entryCoordinator = createScrollbackEntryCoordinator({
		clearLocalState: clearLocalScrollbackUiState,
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
		reserveRequestGeneration: () => ++requestGenerations.enter,
		trace: safelyTrace,
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
	const handleModeChange = createScrollbackModeCoordinator();

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

	const requestJumpToLive = (): Promise<boolean> | null => {
		const ownerContext = context;
		const ownerExecutor = executor;
		const instanceId = runtimeInstanceId;
		const ownerTargetOwnershipRevision = targetOwnershipRevision;
		if (
			disposed ||
			ownerContext === null ||
			ownerExecutor === null ||
			instanceId === null ||
			runtimeInstanceId !== instanceId
		)
			return null;
		const isCurrent = () =>
			!disposed &&
			context === ownerContext &&
			executor === ownerExecutor &&
			runtimeInstanceId === instanceId &&
			targetOwnershipRevision === ownerTargetOwnershipRevision;
		if (!isTerminalInstanceCurrent(ownerContext, instanceId) || !isCurrent())
			return null;
		return clearScrollbackState(ownerContext, 'notify', {
			context: ownerContext,
			executor: ownerExecutor,
			instanceId,
			targetOwnershipRevision: ownerTargetOwnershipRevision,
			isCurrent,
		});
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setContext,
		onActivityChanged: liveInputCoordinator.onActivityChanged,
		onTerminalRuntimeChanged,
		onScrollbackModeChange: (event) => {
			const ownerContext = context;
			if (ownerContext === null) return;
			handleModeChange({
				event,
				getCurrentState: () => ({
					...publisher.getSnapshot(),
					contextIdentity: context,
					disposed,
					executorIdentity: executor,
					targetOwnershipRevision,
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
		onScrollbackEnterRequested: entryCoordinator.run,
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
		sendSegments: liveInputCoordinator.sendSegments,
		clear: (options) => {
			const ownerContext = context;
			if (disposed || ownerContext === null || executor === null) return null;
			return clearScrollbackState(
				ownerContext,
				options?.failurePolicy ?? 'notify',
			);
		},
		jumpToLive: requestJumpToLive,
		invalidate,
		dispose,
	};
}
