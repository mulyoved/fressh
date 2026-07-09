import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import {
	type ConnectionRunAbortReason,
	type ConnectionRunContext,
	type ConnectionRunOperationResult,
	type ConnectionRunTimeoutKind,
	type ConnectionRunTimeouts,
} from './connection-run-context';
import { rootLogger } from './logger';

export type ConnectionAttemptTimeouts = ConnectionRunTimeouts;

const logger = rootLogger.extend('ConnectionAttemptLifecycle');

type ConnectedConnectionAttemptOutcome = {
	status: 'connected';
	connectionId: string;
	channelId: number;
	storedConnectionId?: string;
	cleanup?: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

type FailedConnectionAttemptOutcome = {
	status: 'failed';
	error: unknown;
	recoverable: boolean;
	attentionMessage: string | null;
};

type AbortedConnectionAttemptOutcome = {
	status: 'aborted';
	reason: Exclude<ConnectionRunAbortReason, 'timeout'>;
};

type CleanupFailedConnectionAttemptOutcome = {
	status: 'cleanupFailed';
	error: unknown;
	priorOutcome: ConnectedConnectionAttemptOutcome;
};

export type ConnectionAttemptOutcome =
	| ConnectedConnectionAttemptOutcome
	| {
			status: 'tmuxAttachFailed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  }
	| {
			status: 'blocked';
			attentionMessage: string | null;
	  }
	| FailedConnectionAttemptOutcome
	| AbortedConnectionAttemptOutcome
	| {
			status: 'timedOut';
			timeoutKind: ConnectionRunTimeoutKind;
	  }
	| CleanupFailedConnectionAttemptOutcome;

export type ActiveShellReopenAttemptOutcome = Exclude<
	ConnectionAttemptOutcome,
	{ status: 'blocked' | 'cleanupFailed' | 'tmuxAttachFailed' }
>;

export type SavedEntryConnectionAttemptOutcome = ConnectionAttemptOutcome;

type RunAbortConnectionAttemptOutcome = Extract<
	ConnectionAttemptOutcome,
	{ status: 'aborted' | 'timedOut' }
>;

export type LateCleanupFailureOutcome =
	| CleanupFailedConnectionAttemptOutcome
	| RunAbortConnectionAttemptOutcome;

type SavedEntryConnectInput = {
	phase: SavedEntryConnectAttemptPhase;
	signal: AbortSignal;
};

type ActiveShellReopenResult = {
	connectionId: string;
	channelId: number;
	close?: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type RunSavedEntryConnectionAttemptArgs = {
	platformOS: string;
	runContext: ConnectionRunContext;
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: (
		input: SavedEntryConnectInput,
	) => Promise<SavedEntryConnectResult>;
	shouldRecoverAfterFailure?: (error: unknown) => boolean;
	cleanupConnected: (
		outcome: ConnectedConnectionAttemptOutcome,
		signal: AbortSignal,
	) => Promise<void>;
	onLateCleanupFailure?: (outcome: LateCleanupFailureOutcome) => void;
};

export type RunActiveShellReopenAttemptArgs = {
	runContext: ConnectionRunContext;
	startShell: (input: {
		signal: AbortSignal;
	}) => Promise<ActiveShellReopenResult>;
	cleanupConnected: (
		result: ActiveShellReopenResult,
		signal: AbortSignal,
	) => Promise<void>;
	onLateCleanupFailure?: (outcome: LateCleanupFailureOutcome) => void;
};

class ConnectionAttemptOutcomeError extends Error {
	readonly outcome: ConnectionAttemptOutcome;

	constructor(outcome: ConnectionAttemptOutcome) {
		super(outcome.status);
		this.name = 'ConnectionAttemptOutcomeError';
		this.outcome = outcome;
	}
}

function mapAborted<T>(
	result: Extract<ConnectionRunOperationResult<T>, { status: 'aborted' }>,
): RunAbortConnectionAttemptOutcome {
	if (result.reason === 'timeout') {
		return { status: 'timedOut', timeoutKind: result.timeoutKind };
	}
	return { status: 'aborted', reason: result.reason };
}

function mapCurrentAbort(
	runContext: ConnectionRunContext,
): RunAbortConnectionAttemptOutcome {
	if (runContext.abortReason === 'timeout' && runContext.timeoutKind !== null) {
		return {
			status: 'timedOut' as const,
			timeoutKind: runContext.timeoutKind,
		};
	}
	return {
		status: 'aborted' as const,
		reason:
			runContext.abortReason !== null && runContext.abortReason !== 'timeout'
				? runContext.abortReason
				: 'caller-aborted',
	};
}

function hasRunAbort(runContext: ConnectionRunContext) {
	return runContext.abortReason !== null || runContext.signal.aborted;
}

function normalizeSavedEntryAbortReason(
	reason: unknown,
): Exclude<ConnectionRunAbortReason, 'timeout'> {
	switch (reason) {
		case 'caller-aborted':
		case 'stale-run':
		case 'stopped':
		case 'replaced':
		case 'unmounted':
			return reason;
		default:
			return 'caller-aborted';
	}
}

function mapSavedEntryResult(
	result: SavedEntryConnectResult,
): Extract<
	ConnectionAttemptOutcome,
	{ status: 'connected' | 'tmuxAttachFailed' | 'aborted' }
> {
	if (result.status === 'tmux_attach_failed') {
		return {
			status: 'tmuxAttachFailed',
			connectionId: result.connectionId,
			tmuxAttachFailureReason: result.tmuxAttachFailureReason,
			tmuxSessionName: result.tmuxSessionName,
			storedConnectionId: result.storedConnectionId,
		};
	}
	if (result.status === 'aborted') {
		return {
			status: 'aborted',
			reason: normalizeSavedEntryAbortReason(result.reason),
		};
	}
	const outcome: ConnectedConnectionAttemptOutcome = {
		status: 'connected',
		connectionId: result.connectionId,
		channelId: result.channelId,
	};
	if (typeof result.cleanup === 'function') {
		outcome.cleanup = result.cleanup;
	}
	return outcome;
}

function reportLateCleanupFailure(
	reporter: ((outcome: LateCleanupFailureOutcome) => void) | undefined,
	outcome: LateCleanupFailureOutcome,
) {
	try {
		reporter?.(outcome);
	} catch {
		// Cleanup reporting must never alter the lifecycle outcome.
	}
}

async function cleanupConnectedOutcome({
	runContext,
	outcome,
	cleanupConnected,
}: {
	runContext: ConnectionRunContext;
	outcome: ConnectedConnectionAttemptOutcome;
	cleanupConnected: (
		outcome: ConnectedConnectionAttemptOutcome,
		signal: AbortSignal,
	) => Promise<void>;
}): Promise<LateCleanupFailureOutcome | null> {
	try {
		logger.debug('cleanup connected outcome requested', {
			connectionId: outcome.connectionId,
			channelId: outcome.channelId,
			runAbortReason: runContext.abortReason,
			runTimeoutKind: runContext.timeoutKind,
			hasCleanup: typeof outcome.cleanup === 'function',
		});
		const cleanupResult = await runContext.runOperation(
			'cleanup',
			async (signal) => {
				await cleanupConnected(outcome, signal);
			},
		);
		if (cleanupResult.status === 'aborted') {
			logger.debug('cleanup connected outcome aborted', {
				connectionId: outcome.connectionId,
				channelId: outcome.channelId,
				cleanupResult,
			});
			return mapAborted(cleanupResult);
		}
		logger.debug('cleanup connected outcome completed', {
			connectionId: outcome.connectionId,
			channelId: outcome.channelId,
		});
		return null;
	} catch (error) {
		logger.debug('cleanup connected outcome failed', {
			connectionId: outcome.connectionId,
			channelId: outcome.channelId,
			error,
		});
		return { status: 'cleanupFailed', error, priorOutcome: outcome };
	}
}

async function cleanupActiveShellResult({
	runContext,
	result,
	cleanupConnected,
}: {
	runContext: ConnectionRunContext;
	result: ActiveShellReopenResult;
	cleanupConnected: (
		result: ActiveShellReopenResult,
		signal: AbortSignal,
	) => Promise<void>;
}): Promise<LateCleanupFailureOutcome | null> {
	try {
		logger.debug('cleanup active shell requested', {
			connectionId: result.connectionId,
			channelId: result.channelId,
			runAbortReason: runContext.abortReason,
			runTimeoutKind: runContext.timeoutKind,
			hasClose: typeof result.close === 'function',
		});
		const cleanupResult = await runContext.runOperation(
			'cleanup',
			async (signal) => {
				await cleanupConnected(result, signal);
			},
		);
		if (cleanupResult.status === 'aborted') {
			logger.debug('cleanup active shell aborted', {
				connectionId: result.connectionId,
				channelId: result.channelId,
				cleanupResult,
			});
			return mapAborted(cleanupResult);
		}
		logger.debug('cleanup active shell completed', {
			connectionId: result.connectionId,
			channelId: result.channelId,
		});
		return null;
	} catch (error) {
		logger.debug('cleanup active shell failed', {
			connectionId: result.connectionId,
			channelId: result.channelId,
			error,
		});
		return {
			status: 'cleanupFailed',
			error,
			priorOutcome: {
				status: 'connected',
				connectionId: result.connectionId,
				channelId: result.channelId,
			},
		};
	}
}

async function cleanupLateSavedEntryConnected({
	runContext,
	lateConnected,
	cleanupConnected,
	cleanupStarted,
	onLateCleanupFailure,
}: {
	runContext: ConnectionRunContext;
	lateConnected: ConnectedConnectionAttemptOutcome | null;
	cleanupConnected: (
		outcome: ConnectedConnectionAttemptOutcome,
		signal: AbortSignal,
	) => Promise<void>;
	cleanupStarted: () => boolean;
	onLateCleanupFailure?: (outcome: LateCleanupFailureOutcome) => void;
}) {
	if (lateConnected === null || cleanupStarted()) {
		logger.debug('cleanup late saved entry skipped', {
			hasLateConnected: lateConnected !== null,
		});
		return;
	}
	logger.debug('cleanup late saved entry starting', {
		connectionId: lateConnected.connectionId,
		channelId: lateConnected.channelId,
		runAbortReason: runContext.abortReason,
		runTimeoutKind: runContext.timeoutKind,
		hasCleanup: typeof lateConnected.cleanup === 'function',
	});
	const cleanupOutcome = await cleanupConnectedOutcome({
		runContext,
		outcome: lateConnected,
		cleanupConnected,
	});
	if (cleanupOutcome !== null) {
		logger.debug('cleanup late saved entry reported failure', {
			connectionId: lateConnected.connectionId,
			channelId: lateConnected.channelId,
			cleanupOutcome,
		});
		reportLateCleanupFailure(onLateCleanupFailure, cleanupOutcome);
	}
}

export async function runSavedEntryConnectionAttempt(
	args: RunSavedEntryConnectionAttemptArgs,
): Promise<ConnectionAttemptOutcome> {
	let lateConnected: ConnectedConnectionAttemptOutcome | null = null;
	let lateCleanupStarted = false;
	const cleanupLateConnected = async () => {
		await cleanupLateSavedEntryConnected({
			runContext: args.runContext,
			lateConnected,
			cleanupConnected: args.cleanupConnected,
			onLateCleanupFailure: args.onLateCleanupFailure,
			cleanupStarted: () => {
				if (lateCleanupStarted) {
					return true;
				}
				lateCleanupStarted = true;
				return false;
			},
		});
	};

	try {
		const readinessResult = await args.runContext.runOperation(
			'recovery',
			async () => await args.recovery.ensureReady(),
		);
		if (readinessResult.status === 'aborted')
			return mapAborted(readinessResult);

		const recovery: SavedEntryTailscaleRecovery = {
			...args.recovery,
			ensureReady: async () => readinessResult.value,
			recoverAfterFailure: async (error) => {
				const recoveryResult = await args.runContext.runOperation(
					'recovery',
					async () => await args.recovery.recoverAfterFailure(error),
				);
				if (recoveryResult.status === 'aborted') {
					throw new ConnectionAttemptOutcomeError(mapAborted(recoveryResult));
				}
				return recoveryResult.value;
			},
		};

		const shouldRecoverAfterFailure = (error: unknown) => {
			if (error instanceof ConnectionAttemptOutcomeError) {
				return false;
			}
			return args.shouldRecoverAfterFailure?.(error) ?? true;
		};

		const savedEntryOutcome = await attemptSavedEntryWithTailscaleRecovery({
			platformOS: args.platformOS,
			recovery,
			shouldRecoverAfterFailure,
			connectSavedEntry: async (phase) => {
				const operation = await args.runContext.runOperation(
					'operation',
					async (signal) => {
						const connectPromise = args.connectSavedEntry({ phase, signal });
						void connectPromise.then(
							(result) => {
								const outcome = mapSavedEntryResult(result);
								if (outcome.status === 'connected') {
									lateConnected = outcome;
									logger.debug('saved entry connected promise settled', {
										connectionId: outcome.connectionId,
										channelId: outcome.channelId,
										signalAborted: signal.aborted,
										runAbortReason: args.runContext.abortReason,
										runTimeoutKind: args.runContext.timeoutKind,
									});
									if (signal.aborted) {
										void cleanupLateConnected();
									}
								}
							},
							() => {},
						);
						const result = await connectPromise;
						const outcome = mapSavedEntryResult(result);
						if (outcome.status === 'connected') {
							lateConnected = outcome;
							logger.debug('saved entry connected before operation returned', {
								connectionId: outcome.connectionId,
								channelId: outcome.channelId,
								signalAborted: signal.aborted,
								runAbortReason: args.runContext.abortReason,
								runTimeoutKind: args.runContext.timeoutKind,
							});
						}
						return result;
					},
				);
				if (operation.status === 'aborted') {
					throw new ConnectionAttemptOutcomeError(mapAborted(operation));
				}
				return operation.value;
			},
		});

		switch (savedEntryOutcome.status) {
			case 'connected': {
				const outcome = mapSavedEntryResult(savedEntryOutcome.result);
				return outcome;
			}
			case 'tmuxAttachFailed':
				return mapSavedEntryResult(savedEntryOutcome.result);
			case 'aborted':
				return mapSavedEntryResult(savedEntryOutcome.result);
			case 'blocked':
				return {
					status: 'blocked',
					attentionMessage: savedEntryOutcome.attentionMessage,
				};
			case 'recoveryNotAttempted':
				return {
					status: 'failed',
					error: savedEntryOutcome.error,
					recoverable: false,
					attentionMessage: savedEntryOutcome.attentionMessage,
				};
			case 'retryFailed':
				return {
					status: 'failed',
					error: savedEntryOutcome.error,
					recoverable: true,
					attentionMessage: savedEntryOutcome.attentionMessage,
				};
			case 'threw':
				if (savedEntryOutcome.error instanceof ConnectionAttemptOutcomeError) {
					await cleanupLateConnected();
					return savedEntryOutcome.error.outcome;
				}
				if (
					args.runContext.classifyError(savedEntryOutcome.error) ===
						'aborted' &&
					hasRunAbort(args.runContext)
				) {
					return mapCurrentAbort(args.runContext);
				}
				return {
					status: 'failed',
					error: savedEntryOutcome.error,
					recoverable: false,
					attentionMessage: null,
				};
		}
	} catch (error) {
		if (error instanceof ConnectionAttemptOutcomeError) {
			await cleanupLateConnected();
			return error.outcome;
		}
		if (
			args.runContext.classifyError(error) === 'aborted' &&
			hasRunAbort(args.runContext)
		) {
			return mapCurrentAbort(args.runContext);
		}
		return {
			status: 'failed',
			error,
			recoverable: false,
			attentionMessage: null,
		};
	}
}

export async function runActiveShellReopenAttempt({
	runContext,
	startShell,
	cleanupConnected,
	onLateCleanupFailure,
}: RunActiveShellReopenAttemptArgs): Promise<ActiveShellReopenAttemptOutcome> {
	let lateConnected: ActiveShellReopenResult | null = null;
	let lateCleanupStarted = false;
	const cleanupLateConnected = async () => {
		if (lateConnected === null || lateCleanupStarted) {
			return;
		}
		lateCleanupStarted = true;
		const cleanupOutcome = await cleanupActiveShellResult({
			runContext,
			result: lateConnected,
			cleanupConnected,
		});
		if (cleanupOutcome !== null) {
			reportLateCleanupFailure(onLateCleanupFailure, cleanupOutcome);
		}
	};
	try {
		const operation = await runContext.runOperation(
			'operation',
			async (signal) => {
				const shellPromise = startShell({ signal });
				void shellPromise.then(
					(result) => {
						lateConnected = result;
						if (signal.aborted) {
							void cleanupLateConnected();
						}
					},
					() => {},
				);
				const result = await shellPromise;
				lateConnected = result;
				return result;
			},
		);
		if (operation.status === 'aborted') {
			const outcome = mapAborted(operation);
			if (lateConnected === null) return outcome;
			await cleanupLateConnected();
			return outcome;
		}
		return {
			status: 'connected',
			connectionId: operation.value.connectionId,
			channelId: operation.value.channelId,
		};
	} catch (error) {
		if (
			runContext.classifyError(error) === 'aborted' &&
			hasRunAbort(runContext)
		) {
			return mapCurrentAbort(runContext);
		}
		return {
			status: 'failed',
			error,
			recoverable: false,
			attentionMessage: null,
		};
	}
}
