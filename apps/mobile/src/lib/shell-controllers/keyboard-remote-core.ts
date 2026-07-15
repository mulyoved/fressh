import { restartCodexWithBridge } from '@/lib/codex-restart';
import {
	createWorkmuxKeyboardCommandRunner,
	type WorkmuxKeyboardCommand,
	type WorkmuxKeyboardCommandRunResult,
} from '@/lib/keyboard-actions';
import { type ShellConfigState } from '@/lib/shell-config-store';
import { showShellWorkmuxKeyboardFailure } from '../../app/shell/shell-workmux-keyboard-policy';
import {
	type CreateShellKeyboardRemoteCoreOptions,
	type ShellKeyboardRemoteActivitySnapshot,
	type ShellKeyboardRemoteCore,
	type ShellKeyboardRemoteOutcome,
} from './keyboard-remote-contracts';
import {
	copyKeyboardRemoteTarget,
	createKeyboardRemoteCancellation,
	getKeyboardRemoteErrorMessage,
	isSameKeyboardRemoteTarget,
	type KeyboardRemoteAuthority,
	type KeyboardRemoteCancellation,
	type QueuedKeyboardRemoteWorkmux,
} from './keyboard-remote-support';
import { type ShellWorkmuxOutcome } from './session-contracts';

export type {
	CreateShellKeyboardRemoteCoreOptions,
	ShellKeyboardRemoteActivitySnapshot,
	ShellKeyboardRemoteCore,
	ShellKeyboardRemoteLogger,
	ShellKeyboardRemoteOutcome,
	ShellKeyboardRemoteStatePort,
	ShellKeyboardRemoteTargetContext,
} from './keyboard-remote-contracts';

function toBridgeWorkmuxResult(outcome: ShellWorkmuxOutcome) {
	switch (outcome.status) {
		case 'completed':
			return { success: true as const, output: outcome.output ?? '' };
		case 'failed':
			return {
				success: false as const,
				output: outcome.output ?? '',
				error: outcome.failure.message,
				...(outcome.failure.failureClass
					? { failureClass: outcome.failure.failureClass }
					: {}),
			};
		case 'superseded':
			return { success: false as const, output: '', error: 'superseded' };
		case 'unavailable':
			return { success: false as const, output: '', error: 'unavailable' };
	}
}

export function createShellKeyboardRemoteCore({
	initialTargetContext,
	getActivitySnapshot,
	getNavScope,
	keyboardState,
	reloadRuntimeShellConfig,
	closeCommandMenu,
	showAlert,
	invalidateShellTransport,
	logger,
	now = Date.now,
	restartCodex = restartCodexWithBridge,
}: CreateShellKeyboardRemoteCoreOptions): ShellKeyboardRemoteCore {
	let disposed = false;
	let generation = 0;
	let target = copyKeyboardRemoteTarget(initialTargetContext);
	let reloadGeneration = 0;
	let reloadCancellation: KeyboardRemoteCancellation | null = null;
	let restartGeneration = 0;
	let restartInFlight: number | null = null;
	let restartCancellation: KeyboardRemoteCancellation | null = null;
	let activeWorkmuxAuthority: KeyboardRemoteAuthority | null = null;
	let workmuxRunning = false;
	let pendingWorkmux: QueuedKeyboardRemoteWorkmux | null = null;
	let activeWorkmux: {
		id: symbol;
		resolve(result: WorkmuxKeyboardCommandRunResult): void;
	} | null = null;

	const safeWarn = (message: string, details?: unknown) => {
		try {
			logger?.warn(message, details);
		} catch {
			// Diagnostics do not own controller behavior.
		}
	};
	const safeInfo = (message: string, details?: unknown) => {
		try {
			logger?.info(message, details);
		} catch {
			// Diagnostics do not own controller behavior.
		}
	};
	const safeAlert = (title: string, message: string) => {
		try {
			showAlert(title, message);
		} catch (error) {
			safeWarn('Failed to show keyboard remote command alert', error);
		}
	};
	const readClock = (): number | null => {
		try {
			return now();
		} catch (error) {
			safeWarn('Failed to read keyboard remote clock', error);
			return null;
		}
	};
	const readActivity = (): ShellKeyboardRemoteActivitySnapshot | null => {
		try {
			return { ...getActivitySnapshot() };
		} catch (error) {
			safeWarn(
				'Failed to read shell activity for keyboard remote command',
				error,
			);
			return null;
		}
	};
	const captureAuthority = (): KeyboardRemoteAuthority | null => {
		if (disposed) return null;
		const startingGeneration = generation;
		const startingTarget = copyKeyboardRemoteTarget(target);
		const activity = readActivity();
		if (
			!activity?.interactive ||
			disposed ||
			startingGeneration !== generation ||
			!isSameKeyboardRemoteTarget(startingTarget, target)
		) {
			return null;
		}
		return {
			generation: startingGeneration,
			activityGeneration: activity.generation,
			target: startingTarget,
		};
	};
	const isCurrent = (authority: KeyboardRemoteAuthority): boolean => {
		if (
			disposed ||
			authority.generation !== generation ||
			!isSameKeyboardRemoteTarget(authority.target, target)
		) {
			return false;
		}
		const activity = readActivity();
		return Boolean(
			activity?.interactive &&
				activity.generation === authority.activityGeneration &&
				!disposed &&
				authority.generation === generation &&
				isSameKeyboardRemoteTarget(authority.target, target),
		);
	};

	const createRunner = () => {
		const runnerTarget = copyKeyboardRemoteTarget(target);
		const runnerGeneration = generation;
		const runnerIsCurrent = () =>
			!disposed &&
			runnerGeneration === generation &&
			isSameKeyboardRemoteTarget(runnerTarget, target);
		const commandIsCurrent = () =>
			runnerIsCurrent() &&
			(activeWorkmuxAuthority === null || isCurrent(activeWorkmuxAuthority));
		return createWorkmuxKeyboardCommandRunner({
			isTmuxEnabled: () => commandIsCurrent() && runnerTarget.tmuxEnabled,
			getSessionName: () => runnerTarget.sessionName,
			getNavScope: () => getNavScope(),
			runWorkmuxCommand: async (argv, timeoutMs) => {
				if (!commandIsCurrent()) throw new Error('Workmux command superseded.');
				const commandArgv = [...argv];
				const startedAtMs = readClock();
				if (!commandIsCurrent()) throw new Error('Workmux command superseded.');
				safeInfo('Workmux keyboard command start', {
					connectionId: runnerTarget.connectionId,
					channelId: runnerTarget.channelId,
					argv: commandArgv,
					timeoutMs,
				});
				if (!commandIsCurrent()) throw new Error('Workmux command superseded.');
				try {
					const result = await runnerTarget.workmuxControlChannel.command(
						commandArgv,
						{ timeoutMs },
					);
					if (commandIsCurrent()) {
						const finishedAtMs = readClock();
						if (!commandIsCurrent()) return result;
						safeInfo('Workmux keyboard command result', {
							connectionId: runnerTarget.connectionId,
							channelId: runnerTarget.channelId,
							argv: commandArgv,
							timeoutMs,
							...(startedAtMs === null || finishedAtMs === null
								? {}
								: { elapsedMs: finishedAtMs - startedAtMs }),
							status: result.status,
							failureClass:
								result.status === 'failed'
									? result.failure.failureClass
									: undefined,
							error:
								result.status === 'failed' ? result.failure.message : undefined,
							outputBytes: result.output?.length ?? 0,
						});
					}
					return result;
				} catch (error) {
					if (commandIsCurrent()) {
						const failedAtMs = readClock();
						if (!commandIsCurrent()) throw error;
						safeWarn('Workmux keyboard command threw', {
							connectionId: runnerTarget.connectionId,
							channelId: runnerTarget.channelId,
							argv: commandArgv,
							timeoutMs,
							...(startedAtMs === null || failedAtMs === null
								? {}
								: { elapsedMs: failedAtMs - startedAtMs }),
							error: getKeyboardRemoteErrorMessage(error),
						});
					}
					throw error;
				}
			},
			showFailure: ({ message, failureClass }) => {
				if (!commandIsCurrent()) return;
				const activity = readActivity();
				if (!activity || !commandIsCurrent()) return;
				safeWarn('Workmux keyboard command failure', {
					connectionId: runnerTarget.connectionId,
					channelId: runnerTarget.channelId,
					failureClass,
					message,
				});
				if (!commandIsCurrent()) return;
				try {
					showShellWorkmuxKeyboardFailure({
						failureClass,
						isFocused: activity.focused,
						isAppActive: activity.appActive,
						message,
						onTransportUnhealthy: () => {
							if (!commandIsCurrent()) return;
							const currentActivity = readActivity();
							if (!currentActivity?.interactive || !commandIsCurrent()) return;
							try {
								invalidateShellTransport(
									runnerTarget.connectionId,
									runnerTarget.channelId,
								);
							} catch (error) {
								safeWarn(
									'Failed to invalidate unhealthy Workmux transport',
									error,
								);
							}
						},
						showAlert: (title, alertMessage) => {
							if (commandIsCurrent()) safeAlert(title, alertMessage);
						},
					});
				} catch (error) {
					safeWarn('Failed to show Workmux keyboard command failure', error);
				}
			},
			getErrorMessage: getKeyboardRemoteErrorMessage,
		});
	};

	let runner = createRunner();
	const advanceGeneration = () => {
		runner.invalidate();
		activeWorkmux?.resolve({ status: 'superseded' });
		activeWorkmux = null;
		activeWorkmuxAuthority = null;
		workmuxRunning = false;
		pendingWorkmux?.resolve({ status: 'superseded' });
		pendingWorkmux = null;
		reloadCancellation?.settle({ status: 'superseded' });
		reloadCancellation = null;
		restartCancellation?.settle({ status: 'superseded' });
		restartCancellation = null;
		generation += 1;
		reloadGeneration += 1;
		restartGeneration += 1;
		restartInFlight = null;
	};

	const executeWorkmux = async (
		queued: QueuedKeyboardRemoteWorkmux,
	): Promise<void> => {
		workmuxRunning = true;
		const execution = { id: Symbol('workmux'), resolve: queued.resolve };
		activeWorkmux = execution;
		activeWorkmuxAuthority = queued.authority;
		const commandRunner = runner;
		try {
			let result: WorkmuxKeyboardCommandRunResult;
			try {
				result = isCurrent(queued.authority)
					? await commandRunner.run(queued.command)
					: { status: 'superseded' };
			} catch (error) {
				if (activeWorkmux !== execution) return;
				safeWarn('Workmux keyboard command runner failed', error);
				if (activeWorkmux !== execution) return;
				result = isCurrent(queued.authority)
					? { status: 'handled' }
					: { status: 'superseded' };
			}
			if (activeWorkmux !== execution) return;
			queued.resolve(
				isCurrent(queued.authority) ? result : { status: 'superseded' },
			);
		} finally {
			if (activeWorkmux === execution) {
				activeWorkmux = null;
				activeWorkmuxAuthority = null;
				workmuxRunning = false;
				const next = pendingWorkmux;
				pendingWorkmux = null;
				if (next) void executeWorkmux(next);
			}
		}
	};

	const runWorkmuxCommand = (
		command: WorkmuxKeyboardCommand,
	): Promise<WorkmuxKeyboardCommandRunResult> => {
		if (disposed) return Promise.resolve({ status: 'superseded' });
		const copied: WorkmuxKeyboardCommand =
			command.type === 'focus'
				? { type: 'focus', target: command.target }
				: command.type === 'nav'
					? {
							type: 'nav',
							action: command.action,
							...(command.scope === undefined ? {} : { scope: command.scope }),
						}
					: { type: 'status-cycle' };
		const authority = captureAuthority();
		if (!authority) return Promise.resolve({ status: 'superseded' });
		return new Promise((resolve) => {
			const queued = { command: copied, authority, resolve };
			if (!workmuxRunning) {
				void executeWorkmux(queued);
				return;
			}
			pendingWorkmux?.resolve({ status: 'superseded' });
			pendingWorkmux = queued;
		});
	};

	const reloadConfig = async (): Promise<ShellKeyboardRemoteOutcome> => {
		if (disposed) return { status: 'unavailable' };
		reloadCancellation?.settle({ status: 'superseded' });
		const cancellation = createKeyboardRemoteCancellation();
		reloadCancellation = cancellation;
		const requestGeneration = ++reloadGeneration;
		try {
			closeCommandMenu();
		} catch (error) {
			safeWarn('Failed to close command menu before config reload', error);
		}
		if (disposed) return { status: 'unavailable' };
		if (requestGeneration !== reloadGeneration) {
			return { status: 'superseded' };
		}
		const authority = captureAuthority();
		if (!authority) return { status: disposed ? 'unavailable' : 'superseded' };
		const requestIsCurrent = () =>
			requestGeneration === reloadGeneration && isCurrent(authority);
		try {
			let reloadPending: PromiseLike<ShellConfigState>;
			try {
				reloadPending = reloadRuntimeShellConfig();
			} catch (error) {
				reloadPending = Promise.reject(error);
			}
			const raced = await Promise.race([
				Promise.resolve(reloadPending).then(
					(value) => ({ kind: 'value' as const, value }),
					(error: unknown) => ({ kind: 'error' as const, error }),
				),
				cancellation.promise.then((outcome) => ({
					kind: 'cancelled' as const,
					outcome,
				})),
			]);
			if (raced.kind === 'cancelled') return raced.outcome;
			if (raced.kind === 'error') throw raced.error;
			const nextState = raced.value;
			if (!requestIsCurrent()) return { status: 'superseded' };
			keyboardState.setShellConfigState(nextState);
			if (!requestIsCurrent()) return { status: 'superseded' };
			safeAlert(
				'Config reloaded',
				`Loaded ${nextState.config.version} from GitHub.`,
			);
			return requestIsCurrent()
				? { status: 'handled' }
				: { status: 'superseded' };
		} catch (error) {
			if (!requestIsCurrent()) return { status: 'superseded' };
			const message =
				error instanceof Error ? error.message : 'Unable to reload config.';
			let current: ShellConfigState;
			try {
				current = keyboardState.getSnapshot().shellConfigState;
			} catch (stateError) {
				safeWarn(
					'Failed to read config state after remote reload failure',
					stateError,
				);
				if (!requestIsCurrent()) return { status: 'superseded' };
				safeAlert('Config reload failed', message);
				return requestIsCurrent()
					? { status: 'failed' }
					: { status: 'superseded' };
			}
			if (!requestIsCurrent()) return { status: 'superseded' };
			try {
				keyboardState.setShellConfigState({ ...current, lastError: message });
			} catch (stateError) {
				safeWarn('Failed to apply remote config reload failure', stateError);
				if (!requestIsCurrent()) return { status: 'superseded' };
				safeAlert('Config reload failed', message);
				return requestIsCurrent()
					? { status: 'failed' }
					: { status: 'superseded' };
			}
			if (!requestIsCurrent()) return { status: 'superseded' };
			safeAlert('Config reload failed', message);
			return requestIsCurrent()
				? { status: 'failed' }
				: { status: 'superseded' };
		}
	};

	const restartCodexCommand = async (options?: {
		timeoutMs?: number;
	}): Promise<ShellKeyboardRemoteOutcome> => {
		const copiedOptions =
			options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
		if (disposed) return { status: 'unavailable' };
		try {
			closeCommandMenu();
		} catch (error) {
			safeWarn('Failed to close command menu before Codex restart', error);
		}
		if (restartInFlight !== null) return { status: 'unavailable' };
		const authority = captureAuthority();
		if (!authority) return { status: disposed ? 'unavailable' : 'superseded' };
		const requestGeneration = ++restartGeneration;
		restartInFlight = requestGeneration;
		const cancellation = createKeyboardRemoteCancellation();
		restartCancellation = cancellation;
		const requestIsCurrent = () =>
			restartInFlight === requestGeneration &&
			requestGeneration === restartGeneration &&
			isCurrent(authority);
		let result: { status: 'handled' | 'failed' };
		let outcome: ShellKeyboardRemoteOutcome = { status: 'superseded' };
		try {
			let restartPromise: Promise<{ status: 'handled' | 'failed' }>;
			try {
				restartPromise = Promise.resolve(
					restartCodex({
						tmuxEnabled: authority.target.tmuxEnabled,
						sessionName: authority.target.sessionName,
						workmuxControlChannel: {
							command: (argv, commandOptions) => {
								if (!requestIsCurrent()) {
									return Promise.resolve({
										success: false as const,
										output: '',
										error: 'superseded',
									});
								}
								return authority.target.workmuxControlChannel
									.command([...argv], commandOptions)
									.then(toBridgeWorkmuxResult);
							},
							operation: (request, commandOptions) => {
								if (!requestIsCurrent()) {
									return Promise.resolve({
										success: false as const,
										output: '',
										error: 'superseded',
									});
								}
								return authority.target.workmuxControlChannel
									.operation(
										{
											operation: request.operation,
											params: { ...request.params },
										},
										commandOptions,
									)
									.then(toBridgeWorkmuxResult);
							},
						},
						showFailure: (message) => {
							if (!requestIsCurrent()) {
								safeWarn('Codex restart failed after becoming stale', message);
								return;
							}
							safeAlert('Codex restart failed', message);
						},
						...copiedOptions,
					}),
				);
			} catch (error) {
				restartPromise = Promise.reject(error);
			}
			const raced = await Promise.race([
				restartPromise.then(
					(value) => ({ kind: 'value' as const, value }),
					(error: unknown) => ({ kind: 'error' as const, error }),
				),
				cancellation.promise.then((cancelledOutcome) => ({
					kind: 'cancelled' as const,
					outcome: cancelledOutcome,
				})),
			]);
			if (raced.kind === 'cancelled') return raced.outcome;
			if (raced.kind === 'error') throw raced.error;
			result = raced.value;
		} catch (error) {
			if (requestIsCurrent()) {
				safeWarn('Codex restart failed', error);
				if (requestIsCurrent()) {
					safeAlert(
						'Codex restart failed',
						getKeyboardRemoteErrorMessage(error),
					);
				}
			}
			result = { status: 'failed' };
		} finally {
			outcome = requestIsCurrent()
				? { status: result!.status }
				: { status: 'superseded' };
			if (
				restartInFlight === requestGeneration &&
				restartGeneration === requestGeneration
			) {
				restartInFlight = null;
			}
			if (restartCancellation === cancellation) {
				restartCancellation = null;
			}
		}
		return outcome;
	};

	return {
		runWorkmuxCommand,
		reloadConfig,
		restartCodex: restartCodexCommand,
		handleCommandBridgeEntry: (entry) => {
			const copied = {
				operation: entry.operation,
				...(entry.timeoutMs === undefined
					? {}
					: { timeoutMs: entry.timeoutMs }),
			};
			if (disposed) return Promise.resolve({ status: 'unavailable' });
			if (copied.operation === 'codex.restart') {
				return restartCodexCommand(
					copied.timeoutMs === undefined
						? undefined
						: { timeoutMs: copied.timeoutMs },
				);
			}
			safeWarn('Unhandled command bridge operation', copied.operation);
			return Promise.resolve({ status: 'unavailable' });
		},
		setTargetContext: (nextContext) => {
			if (disposed) return;
			const copied = copyKeyboardRemoteTarget(nextContext);
			if (isSameKeyboardRemoteTarget(target, copied)) return;
			advanceGeneration();
			target = copied;
			runner = createRunner();
		},
		invalidate: () => {
			if (disposed) return;
			advanceGeneration();
			runner = createRunner();
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			runner.invalidate();
			activeWorkmux?.resolve({ status: 'superseded' });
			activeWorkmux = null;
			activeWorkmuxAuthority = null;
			workmuxRunning = false;
			pendingWorkmux?.resolve({ status: 'superseded' });
			pendingWorkmux = null;
			reloadCancellation?.settle({ status: 'unavailable' });
			reloadCancellation = null;
			restartCancellation?.settle({ status: 'unavailable' });
			restartCancellation = null;
			generation += 1;
			reloadGeneration += 1;
			restartGeneration += 1;
			restartInFlight = null;
		},
	};
}
