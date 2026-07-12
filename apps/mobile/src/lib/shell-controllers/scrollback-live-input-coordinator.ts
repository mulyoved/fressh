import {
	buildWorkmuxScrollbackLiveInputSendPlan,
	runWorkmuxScrollbackLiveInputSendPlan,
} from '../workmux-scrollback-live-input';
import { type ControllerOutcome } from './controller-core';
import {
	type ShellLiveInputOptions,
	type ShellScrollbackContext,
} from './scrollback-contracts';
import { type TerminalInputLease } from './terminal-transport';

type LiveInputContext = Pick<
	ShellScrollbackContext,
	| 'getActivitySnapshot'
	| 'getErrorMessage'
	| 'logger'
	| 'targetKey'
	| 'targetName'
	| 'terminalTransport'
> & {
	terminalView: Pick<
		ShellScrollbackContext['terminalView'],
		'getRuntimeInstanceId' | 'getRuntimeKey'
	>;
};

type LiveInputState = {
	context: LiveInputContext | null;
	disposed: boolean;
	liveInputGeneration: number;
	localModeRevision: number;
	remoteCopyModeActive: boolean;
	remoteCopyModeGeneration: number;
	runtimeInstanceId: string | null;
	scrollbackActive: boolean;
	scrollbackPhase: 'dragging' | 'active';
	targetOwnershipRevision: number;
};

export type ScrollbackLiveInputAuthority = Readonly<{
	localModeRevision: number;
	localModeSnapshot: Readonly<{
		active: boolean;
		phase: 'dragging' | 'active';
	}>;
	remoteCopyModeGeneration: number;
	targetOwnershipRevision: number;
}>;

export type ScrollbackLiveInputCleanupStart = Readonly<{
	authority: ScrollbackLiveInputAuthority;
	cleanup: Promise<boolean> | null;
}>;

type LiveInputToken = Readonly<{
	activityGeneration: number;
	context: LiveInputContext;
	lease: TerminalInputLease;
	liveInputGeneration: number;
	localModeRevision: number;
	localModeSnapshot: Readonly<{
		active: boolean;
		phase: 'dragging' | 'active';
	}>;
	remoteCopyModeGeneration: number;
	runtimeInstanceId: string;
	runtimeKey: string;
	targetOwnershipRevision: number;
}>;

const unavailable = { status: 'unavailable' } as const;
const superseded = { status: 'superseded' } as const;
const completed = { status: 'completed' } as const;

export function createScrollbackLiveInputCoordinator({
	advanceFreshness,
	clearInactive,
	getCurrentCleanup,
	getCurrentState,
	scrollbackExitDelayMs,
	scrollbackExitKeyPayload,
	startCleanup,
}: {
	advanceFreshness(): void;
	clearInactive(): Promise<boolean> | null;
	getCurrentCleanup(): Promise<boolean> | null;
	getCurrentState(): LiveInputState;
	scrollbackExitDelayMs: number;
	scrollbackExitKeyPayload?: Uint8Array<ArrayBuffer>;
	startCleanup(): ScrollbackLiveInputCleanupStart;
}) {
	let lastInteractive: boolean | null = null;
	let activityInvocationEpoch = 0;
	let lastActivityGeneration: number | null = null;
	const warn = (
		context: LiveInputContext,
		message: string,
		error: unknown,
	): void => {
		try {
			context.logger.warn(message, error);
		} catch {
			// Live input ownership must not depend on diagnostic callbacks.
		}
	};

	const isTokenAuthorityCurrent = (token: LiveInputToken): boolean => {
		const current = getCurrentState();
		return (
			!current.disposed &&
			current.context === token.context &&
			current.liveInputGeneration === token.liveInputGeneration &&
			current.runtimeInstanceId === token.runtimeInstanceId &&
			current.targetOwnershipRevision === token.targetOwnershipRevision
		);
	};
	const isInternalTokenCurrent = (token: LiveInputToken): boolean => {
		const current = getCurrentState();
		return (
			isTokenAuthorityCurrent(token) &&
			current.localModeRevision === token.localModeRevision &&
			current.scrollbackActive === token.localModeSnapshot.active &&
			current.scrollbackPhase === token.localModeSnapshot.phase &&
			current.remoteCopyModeGeneration === token.remoteCopyModeGeneration
		);
	};

	const isTokenCurrent = (token: LiveInputToken): boolean => {
		if (!isInternalTokenCurrent(token)) return false;
		let activity;
		try {
			activity = token.context.getActivitySnapshot();
		} catch (error) {
			warn(
				token.context,
				'Failed to read shell activity for live input',
				error,
			);
			return false;
		}
		if (!isInternalTokenCurrent(token)) return false;
		if (
			!activity.focused ||
			!activity.appActive ||
			!activity.interactive ||
			activity.generation !== token.activityGeneration
		) {
			return false;
		}
		let leaseCurrent = false;
		try {
			leaseCurrent = token.context.terminalTransport.isLeaseCurrent(
				token.lease,
			);
		} catch (error) {
			warn(token.context, 'Failed to validate terminal input lease', error);
			return false;
		}
		if (!leaseCurrent || !isInternalTokenCurrent(token)) return false;
		let runtimeInstanceId: string | null;
		let runtimeKey: string | null;
		try {
			runtimeInstanceId = token.context.terminalView.getRuntimeInstanceId();
		} catch (error) {
			warn(token.context, 'Failed to read terminal runtime instance', error);
			return false;
		}
		if (!isInternalTokenCurrent(token)) return false;
		try {
			runtimeKey = token.context.terminalView.getRuntimeKey();
		} catch (error) {
			warn(token.context, 'Failed to read terminal runtime key', error);
			return false;
		}
		return (
			isInternalTokenCurrent(token) &&
			runtimeInstanceId === token.runtimeInstanceId &&
			runtimeKey === token.runtimeKey
		);
	};

	const captureToken = (): LiveInputToken | null => {
		const state = getCurrentState();
		const context = state.context;
		if (
			state.disposed ||
			context === null ||
			state.runtimeInstanceId === null
		) {
			return null;
		}
		let activity;
		try {
			activity = context.getActivitySnapshot();
		} catch (error) {
			warn(context, 'Failed to read shell activity for live input', error);
			return null;
		}
		if (
			getCurrentState().context !== context ||
			!activity.focused ||
			!activity.appActive ||
			!activity.interactive
		) {
			return null;
		}
		let runtimeInstanceId: string | null;
		let runtimeKey: string | null;
		try {
			runtimeInstanceId = context.terminalView.getRuntimeInstanceId();
		} catch (error) {
			warn(context, 'Failed to read terminal runtime instance', error);
			return null;
		}
		if (getCurrentState().context !== context) return null;
		try {
			runtimeKey = context.terminalView.getRuntimeKey();
		} catch (error) {
			warn(context, 'Failed to read terminal runtime key', error);
			return null;
		}
		if (
			getCurrentState().context !== context ||
			runtimeInstanceId !== state.runtimeInstanceId ||
			runtimeKey === null
		) {
			return null;
		}
		let lease: TerminalInputLease | null;
		try {
			lease = context.terminalTransport.captureLease();
		} catch (error) {
			warn(context, 'Failed to capture terminal input lease', error);
			return null;
		}
		if (lease === null || getCurrentState().context !== context) return null;
		const validatedState = getCurrentState();
		const token = {
			activityGeneration: activity.generation,
			context,
			lease,
			liveInputGeneration: state.liveInputGeneration,
			localModeRevision: validatedState.localModeRevision,
			localModeSnapshot: {
				active: validatedState.scrollbackActive,
				phase: validatedState.scrollbackPhase,
			},
			remoteCopyModeGeneration: validatedState.remoteCopyModeGeneration,
			runtimeInstanceId,
			runtimeKey,
			targetOwnershipRevision: state.targetOwnershipRevision,
		};
		return isTokenCurrent(token) ? token : null;
	};

	const formatFailure = (
		token: LiveInputToken,
		error: unknown,
	): ControllerOutcome<{ message: string }> => {
		if (!isTokenCurrent(token)) return superseded;
		let message: string;
		try {
			message = token.context.getErrorMessage(error);
		} catch (formatterError) {
			warn(
				token.context,
				'Failed to format terminal send failure',
				formatterError,
			);
			message = error instanceof Error ? error.message : String(error);
		}
		if (!isTokenCurrent(token)) return superseded;
		return { status: 'failed', failure: { message } };
	};

	const sendSegments = async (
		segments: readonly Uint8Array<ArrayBuffer>[],
		options?: ShellLiveInputOptions,
	): Promise<ControllerOutcome<{ message: string }>> => {
		const payloadSnapshot = segments.map((segment) => new Uint8Array(segment));
		const capturedToken = captureToken();
		if (capturedToken === null) return unavailable;
		let token: LiveInputToken = capturedToken;
		const planState = getCurrentState();
		if (!isTokenCurrent(token)) return superseded;
		const plan = buildWorkmuxScrollbackLiveInputSendPlan({
			interSegmentDelayMs: options?.interSegmentDelayMs,
			payloadSegments: payloadSnapshot,
			scrollbackActive:
				planState.scrollbackActive || planState.remoteCopyModeActive,
			scrollbackExitDelayMs,
			scrollbackExitKeyPayload,
		});
		if (plan.segments.length === 0 && !plan.clearScrollback) return unavailable;
		let currentCleanup: Promise<boolean> | null;
		try {
			currentCleanup = getCurrentCleanup();
		} catch (error) {
			warn(token.context, 'Failed to read scrollback cleanup barrier', error);
			return isTokenCurrent(token) ? unavailable : superseded;
		}
		if (!isTokenCurrent(token)) return superseded;
		const startTokenCleanup = (): Promise<boolean> | null => {
			const started = startCleanup();
			if (
				isTokenAuthorityCurrent(token) &&
				started.authority.targetOwnershipRevision ===
					token.targetOwnershipRevision
			) {
				token = {
					...token,
					localModeRevision: started.authority.localModeRevision,
					localModeSnapshot: started.authority.localModeSnapshot,
					remoteCopyModeGeneration: started.authority.remoteCopyModeGeneration,
				};
			}
			return getCurrentCleanup() ?? started.cleanup;
		};

		if (plan.segments.length === 0) {
			let barrier: Promise<boolean> | null;
			try {
				barrier = runWorkmuxScrollbackLiveInputSendPlan({
					currentCleanup,
					isRequestCurrent: () => isTokenCurrent(token),
					plan,
					remoteCopyModeActive: planState.remoteCopyModeActive,
					sendSegments: async () => {},
					startCleanup: startTokenCleanup,
				});
			} catch (error) {
				warn(token.context, 'Failed to start scrollback cleanup', error);
				return isTokenCurrent(token) ? unavailable : superseded;
			}
			if (planState.remoteCopyModeActive && barrier === null)
				return unavailable;
			if (barrier !== null) {
				try {
					if (!(await barrier)) {
						return isTokenCurrent(token) ? unavailable : superseded;
					}
				} catch {
					return isTokenCurrent(token) ? unavailable : superseded;
				}
			}
			if (!isTokenCurrent(token)) return superseded;
			try {
				options?.onAccepted?.();
			} catch (error) {
				warn(
					token.context,
					'Scrollback input acceptance callback failed',
					error,
				);
			}
			return isTokenCurrent(token) ? completed : superseded;
		}

		return new Promise((resolve) => {
			let settled = false;
			let sendStarted = false;
			const settle = (outcome: ControllerOutcome<{ message: string }>) => {
				if (settled) return;
				settled = true;
				resolve(outcome);
			};
			let barrier: Promise<boolean> | null;
			try {
				barrier = runWorkmuxScrollbackLiveInputSendPlan({
					currentCleanup,
					isRequestCurrent: () => isTokenCurrent(token),
					onPayloadAccepted: () => {
						if (!isTokenCurrent(token)) return;
						try {
							options?.onAccepted?.();
						} catch (error) {
							warn(
								token.context,
								'Scrollback input acceptance callback failed',
								error,
							);
						}
					},
					plan,
					remoteCopyModeActive: planState.remoteCopyModeActive,
					sendSegments: async (acceptedSegments, sendOptions) => {
						sendStarted = true;
						if (!isTokenCurrent(token)) {
							settle(superseded);
							return;
						}
						try {
							await token.context.terminalTransport.sendBatch(
								token.lease,
								acceptedSegments,
								{
									interSegmentDelayMs: sendOptions?.interSegmentDelayMs,
									isCurrent: () => isTokenCurrent(token),
								},
							);
							settle(isTokenCurrent(token) ? completed : superseded);
						} catch (error) {
							settle(formatFailure(token, error));
						}
					},
					startCleanup: startTokenCleanup,
				});
			} catch (error) {
				warn(token.context, 'Failed to start scrollback live input', error);
				settle(isTokenCurrent(token) ? unavailable : superseded);
				return;
			}
			if (barrier === null && !sendStarted) {
				settle(isTokenCurrent(token) ? unavailable : superseded);
				return;
			}
			if (barrier !== null) {
				void barrier.then(
					(exited) => {
						if (sendStarted || settled) return;
						settle(
							!isTokenCurrent(token)
								? superseded
								: exited
									? superseded
									: unavailable,
						);
					},
					() => settle(isTokenCurrent(token) ? unavailable : superseded),
				);
			}
		});
	};

	const onActivityChanged = (): void => {
		const invocationEpoch = ++activityInvocationEpoch;
		const state = getCurrentState();
		if (state.disposed || state.context === null) return;
		let activity: ReturnType<LiveInputContext['getActivitySnapshot']>;
		try {
			activity = state.context.getActivitySnapshot();
		} catch (error) {
			warn(state.context, 'Failed to read scrollback activity', error);
			return;
		}
		if (
			activityInvocationEpoch !== invocationEpoch ||
			getCurrentState().context !== state.context
		)
			return;
		lastActivityGeneration = activity.generation;
		const previous = lastInteractive;
		lastInteractive = activity.interactive;
		if (previous !== true || activity.interactive) return;
		advanceFreshness();
		if (
			activityInvocationEpoch !== invocationEpoch ||
			getCurrentState().context !== state.context ||
			lastActivityGeneration !== activity.generation
		)
			return;
		let cleanup: Promise<boolean> | null;
		try {
			cleanup = clearInactive();
		} catch (error) {
			warn(state.context, 'Workmux inactive scrollback cleanup failed', error);
			return;
		}
		void cleanup?.catch(() => {
			// The cleanup coordinator owns exactly-once diagnostic attribution.
		});
	};

	return { onActivityChanged, sendSegments };
}
