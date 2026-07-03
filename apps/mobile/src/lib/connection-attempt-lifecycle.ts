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

export type ConnectionAttemptMode = 'auto-connect' | 'manual-diagnostic';

export type ConnectionAttemptTimeouts = ConnectionRunTimeouts;

export type ConnectionAttemptOutcome =
	| {
			status: 'connected';
			connectionId: string;
			channelId: number;
			storedConnectionId?: string;
	  }
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
	| {
			status: 'failed';
			error: unknown;
			recoverable: boolean;
	  }
	| {
			status: 'aborted';
			reason: ConnectionRunAbortReason;
	  }
	| {
			status: 'timedOut';
			timeoutKind: ConnectionRunTimeoutKind;
	  }
	| {
			status: 'cleanupFailed';
			error: unknown;
			priorOutcome?: Exclude<
				ConnectionAttemptOutcome,
				{ status: 'cleanupFailed' }
			>;
	  };

type ConnectedConnectionAttemptOutcome = Extract<
	ConnectionAttemptOutcome,
	{ status: 'connected' }
>;

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
	mode: ConnectionAttemptMode;
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
): ConnectionAttemptOutcome {
	if (result.reason === 'timeout') {
		return { status: 'timedOut', timeoutKind: result.timeoutKind };
	}
	return { status: 'aborted', reason: result.reason };
}

function mapCurrentAbort(runContext: ConnectionRunContext) {
	if (runContext.abortReason === 'timeout' && runContext.timeoutKind !== null) {
		return {
			status: 'timedOut' as const,
			timeoutKind: runContext.timeoutKind,
		};
	}
	return {
		status: 'aborted' as const,
		reason: runContext.abortReason ?? 'caller-aborted',
	};
}

function hasRunAbort(runContext: ConnectionRunContext) {
	return runContext.abortReason !== null || runContext.signal.aborted;
}

function mapSavedEntryResult(
	result: SavedEntryConnectResult,
): Extract<
	ConnectionAttemptOutcome,
	{ status: 'connected' | 'tmuxAttachFailed' }
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
	return {
		status: 'connected',
		connectionId: result.connectionId,
		channelId: result.channelId,
	};
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
}): Promise<ConnectionAttemptOutcome | null> {
	try {
		const cleanupResult = await runContext.runOperation(
			'cleanup',
			async (signal) => {
				await cleanupConnected(outcome, signal);
			},
		);
		if (cleanupResult.status === 'aborted') {
			return mapAborted(cleanupResult);
		}
		return null;
	} catch (error) {
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
}): Promise<ConnectionAttemptOutcome | null> {
	try {
		const cleanupResult = await runContext.runOperation(
			'cleanup',
			async (signal) => {
				await cleanupConnected(result, signal);
			},
		);
		if (cleanupResult.status === 'aborted') {
			return mapAborted(cleanupResult);
		}
		return null;
	} catch (error) {
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
}: {
	runContext: ConnectionRunContext;
	lateConnected: ConnectedConnectionAttemptOutcome | null;
	cleanupConnected: (
		outcome: ConnectedConnectionAttemptOutcome,
		signal: AbortSignal,
	) => Promise<void>;
	cleanupStarted: () => boolean;
}) {
	if (lateConnected === null || cleanupStarted()) {
		return;
	}
	await cleanupConnectedOutcome({
		runContext,
		outcome: lateConnected,
		cleanupConnected,
	});
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
			cleanupStarted: () => {
				if (lateCleanupStarted) {
					return true;
				}
				lateCleanupStarted = true;
				return false;
			},
		});
	};
	const readinessResult = await args.runContext.runOperation(
		'recovery',
		async () => await args.recovery.ensureReady(),
	);
	if (readinessResult.status === 'aborted') return mapAborted(readinessResult);

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

	try {
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
				if (outcome.status !== 'connected') return outcome;
				if (args.mode !== 'manual-diagnostic') return outcome;
				const cleanupOutcome = await cleanupConnectedOutcome({
					runContext: args.runContext,
					outcome,
					cleanupConnected: args.cleanupConnected,
				});
				return cleanupOutcome ?? outcome;
			}
			case 'tmuxAttachFailed':
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
				};
			case 'retryFailed':
				return {
					status: 'failed',
					error: savedEntryOutcome.error,
					recoverable: true,
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
		return { status: 'failed', error, recoverable: false };
	}
}

export async function runActiveShellReopenAttempt({
	runContext,
	startShell,
	cleanupConnected,
}: RunActiveShellReopenAttemptArgs): Promise<ConnectionAttemptOutcome> {
	let lateConnected: ActiveShellReopenResult | null = null;
	let lateCleanupStarted = false;
	const cleanupLateConnected = async () => {
		if (lateConnected === null || lateCleanupStarted) {
			return;
		}
		lateCleanupStarted = true;
		await cleanupActiveShellResult({
			runContext,
			result: lateConnected,
			cleanupConnected,
		});
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
		return { status: 'failed', error, recoverable: false };
	}
}
