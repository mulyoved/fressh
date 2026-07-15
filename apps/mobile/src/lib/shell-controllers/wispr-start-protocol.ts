import {
	reduceWisprAutomationState,
	resolveWisprAutoCloseOnTextEntryClose,
	resolveWisprTapFailure,
	withTimeout,
	type WisprAutomationEvent,
	type WisprAutomationFailure,
	type WisprAutomationState,
	type WisprAutoCloseDecision,
	type WisprTimerPort,
} from '../wispr-automation';
import { type WisprCloseCoordinator } from './wispr-close-coordinator';
import {
	type WisprNativeControlAcquisition,
	type WisprNativeControlAuthority,
	type WisprNativeControlLease,
	type WisprNativeControlSettlement,
} from './wispr-native-control-authority';
import { type WisprTapRunner } from './wispr-tap-runner';

const TAP_TIMEOUT_MS = 750;
const OPENING_FALLBACK_MS = 750;
const UNCERTAIN_START_CLEANUP_TIMEOUT_MS = 5_000;
const BLOCKED_FAILURE: WisprAutomationFailure = {
	reason: 'tap-failed',
	message: 'Wispr unavailable because prior cleanup failed.',
};

export type WisprTextInputBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WisprStartClose = {
	decision: WisprAutoCloseDecision;
	requestId: number | null;
};

export type WisprStartProtocol = {
	getAutomation(): WisprAutomationState;
	getRequestGeneration(): number;
	beginRequest(): number;
	isRequestCurrent(requestId: number): boolean;
	start(requestId: number): void;
	focus(value: string, bounds?: WisprTextInputBounds): void;
	textChanged(value: string): void;
	fail(failure: WisprAutomationFailure): void;
	close(): WisprStartClose;
	bindIssuedStartCleanup(requestId: number): void;
	settleNativeControl(
		requestId: number,
		settlement: WisprNativeControlSettlement,
	): void;
	dispose(): void;
};

export type CreateWisprStartProtocolInput = WisprTimerPort & {
	cleanupDeadlineTimers: WisprTimerPort;
	tapRunner: WisprTapRunner;
	closeCoordinator: WisprCloseCoordinator;
	controlAuthority: WisprNativeControlAuthority;
	tapScreen(x: number, y: number): Promise<unknown>;
	pixelRatio(): number;
	modalIsOpen(): boolean;
	autoStartEnabled(): boolean;
	captureLifecycle(): number;
	lifecycleCurrent(capture: number): boolean;
	publish(automation: WisprAutomationState): void;
	info(message: string): void;
	warn(message: string, error: unknown): void;
};

export function createWisprStartProtocol(
	deps: CreateWisprStartProtocolInput,
): WisprStartProtocol {
	let automation: WisprAutomationState = { phase: 'idle' };
	let currentText = '';
	let requestGeneration = 0;
	let autoStartedRequestId: number | null = null;
	let tapStartedRequestId: number | null = null;
	let timedOutRequestId: number | null = null;
	let openingTimer: unknown;
	let cleanupDeadline: { requestId: number; timer: unknown } | null = null;
	let controlAcquisition: {
		requestId: number;
		acquisition: Extract<WisprNativeControlAcquisition, { status: 'waiting' }>;
	} | null = null;
	let controlLease: {
		requestId: number;
		lease: WisprNativeControlLease;
	} | null = null;
	let disposed = false;

	const getAutomation = () => automation;
	const publish = () => deps.publish(automation);
	const clearOpeningTimer = () => {
		if (openingTimer === undefined) return;
		try {
			deps.clearTimeout(openingTimer);
		} catch {
			// A failed cancellation must not keep the protocol active.
		}
		openingTimer = undefined;
	};
	const clearCleanupDeadline = (requestId: number) => {
		if (cleanupDeadline?.requestId !== requestId) return;
		const timer = cleanupDeadline.timer;
		cleanupDeadline = null;
		try {
			deps.cleanupDeadlineTimers.clearTimeout(timer);
		} catch {
			// Request identity still retires the callback if native cancellation fails.
		}
	};
	const bindIssuedStartCleanup = (requestId: number) => {
		if (controlLease?.requestId !== requestId || cleanupDeadline) return;
		try {
			const timer = deps.cleanupDeadlineTimers.setTimeout(() => {
				if (cleanupDeadline?.requestId !== requestId) return;
				cleanupDeadline = null;
				deps.closeCoordinator.expirePendingStart(requestId);
			}, UNCERTAIN_START_CLEANUP_TIMEOUT_MS);
			cleanupDeadline = { requestId, timer };
		} catch {
			deps.closeCoordinator.expirePendingStart(requestId);
		}
	};
	const apply = (event: WisprAutomationEvent) => {
		automation = reduceWisprAutomationState(automation, event);
		if (automation.phase !== 'openingTextEntry') clearOpeningTimer();
		publish();
	};
	const requestCurrent = (requestId: number, capture: number) =>
		!disposed &&
		requestGeneration === requestId &&
		deps.lifecycleCurrent(capture);
	const clearMarkers = (requestId: number) => {
		if (tapStartedRequestId === requestId) tapStartedRequestId = null;
		if (timedOutRequestId === requestId) timedOutRequestId = null;
	};
	const cancelControlAcquisition = (requestId: number) => {
		if (controlAcquisition?.requestId !== requestId) return;
		controlAcquisition.acquisition.cancel();
		controlAcquisition = null;
	};
	const releaseNativeControl = (requestId: number) => {
		if (controlLease?.requestId !== requestId) return;
		controlLease.lease.release();
		controlLease = null;
	};
	const settleNativeControl = (
		requestId: number,
		settlement: WisprNativeControlSettlement,
	) => {
		if (controlLease?.requestId !== requestId) return;
		clearCleanupDeadline(requestId);
		if (settlement === 'inactive') controlLease.lease.release();
		else controlLease.lease.poison();
		controlLease = null;
	};
	const resolveClose = () =>
		resolveWisprAutoCloseOnTextEntryClose({
			autoStartedRequestId,
			automationState: automation,
			controlTapStartedRequestId: tapStartedRequestId,
			timedOutStartRequestId: timedOutRequestId,
		});
	const handleLateStart = (requestId: number, started: boolean) => {
		clearCleanupDeadline(requestId);
		if (deps.closeCoordinator.consumeStartResult(requestId, started)) return;
		if (!started) {
			clearMarkers(requestId);
			releaseNativeControl(requestId);
			return;
		}
		if (disposed || autoStartedRequestId !== requestId) return;
		if (requestGeneration !== requestId || !deps.modalIsOpen()) return;
		timedOutRequestId = null;
		if (automation.phase === 'waitingForBubble') {
			apply({ type: 'wisprTapSucceeded' });
		} else if (automation.phase === 'failed') {
			automation = { phase: 'recording', textBeforeStart: currentText };
			publish();
		}
	};
	const runStartTap = async (requestId: number, capture: number) => {
		const acquisition = deps.controlAuthority.acquire();
		if (acquisition.status === 'waiting') {
			controlAcquisition = { requestId, acquisition };
		}
		const acquisitionOutcome =
			acquisition.status === 'acquired'
				? ({ status: 'acquired', lease: acquisition.lease } as const)
				: await acquisition.outcome;
		if (controlAcquisition?.acquisition === acquisition) {
			controlAcquisition = null;
		}
		if (acquisitionOutcome.status !== 'acquired') {
			if (autoStartedRequestId === requestId) autoStartedRequestId = null;
			clearMarkers(requestId);
			if (
				requestCurrent(requestId, capture) &&
				deps.modalIsOpen() &&
				automation.phase === 'waitingForBubble'
			) {
				automation =
					acquisitionOutcome.status === 'blocked'
						? { phase: 'failed', ...BLOCKED_FAILURE }
						: { phase: 'idle' };
				publish();
			}
			return;
		}
		controlLease = { requestId, lease: acquisitionOutcome.lease };
		if (!requestCurrent(requestId, capture) || !deps.modalIsOpen()) {
			releaseNativeControl(requestId);
			return;
		}
		let closeReconciled = false;
		const result = await deps.tapRunner.run({
			retry: true,
			isCurrent: () => requestCurrent(requestId, capture),
			// Native settlement must reconcile cleanup after the UI request retires.
			acceptLateResult: () => true,
			attempt: {
				start: () => {
					tapStartedRequestId = requestId;
				},
				settle: (settlement) => {
					clearCleanupDeadline(requestId);
					clearMarkers(requestId);
					closeReconciled =
						deps.closeCoordinator.consumeStartResult(
							requestId,
							settlement.status === 'completed',
						) || closeReconciled;
				},
			},
			onLateSuccess: () => handleLateStart(requestId, true),
			onLateFailure: () => handleLateStart(requestId, false),
		});
		if (closeReconciled) return;
		if (result.status === 'failed' && !result.uncertain) {
			releaseNativeControl(requestId);
		}
		if (!requestCurrent(requestId, capture) || !deps.modalIsOpen()) return;
		if (automation.phase !== 'waitingForBubble') return;
		if (result.status === 'completed') {
			clearMarkers(requestId);
			apply({ type: 'wisprTapSucceeded' });
		} else if (result.status === 'failed') {
			if (result.uncertain) timedOutRequestId = requestId;
			else clearMarkers(requestId);
			apply({ type: 'failed', reason: result.reason, message: result.message });
		}
	};
	const focusRequest = (
		value: string,
		bounds: WisprTextInputBounds | undefined,
		requestId: number,
		capture: number,
	) => {
		if (
			disposed ||
			automation.phase !== 'openingTextEntry' ||
			!requestCurrent(requestId, capture)
		)
			return;
		clearOpeningTimer();
		apply({ type: 'textEntryFocused', textBeforeStart: value });
		void (async () => {
			if (bounds && bounds.width > 0 && bounds.height > 0) {
				try {
					if (!requestCurrent(requestId, capture)) return;
					const ratio = deps.pixelRatio();
					const x = (bounds.x + bounds.width / 2) * ratio;
					const y = (bounds.y + Math.min(bounds.height / 2, 48)) * ratio;
					await withTimeout(deps.tapScreen(x, y), TAP_TIMEOUT_MS, deps);
					if (!requestCurrent(requestId, capture)) return;
				} catch (error) {
					if (!requestCurrent(requestId, capture)) return;
					deps.warn('Failed to prime Wispr text field', error);
				}
			}
			if (!requestCurrent(requestId, capture)) return;
			if (getAutomation().phase !== 'waitingForBubble') return;
			await runStartTap(requestId, capture);
		})();
	};
	const focus = (value: string, bounds?: WisprTextInputBounds) =>
		focusRequest(value, bounds, requestGeneration, deps.captureLifecycle());
	const start = (requestId: number) => {
		const capture = deps.captureLifecycle();
		if (
			disposed ||
			requestGeneration !== requestId ||
			!deps.autoStartEnabled() ||
			!deps.modalIsOpen()
		)
			return;
		if (deps.closeCoordinator.blocksAutoStart()) {
			deps.closeCoordinator.deferAutoStart(requestId);
			deps.info('Deferring Wispr auto-start while auto-close is pending');
			return;
		}
		autoStartedRequestId = requestId;
		tapStartedRequestId = null;
		timedOutRequestId = null;
		apply({ type: 'press' });
		if (
			!requestCurrent(requestId, capture) ||
			automation.phase !== 'openingTextEntry' ||
			!deps.modalIsOpen()
		)
			return;
		try {
			openingTimer = deps.setTimeout(
				() => focusRequest(currentText, undefined, requestId, capture),
				OPENING_FALLBACK_MS,
			);
		} catch (error) {
			apply({ type: 'failed', ...resolveWisprTapFailure(error) });
		}
	};

	return {
		getAutomation,
		getRequestGeneration: () => requestGeneration,
		beginRequest: () => ++requestGeneration,
		isRequestCurrent: (requestId) =>
			!disposed && requestGeneration === requestId,
		start,
		focus: (value, bounds) => {
			currentText = value;
			focus(value, bounds);
		},
		textChanged: (value) => {
			if (disposed) return;
			currentText = value;
			const wasRecording = automation.phase === 'recording';
			apply({ type: 'textChanged', value });
			if (wasRecording && automation.phase === 'idle') requestGeneration += 1;
		},
		fail: (failure) => apply({ type: 'failed', ...failure }),
		close: () => {
			const requestId = autoStartedRequestId;
			const decision = resolveClose();
			cancelControlAcquisition(requestId ?? -1);
			if (decision.type === 'none') {
				releaseNativeControl(requestId ?? -1);
			}
			requestGeneration += 1;
			autoStartedRequestId = null;
			clearMarkers(requestId ?? -1);
			clearOpeningTimer();
			automation = { phase: 'idle' };
			publish();
			return { decision, requestId };
		},
		bindIssuedStartCleanup,
		settleNativeControl,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			if (controlAcquisition) {
				controlAcquisition.acquisition.cancel();
				controlAcquisition = null;
			}
			requestGeneration += 1;
			clearOpeningTimer();
		},
	};
}
