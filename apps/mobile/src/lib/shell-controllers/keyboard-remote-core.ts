import { restartCodexWithBridge } from '@/lib/codex-restart';
import {
	createWorkmuxKeyboardCommandRunner,
	type WorkmuxKeyboardCommand,
	type WorkmuxKeyboardCommandRunResult,
} from '@/lib/keyboard-actions';
import { type CommandBridgeEntry } from '@/lib/shell-config';
import { type ShellConfigState } from '@/lib/shell-config-store';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { type WorkmuxControlChannel } from '@/lib/workmux-control-channel';
import {
	runShellWorkmuxKeyboardCommand,
	showShellWorkmuxKeyboardFailure,
} from '../../app/shell/shell-workmux-keyboard-policy';

import { type ControllerInvalidationReason } from './controller-core';
import { type ShellKeyboardStateCore } from './keyboard-state-core';

type RemoteOutcome =
	| { status: 'handled' }
	| { status: 'failed' }
	| { status: 'superseded' }
	| { status: 'unavailable' };

export type ShellKeyboardRemoteActivitySnapshot = {
	focused: boolean;
	appActive: boolean;
	interactive: boolean;
	generation: number;
};

export type ShellKeyboardRemoteTargetContext = {
	targetKey: string;
	tmuxEnabled: boolean;
	sessionName: string;
	connectionId: string;
	channelId: number;
	workmuxControlChannel: Pick<WorkmuxControlChannel, 'command' | 'operation'>;
	source: unknown;
};

export type ShellKeyboardRemoteLogger = {
	info(message: string, details?: unknown): void;
	warn(message: string, details?: unknown): void;
};

export type ShellKeyboardRemoteCore = {
	runWorkmuxCommand(
		command: WorkmuxKeyboardCommand,
	): Promise<WorkmuxKeyboardCommandRunResult>;
	reloadConfig(): Promise<RemoteOutcome>;
	restartCodex(options?: { timeoutMs?: number }): Promise<RemoteOutcome>;
	handleCommandBridgeEntry(entry: CommandBridgeEntry): Promise<RemoteOutcome>;
	setTargetContext(context: ShellKeyboardRemoteTargetContext): void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export type CreateShellKeyboardRemoteCoreOptions = {
	initialTargetContext: ShellKeyboardRemoteTargetContext;
	getActivitySnapshot(): ShellKeyboardRemoteActivitySnapshot;
	getNavScope(): WorkmuxNavScope;
	keyboardState: Pick<
		ShellKeyboardStateCore,
		'getSnapshot' | 'setShellConfigState'
	>;
	reloadRuntimeShellConfig(): PromiseLike<ShellConfigState>;
	closeCommandMenu(): void;
	showAlert(title: string, message: string): void;
	invalidateShellTransport(connectionId: string, channelId: number): void;
	logger?: ShellKeyboardRemoteLogger;
	now?: () => number;
	restartCodex?: typeof restartCodexWithBridge;
};

type Authority = {
	generation: number;
	activityGeneration: number;
	target: ShellKeyboardRemoteTargetContext;
};

function copyTarget(
	context: ShellKeyboardRemoteTargetContext,
): ShellKeyboardRemoteTargetContext {
	return { ...context };
}

function sameTarget(
	left: ShellKeyboardRemoteTargetContext,
	right: ShellKeyboardRemoteTargetContext,
): boolean {
	return (
		left.targetKey === right.targetKey &&
		left.tmuxEnabled === right.tmuxEnabled &&
		left.sessionName === right.sessionName &&
		left.connectionId === right.connectionId &&
		left.channelId === right.channelId &&
		left.workmuxControlChannel === right.workmuxControlChannel &&
		left.source === right.source
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
	let target = copyTarget(initialTargetContext);
	let reloadGeneration = 0;
	let restartGeneration = 0;
	let restartInFlight: number | null = null;
	let activeWorkmuxAuthority: Authority | null = null;
	let workmuxRunning = false;
	let pendingWorkmux: {
		command: WorkmuxKeyboardCommand;
		authority: Authority;
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
	const captureAuthority = (): Authority | null => {
		if (disposed) return null;
		const startingGeneration = generation;
		const startingTarget = copyTarget(target);
		const activity = readActivity();
		if (
			!activity?.interactive ||
			disposed ||
			startingGeneration !== generation ||
			!sameTarget(startingTarget, target)
		) {
			return null;
		}
		return {
			generation: startingGeneration,
			activityGeneration: activity.generation,
			target: startingTarget,
		};
	};
	const isCurrent = (authority: Authority): boolean => {
		if (
			disposed ||
			authority.generation !== generation ||
			!sameTarget(authority.target, target)
		) {
			return false;
		}
		const activity = readActivity();
		return Boolean(
			activity?.interactive &&
				activity.generation === authority.activityGeneration &&
				!disposed &&
				authority.generation === generation &&
				sameTarget(authority.target, target),
		);
	};

	const createRunner = () => {
		const runnerTarget = copyTarget(target);
		const runnerGeneration = generation;
		const runnerIsCurrent = () =>
			!disposed &&
			runnerGeneration === generation &&
			sameTarget(runnerTarget, target);
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
				return runShellWorkmuxKeyboardCommand({
					argv: commandArgv,
					runCommand: async (nextArgv, options) => {
						try {
							const result = await runnerTarget.workmuxControlChannel.command(
								[...nextArgv],
								options,
							);
							if (commandIsCurrent()) {
								const finishedAtMs = readClock();
								if (!commandIsCurrent()) return result;
								safeInfo('Workmux keyboard command result', {
									connectionId: runnerTarget.connectionId,
									channelId: runnerTarget.channelId,
									argv: [...nextArgv],
									timeoutMs: options.timeoutMs,
									...(startedAtMs === null || finishedAtMs === null
										? {}
										: { elapsedMs: finishedAtMs - startedAtMs }),
									success: result.success,
									failureClass: result.failureClass,
									error: result.error,
									outputBytes: result.output.length,
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
									argv: [...nextArgv],
									timeoutMs: options.timeoutMs,
									...(startedAtMs === null || failedAtMs === null
										? {}
										: { elapsedMs: failedAtMs - startedAtMs }),
									error: errorMessage(error),
								});
							}
							throw error;
						}
					},
					timeoutMs,
				});
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
			getErrorMessage: errorMessage,
		});
	};

	let runner = createRunner();
	const advanceGeneration = () => {
		runner.invalidate();
		pendingWorkmux?.resolve({ status: 'superseded' });
		pendingWorkmux = null;
		generation += 1;
		reloadGeneration += 1;
		restartGeneration += 1;
		restartInFlight = null;
	};

	const executeWorkmux = async (queued: {
		command: WorkmuxKeyboardCommand;
		authority: Authority;
		resolve(result: WorkmuxKeyboardCommandRunResult): void;
	}): Promise<void> => {
		workmuxRunning = true;
		let current: typeof queued | null = queued;
		try {
			while (current) {
				activeWorkmuxAuthority = current.authority;
				let result: WorkmuxKeyboardCommandRunResult;
				try {
					result = isCurrent(current.authority)
						? await runner.run(current.command)
						: { status: 'superseded' };
				} catch (error) {
					safeWarn('Workmux keyboard command runner failed', error);
					result = isCurrent(current.authority)
						? { status: 'handled' }
						: { status: 'superseded' };
				}
				current.resolve(
					isCurrent(current.authority) ? result : { status: 'superseded' },
				);
				current = pendingWorkmux;
				pendingWorkmux = null;
			}
		} finally {
			activeWorkmuxAuthority = null;
			workmuxRunning = false;
			const next = pendingWorkmux;
			pendingWorkmux = null;
			if (next) void executeWorkmux(next);
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

	const reloadConfig = async (): Promise<RemoteOutcome> => {
		if (disposed) return { status: 'unavailable' };
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
			const nextState = await reloadRuntimeShellConfig();
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
	}): Promise<RemoteOutcome> => {
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
		const requestIsCurrent = () =>
			restartInFlight === requestGeneration &&
			requestGeneration === restartGeneration &&
			isCurrent(authority);
		let result: { status: 'handled' | 'failed' };
		let outcome: RemoteOutcome = { status: 'superseded' };
		try {
			result = await restartCodex({
				tmuxEnabled: authority.target.tmuxEnabled,
				sessionName: authority.target.sessionName,
				workmuxControlChannel: {
					command: (argv, commandOptions) => {
						if (!requestIsCurrent()) {
							return Promise.resolve({
								success: false,
								output: '',
								error: 'Codex restart superseded.',
							});
						}
						return authority.target.workmuxControlChannel.command(
							[...argv],
							commandOptions,
						);
					},
					operation: (request, commandOptions) => {
						if (!requestIsCurrent()) {
							return Promise.resolve({
								success: false,
								output: '',
								error: 'Codex restart superseded.',
							});
						}
						return authority.target.workmuxControlChannel.operation(
							{ operation: request.operation, params: { ...request.params } },
							commandOptions,
						);
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
			});
		} catch (error) {
			if (requestIsCurrent()) {
				safeWarn('Codex restart failed', error);
				safeAlert('Codex restart failed', errorMessage(error));
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
			const copied = copyTarget(nextContext);
			if (sameTarget(target, copied)) return;
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
			pendingWorkmux?.resolve({ status: 'superseded' });
			pendingWorkmux = null;
			generation += 1;
			reloadGeneration += 1;
			restartGeneration += 1;
			restartInFlight = null;
		},
	};
}
