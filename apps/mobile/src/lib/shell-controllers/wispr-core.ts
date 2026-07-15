import {
	isWisprAutomationBusy,
	resolveTextEntryWisprControl,
	resolveWisprTextEditorAvailability,
	type TextEntryWisprControl,
	type WisprAutomationFailure,
	type WisprAutomationState,
	type WisprTextEditorAvailability,
} from '../wispr-automation';
import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerOutcome,
} from './controller-core';
import { createWisprCloseCoordinator } from './wispr-close-coordinator';
import {
	type WisprNativeControlAuthority,
	type WisprNativeControlSettlement,
} from './wispr-native-control-authority';
import {
	createWisprStartProtocol,
	type WisprTextInputBounds,
} from './wispr-start-protocol';
import { createWisprTapRunner } from './wispr-tap-runner';
import { createWisprTimerOwner } from './wispr-timer-owner';

const UNAVAILABLE_MESSAGE = 'Wispr automation is unavailable.';
const UNSUPPORTED_MESSAGE = 'Wispr automation is only available on Android.';

export type TextInputScreenBounds = WisprTextInputBounds;

export type ShellWisprSnapshot = {
	autoStartEnabled: boolean;
	availability: WisprTextEditorAvailability;
	automation: WisprAutomationState;
	control: TextEntryWisprControl;
	busy: boolean;
};

export type ShellWisprFailure = WisprAutomationFailure;

export type ShellWisprNativePort = {
	getStatus(): Promise<{ serviceEnabled: boolean; serviceConnected: boolean }>;
	tapControl(): Promise<unknown>;
	tapScreen(x: number, y: number): Promise<unknown>;
	openSettings(): Promise<unknown>;
};

export type ShellWisprModalPort = {
	isOpen(): boolean;
	open(): boolean;
	close(): void;
};

export type ShellWisprControllerCore = ControllerCore<ShellWisprSnapshot> & {
	openTextEditor(): Promise<ControllerOutcome<ShellWisprFailure>>;
	setAutoStart(enabled: boolean): void;
	onTextEntryFocused(value: string, bounds?: TextInputScreenBounds): void;
	onTextChanged(value: string): void;
	closeTextEntry(): void;
	openSettings(): Promise<ControllerOutcome<ShellWisprFailure>>;
};

export type CreateShellWisprControllerCoreInput = {
	native: ShellWisprNativePort;
	controlAuthority: WisprNativeControlAuthority;
	modal: ShellWisprModalPort;
	now(): number;
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
	pixelRatio(): number;
	platformOS: string;
	logger: {
		info(message: string, payload?: unknown): void;
		warn(message: string, error?: unknown): void;
	};
};

export function createShellWisprControllerCore(
	deps: CreateShellWisprControllerCoreInput,
): ShellWisprControllerCore {
	let autoStartEnabled = false;
	let availability: WisprTextEditorAvailability = { type: 'ready' };
	let sessionGeneration = 0,
		settingsGeneration = 0;
	let statusRequestId: number | null = null;
	let disposed = false;
	let automation: WisprAutomationState = { phase: 'idle' };
	let nativeTransactionOutstanding = () => false;
	const automationBusy = () =>
		isWisprAutomationBusy(automation) || nativeTransactionOutstanding();

	const snapshot = (): ShellWisprSnapshot => ({
		autoStartEnabled,
		availability,
		automation,
		control: resolveTextEntryWisprControl({
			availability,
			autoStartEnabled,
			automationState: automation,
		}),
		busy: automationBusy(),
	});
	const publisher = createControllerPublisher(snapshot());
	const safeLog = (
		level: 'info' | 'warn',
		message: string,
		value?: unknown,
	) => {
		try {
			deps.logger[level](message, value);
		} catch {
			// Logging must never alter controller state transitions.
		}
	};
	const safeCall = <T>(operation: () => T, message: string): T | false => {
		try {
			return operation();
		} catch (error) {
			safeLog('warn', message, error);
			return false;
		}
	};
	const safeModalIsOpen = () =>
		safeCall(
			() => deps.modal.isOpen(),
			'Failed to read Wispr text editor state',
		) === true;
	const safeModalOpen = () =>
		safeCall(() => deps.modal.open(), 'Failed to open Wispr text editor') ===
		true;
	const safeModalClose = () =>
		void safeCall(
			() => deps.modal.close(),
			'Failed to close Wispr text editor',
		);
	const lifecycleCurrent = (capture: number) =>
		!disposed && sessionGeneration === capture;
	const timerOwner = createWisprTimerOwner(deps);

	const tapRunner = createWisprTapRunner({
		tapControl: () => deps.native.tapControl(),
		now: deps.now,
		...timerOwner,
	});
	const nativeTimerOwner = createWisprTimerOwner(deps);
	const closeTapRunner = createWisprTapRunner({
		tapControl: () => deps.native.tapControl(),
		now: deps.now,
		...nativeTimerOwner,
	});
	const runClose = (retry: boolean) => {
		return closeTapRunner
			.run({
				retry,
				// Native cleanup outlives the UI lifecycle that requested it.
				isCurrent: () => true,
				acceptLateResult: () => true,
			})
			.then((result) => {
				if (result.status === 'completed') return true;
				if (result.status === 'failed') {
					safeLog('warn', 'Failed to close auto-started Wispr control', result);
				}
				return false;
			});
	};
	const closeCoordinator = createWisprCloseCoordinator({
		close: runClose,
		onDeferredReady: startDeferred,
		onTransactionSettled: settleNativeControl,
	});
	const startProtocol = createWisprStartProtocol({
		tapRunner,
		closeCoordinator,
		controlAuthority: deps.controlAuthority,
		tapScreen: (x, y) => deps.native.tapScreen(x, y),
		pixelRatio: deps.pixelRatio,
		...timerOwner,
		cleanupDeadlineTimers: {
			setTimeout: deps.setTimeout,
			clearTimeout: deps.clearTimeout,
		},
		modalIsOpen: safeModalIsOpen,
		autoStartEnabled: () => autoStartEnabled,
		captureLifecycle: () => sessionGeneration,
		lifecycleCurrent,
		publish: (nextAutomation) => {
			automation = nextAutomation;
			publisher.publish(snapshot());
		},
		info: (message) => safeLog('info', message),
		warn: (message, error) => safeLog('warn', message, error),
	});
	nativeTransactionOutstanding = startProtocol.hasOutstandingNativeTransaction;
	function settleNativeControl(
		requestId: number,
		settlement: WisprNativeControlSettlement,
	) {
		startProtocol.settleNativeControl(requestId, settlement);
	}
	function startDeferred() {
		const requestId = closeCoordinator.takeDeferredAutoStart();
		if (requestId != null) startProtocol.start(requestId);
	}
	const requestCurrent = (requestId: number, capture: number) =>
		lifecycleCurrent(capture) && startProtocol.isRequestCurrent(requestId);

	const retireTextEntry = (retryClose: boolean) => {
		if (disposed) return;
		safeModalClose();
		statusRequestId = null;
		const close = startProtocol.close();
		if (close.decision.type === 'close-after-start') {
			closeCoordinator.requestAfterStart({
				requestId: close.decision.requestId,
				retryClose,
			});
			startProtocol.bindIssuedStartCleanup(close.decision.requestId);
		} else if (close.decision.type === 'close-now' && close.requestId != null) {
			closeCoordinator.requestAfterStart({
				requestId: close.requestId,
				retryClose,
			});
			closeCoordinator.consumeStartResult(close.requestId, true);
		}
	};
	const closeTextEntry = () => retireTextEntry(true);
	const invalidate = () => {
		if (disposed) return;
		retireTextEntry(false);
		sessionGeneration += 1;
		statusRequestId = null;
		closeCoordinator.retireDeferredStart();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		openTextEditor: async () => {
			if (disposed) return { status: 'unavailable' };
			if (automationBusy() || statusRequestId != null) {
				safeLog('info', 'Ignoring Wispr text entry while automation is busy', {
					phase: automation.phase,
				});
				return { status: 'superseded' };
			}
			if (deps.platformOS !== 'android') {
				startProtocol.beginRequest();
				availability = {
					type: 'setup-required',
					reason: 'service-disabled',
					message: UNSUPPORTED_MESSAGE,
					openAccessibilitySettings: false,
				};
				safeModalOpen();
				startProtocol.fail({
					reason: 'unsupported-platform',
					message: UNSUPPORTED_MESSAGE,
				});
				return { status: 'unavailable' };
			}
			const requestId = startProtocol.beginRequest();
			const capture = sessionGeneration;
			statusRequestId = requestId;
			try {
				const status = await deps.native.getStatus();
				if (!requestCurrent(requestId, capture)) {
					return { status: 'superseded' };
				}
				statusRequestId = null;
				availability = resolveWisprTextEditorAvailability(status);
				if (!safeModalOpen()) throw new Error('Text entry modal unavailable');
				if (availability.type === 'setup-required') {
					startProtocol.fail({
						reason: availability.reason,
						message: availability.message,
					});
				} else {
					publisher.publish(snapshot());
					if (autoStartEnabled) startProtocol.start(requestId);
				}
				return { status: 'completed' };
			} catch (error) {
				if (!requestCurrent(requestId, capture)) {
					return { status: 'superseded' };
				}
				statusRequestId = null;
				const failure: ShellWisprFailure = {
					reason: 'service-disabled',
					message: UNAVAILABLE_MESSAGE,
				};
				availability = {
					type: 'setup-required',
					reason: 'service-disabled',
					message: failure.message,
					openAccessibilitySettings: false,
				};
				safeModalOpen();
				startProtocol.fail(failure);
				safeLog('warn', 'Wispr automation status check failed', error);
				return { status: 'failed', failure };
			}
		},
		setAutoStart: (enabled) => {
			if (disposed) return;
			autoStartEnabled = enabled;
			publisher.publish(snapshot());
			if (
				!enabled ||
				!safeModalIsOpen() ||
				availability.type !== 'ready' ||
				automationBusy()
			)
				return;
			startProtocol.start(startProtocol.beginRequest());
		},
		onTextEntryFocused: startProtocol.focus,
		onTextChanged: startProtocol.textChanged,
		closeTextEntry,
		openSettings: async () => {
			if (disposed || deps.platformOS !== 'android') {
				return { status: 'unavailable' };
			}
			const capture = sessionGeneration;
			const requestId = ++settingsGeneration;
			try {
				await deps.native.openSettings();
				if (!lifecycleCurrent(capture) || settingsGeneration !== requestId) {
					return { status: 'superseded' };
				}
				return { status: 'completed' };
			} catch (error) {
				if (!lifecycleCurrent(capture) || settingsGeneration !== requestId) {
					return { status: 'superseded' };
				}
				const failure: ShellWisprFailure = {
					reason: 'service-disabled',
					message: 'Failed to open accessibility settings.',
				};
				safeLog('warn', 'Failed to open accessibility settings', error);
				return { status: 'failed', failure };
			}
		},
		invalidate,
		dispose: () => {
			if (disposed) return;
			timerOwner.cancelAll();
			retireTextEntry(false);
			disposed = true;
			sessionGeneration += 1;
			startProtocol.dispose();
			closeCoordinator.dispose();
			safeModalClose();
			publisher.disposePublisher();
		},
	};
}
