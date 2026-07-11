import { type ScrollTraceSink } from './scroll-trace';
import { type ScrollbackOperationOwner } from './shell-controllers/scrollback-operation-owner';
import { type WorkmuxScrollDirection } from './workmux-app-commands';
import {
	accumulateWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	isValidScrollbackBatchEvent,
	type TmuxScrollbackLineAccumulator,
	type WorkmuxScrollbackPageCommand,
} from './workmux-scrollback-batch';
import {
	type WorkmuxScrollbackCommandExecutor,
	type WorkmuxScrollbackFailurePolicy,
} from './workmux-scrollback-executor';
import {
	registerWorkmuxScrollbackLiveInputCleanup,
	type WorkmuxScrollbackLiveInputCleanupBarrier,
} from './workmux-scrollback-live-input';

export function resetTmuxScrollbackRuntimeState({
	lineAccumulator,
	commandExecutor,
	targetName,
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	targetName?: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}): Promise<boolean> | null {
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	return (
		commandExecutor?.reset({
			targetName,
			failurePolicy,
		}) ?? null
	);
}

export type TmuxScrollbackCleanupFreshnessPolicy =
	| { kind: 'always' }
	| { kind: 'generation'; generation: { current: number } }
	| {
			kind: 'predicates';
			isSuccessCurrent(): boolean;
			isFailureCurrent(): boolean;
	  };

export type TmuxScrollbackCleanupFailureOwnershipPolicy =
	| { kind: 'ignore' }
	| { kind: 'restore' }
	| { kind: 'preserve-if-cleared'; acquireOnFailure: boolean };

export type TmuxScrollbackCleanupFailureReportingPolicy =
	| { kind: 'ignore' }
	| {
			kind: 'report';
			report(
				error: unknown,
				context: { kind: 'resolved-false' | 'rejected' },
			): void;
	  };

export function registerTmuxScrollbackRemoteCopyModeExitCleanup({
	barrier,
	cleanup,
	remoteCopyModeActiveRef,
	remoteCopyModeWasActive = remoteCopyModeActiveRef.current,
	freshness,
	failureOwnership,
	successOwnership,
	failureReporting,
}: {
	barrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	cleanup?: Promise<boolean> | null;
	remoteCopyModeActiveRef: { current: boolean };
	remoteCopyModeWasActive?: boolean;
	freshness: TmuxScrollbackCleanupFreshnessPolicy;
	failureOwnership: TmuxScrollbackCleanupFailureOwnershipPolicy;
	successOwnership: 'clear' | 'preserve';
	failureReporting: TmuxScrollbackCleanupFailureReportingPolicy;
}): Promise<boolean> | null {
	const capturedGeneration =
		freshness.kind === 'generation' ? freshness.generation.current : undefined;
	const isCurrent = (result: 'success' | 'failure') => {
		try {
			switch (freshness.kind) {
				case 'always':
					return true;
				case 'generation':
					return freshness.generation.current === capturedGeneration;
				case 'predicates':
					return result === 'success'
						? freshness.isSuccessCurrent()
						: freshness.isFailureCurrent();
			}
		} catch {
			return false;
		}
	};
	const reportFailure = (
		error: unknown,
		context: { kind: 'resolved-false' | 'rejected' },
	) => {
		try {
			if (failureReporting.kind === 'report') {
				failureReporting.report(error, context);
			}
		} catch {
			// Cleanup failure reporting is best-effort.
		}
	};
	const trackedCleanup = registerWorkmuxScrollbackLiveInputCleanup(
		barrier,
		cleanup,
	);
	void cleanup?.then(
		(exited) => {
			if (!isCurrent(exited ? 'success' : 'failure')) return;
			if (exited) {
				if (successOwnership === 'clear') {
					remoteCopyModeActiveRef.current = false;
				}
				return;
			}
			switch (failureOwnership.kind) {
				case 'ignore':
					break;
				case 'restore':
					remoteCopyModeActiveRef.current = true;
					break;
				case 'preserve-if-cleared': {
					const wasClearedDuringCleanup =
						remoteCopyModeWasActive && !remoteCopyModeActiveRef.current;
					if (
						!wasClearedDuringCleanup &&
						(remoteCopyModeWasActive || failureOwnership.acquireOnFailure)
					) {
						remoteCopyModeActiveRef.current = true;
					}
					break;
				}
			}
			reportFailure(undefined, { kind: 'resolved-false' });
		},
		(error) => {
			if (!isCurrent('failure')) return;
			if (failureOwnership.kind === 'restore') {
				remoteCopyModeActiveRef.current = true;
			}
			reportFailure(error, { kind: 'rejected' });
		},
	);
	return trackedCleanup;
}

function runTmuxScrollbackRemoteCopyModeCleanupForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	targetName,
	cleanupOperation,
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	targetName: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
	cleanupOperation: (options: {
		remoteCopyModeWasActive: boolean;
		targetName?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => Promise<boolean> | null;
}): Promise<boolean> | null {
	const remoteCopyModeWasActive = remoteCopyModeActiveRef.current;
	const cleanupTargetName = remoteCopyModeWasActive ? targetName : undefined;
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	const cleanup = commandExecutor
		? cleanupOperation({
				remoteCopyModeWasActive,
				targetName: cleanupTargetName,
				failurePolicy,
			})
		: null;
	return registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup,
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive,
		freshness: cleanupGeneration
			? { kind: 'generation', generation: cleanupGeneration }
			: { kind: 'always' },
		failureOwnership: {
			kind: 'preserve-if-cleared',
			acquireOnFailure: true,
		},
		successOwnership: 'clear',
		failureReporting: { kind: 'ignore' },
	});
}

export function resetTmuxScrollbackRuntimeStateForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	targetName,
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	targetName: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}): Promise<boolean> | null {
	return runTmuxScrollbackRemoteCopyModeCleanupForUiReset({
		lineAccumulator,
		commandExecutor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		cleanupGeneration,
		targetName,
		failurePolicy,
		cleanupOperation: ({ targetName, failurePolicy }) =>
			resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor,
				targetName,
				failurePolicy,
			}),
	});
}

export function disposeTmuxScrollbackRuntimeStateForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	targetName,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	targetName: string;
}): Promise<boolean> | null {
	return runTmuxScrollbackRemoteCopyModeCleanupForUiReset({
		lineAccumulator,
		commandExecutor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		cleanupGeneration,
		targetName,
		cleanupOperation: ({ targetName }) =>
			commandExecutor?.dispose({
				targetName,
			}) ?? null,
	});
}

export function shouldRunTmuxScrollbackRemoteResetForModeChange({
	active,
	requestId,
	localExitRequestIds,
}: {
	active: boolean;
	requestId?: number;
	localExitRequestIds: Set<number>;
}): boolean {
	if (active) return false;
	if (requestId !== undefined && localExitRequestIds.delete(requestId)) {
		return false;
	}
	return true;
}

type TmuxScrollbackEnterRequestResolution =
	| { action: 'enter' }
	| { action: 'clear-local-ui' }
	| { action: 'ignore' };

export function resolveTmuxScrollbackEnterRequest({
	isAppActive,
	instanceId,
	currentInstanceId,
}: {
	isAppActive: boolean;
	instanceId: string;
	currentInstanceId?: string | null;
}): TmuxScrollbackEnterRequestResolution {
	if (currentInstanceId && instanceId !== currentInstanceId) {
		return { action: 'ignore' };
	}
	if (!isAppActive) return { action: 'clear-local-ui' };
	return { action: 'enter' };
}

export async function handleTmuxScrollbackEnterRequested({
	event,
	isAppActive,
	currentInstanceId,
	shellAvailable,
	selectionModeEnabled,
	tmuxEnabled,
	connectionAvailable,
	targetName,
	commandExecutor,
	remoteCopyModeActiveRef,
	remoteCopyModeGenerationRef,
	clearLocalScrollbackUiState,
	sendScrollbackEnterAck,
	isRequestCurrent = () => true,
	operationOwner,
	onEnterCommandSettled,
	rollbackEnteredCopyMode,
	trace,
}: {
	event: { instanceId: string; requestId: number };
	isAppActive: boolean;
	currentInstanceId?: string | null;
	shellAvailable: boolean;
	selectionModeEnabled: boolean;
	tmuxEnabled: boolean;
	connectionAvailable: boolean;
	targetName: string;
	commandExecutor: WorkmuxScrollbackCommandExecutor;
	remoteCopyModeActiveRef: { current: boolean };
	remoteCopyModeGenerationRef: { current: number };
	clearLocalScrollbackUiState: () => void;
	sendScrollbackEnterAck: (requestId: number, instanceId: string) => void;
	isRequestCurrent?: () => boolean;
	operationOwner?: ScrollbackOperationOwner;
	onEnterCommandSettled?: () => void;
	rollbackEnteredCopyMode?: () => Promise<boolean> | null;
	trace?: ScrollTraceSink;
}): Promise<void> {
	const emitTrace = (traceEvent: Parameters<ScrollTraceSink>[0]): boolean => {
		try {
			trace?.(traceEvent);
		} catch {
			// Trace sinks are observational and cannot own entry state.
		}
		return isRequestCurrent();
	};
	const rollback = async (): Promise<void> => {
		const cleanup = rollbackEnteredCopyMode
			? rollbackEnteredCopyMode()
			: commandExecutor.reset({
					targetName,
					failurePolicy: 'suppress',
				});
		await cleanup;
	};
	if (
		!emitTrace({
			event: 'rn.enter.request',
			requestId: event.requestId,
			instanceId: event.instanceId,
			currentInstanceId,
		})
	) {
		return;
	}
	const requestResolution = resolveTmuxScrollbackEnterRequest({
		isAppActive,
		instanceId: event.instanceId,
		currentInstanceId,
	});
	if (requestResolution.action === 'ignore') {
		emitTrace({
			event: 'rn.enter.dropped',
			reason: 'stale-instance',
			requestId: event.requestId,
			instanceId: event.instanceId,
			currentInstanceId,
		});
		return;
	}
	if (requestResolution.action === 'clear-local-ui') {
		if (
			!emitTrace({
				event: 'rn.enter.dropped',
				reason: 'app-inactive',
				requestId: event.requestId,
				instanceId: event.instanceId,
			})
		)
			return;
		clearLocalScrollbackUiState();
		return;
	}

	if (
		!shellAvailable ||
		selectionModeEnabled ||
		!tmuxEnabled ||
		!connectionAvailable
	) {
		if (
			!emitTrace({
				event: 'rn.enter.dropped',
				reason: 'unavailable',
				requestId: event.requestId,
				instanceId: event.instanceId,
				shellAvailable,
				selectionModeEnabled,
				tmuxEnabled,
				connectionAvailable,
			})
		)
			return;
		clearLocalScrollbackUiState();
		return;
	}

	if (
		!emitTrace({
			event: 'rn.enter.command',
			requestId: event.requestId,
			instanceId: event.instanceId,
		})
	)
		return;
	let entered: boolean;
	try {
		entered = await commandExecutor.runEnterCommand(targetName, operationOwner);
	} finally {
		try {
			onEnterCommandSettled?.();
		} catch {
			// Command attribution cleanup is best-effort and cannot own entry state.
		}
	}
	if (!isRequestCurrent()) {
		emitTrace({
			event: 'rn.enter.stale-after-command',
			requestId: event.requestId,
			instanceId: event.instanceId,
			entered,
		});
		if (entered) {
			await rollback();
		}
		return;
	}
	if (!entered) {
		if (
			!emitTrace({
				event: 'rn.enter.failed',
				requestId: event.requestId,
				instanceId: event.instanceId,
			})
		)
			return;
		clearLocalScrollbackUiState();
		return;
	}
	remoteCopyModeGenerationRef.current += 1;
	remoteCopyModeActiveRef.current = true;
	if (
		!emitTrace({
			event: 'rn.enter.acked',
			requestId: event.requestId,
			instanceId: event.instanceId,
			remoteGeneration: remoteCopyModeGenerationRef.current,
		})
	) {
		await rollback();
		return;
	}
	try {
		sendScrollbackEnterAck(event.requestId, event.instanceId);
	} catch {
		await rollback();
		return;
	}
	if (!isRequestCurrent()) await rollback();
}

export function handleTmuxScrollbackBatchEvent({
	event,
	shellAvailable,
	currentInstanceId,
	selectionModeEnabled,
	tmuxEnabled,
	connectionAvailable,
	scrollbackActive,
	remoteCopyModeActive,
	targetName,
	lineAccumulator,
	enqueueScrollBatch,
	isRequestCurrent = () => true,
	onEnqueueFailure,
	trace,
}: {
	event: {
		direction: WorkmuxScrollDirection;
		pages: number;
		lines: number;
		pageStep: number;
		instanceId: string;
		seq?: number;
		ts?: number;
		source?: 'touch-scroll' | 'selection-handle';
	};
	shellAvailable: boolean;
	currentInstanceId?: string | null;
	selectionModeEnabled: boolean;
	tmuxEnabled: boolean;
	connectionAvailable: boolean;
	scrollbackActive: boolean;
	remoteCopyModeActive: boolean;
	targetName: string;
	lineAccumulator: TmuxScrollbackLineAccumulator;
	enqueueScrollBatch: (
		commands: WorkmuxScrollbackPageCommand[],
	) => Promise<boolean>;
	isRequestCurrent?: () => boolean;
	onEnqueueFailure?: (error: unknown) => void;
	trace?: ScrollTraceSink;
}): boolean {
	const traceBatch = (
		traceEvent: 'rn.batch.accepted' | 'rn.batch.dropped',
		extras?: Record<string, unknown>,
	): boolean => {
		try {
			trace?.({
				event: traceEvent,
				direction: event.direction,
				pages: event.pages,
				lines: event.lines,
				pageStep: event.pageStep,
				instanceId: event.instanceId,
				seq: event.seq,
				webviewTs: event.ts,
				source: event.source,
				...extras,
			});
		} catch {
			// Trace sinks are observational and cannot own batch state.
		}
		return isRequestCurrent();
	};
	if (!isRequestCurrent()) return false;
	if (!shellAvailable) {
		traceBatch('rn.batch.dropped', { reason: 'no-shell' });
		return false;
	}
	if (currentInstanceId && event.instanceId !== currentInstanceId) {
		traceBatch('rn.batch.dropped', {
			reason: 'stale-instance',
			currentInstanceId,
		});
		return false;
	}
	if (selectionModeEnabled && event.source !== 'selection-handle') {
		traceBatch('rn.batch.dropped', { reason: 'selection' });
		return false;
	}
	if (!tmuxEnabled || !connectionAvailable) {
		traceBatch('rn.batch.dropped', {
			reason: 'disabled-or-disconnected',
			tmuxEnabled,
			connectionAvailable,
		});
		return false;
	}
	if (!scrollbackActive) {
		traceBatch('rn.batch.dropped', { reason: 'local-inactive' });
		return false;
	}
	if (!remoteCopyModeActive) {
		traceBatch('rn.batch.dropped', { reason: 'remote-inactive' });
		return false;
	}
	if (!isValidScrollbackBatchEvent(event)) {
		traceBatch('rn.batch.dropped', { reason: 'invalid' });
		return false;
	}

	const commands = accumulateWorkmuxScrollbackBatchCommands({
		sessionName: targetName,
		direction: event.direction,
		pages: event.pages,
		lines: event.lines,
		linesPerPage: event.pageStep,
		lineAccumulator,
	});
	if (commands.length === 0) {
		traceBatch('rn.batch.dropped', { reason: 'empty' });
		return false;
	}
	if (!traceBatch('rn.batch.accepted', { commandCount: commands.length })) {
		return false;
	}
	const reportEnqueueFailure = (error: unknown) => {
		try {
			onEnqueueFailure?.(error);
		} catch {
			// Failure observation cannot become an unhandled rejection.
		}
	};
	let enqueue: Promise<boolean>;
	try {
		enqueue = enqueueScrollBatch(commands);
	} catch (error) {
		reportEnqueueFailure(error);
		return true;
	}
	void enqueue.catch(reportEnqueueFailure);
	return true;
}
