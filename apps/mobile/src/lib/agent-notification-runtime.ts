import { create } from 'zustand';

type ForegroundServiceRuntimeState = {
	started: boolean;
	setStarted: (started: boolean) => void;
};

export const useForegroundServiceRuntimeStore =
	create<ForegroundServiceRuntimeState>((set) => ({
		started: false,
		setStarted: (started) => set({ started }),
	}));

export function canRunAndroidBackgroundWork(input: {
	platformOS: string;
	foregroundServiceStarted: boolean;
}) {
	return input.platformOS === 'android' && input.foregroundServiceStarted;
}

export function shouldRunForegroundService(input: {
	shellCount: number;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
}) {
	return input.shellCount > 0 || input.isAutoConnecting || input.isReconnecting;
}

export function shouldStartForegroundService(input: {
	currentKey: string | null;
	nextKey: string;
	foregroundServiceStarted: boolean;
}) {
	return input.currentKey !== input.nextKey || !input.foregroundServiceStarted;
}

export function shouldPreserveForegroundServiceForShellDrop(input: {
	platformOS: string;
	appActive: boolean;
	backgroundWorkAllowed: boolean;
	previousShellCount: number;
	nextShellCount: number;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
}) {
	return (
		input.platformOS === 'android' &&
		!input.appActive &&
		input.backgroundWorkAllowed &&
		input.previousShellCount > 0 &&
		input.nextShellCount === 0 &&
		!input.isAutoConnecting &&
		!input.isReconnecting
	);
}

export function shouldStopReconnectOnBackground(input: {
	platformOS: string;
	backgroundWorkAllowed: boolean;
}) {
	return input.platformOS !== 'android' || !input.backgroundWorkAllowed;
}

export function shouldWaitForForegroundServiceCoverage(input: {
	platformOS: string;
	appActive: boolean;
	backgroundWorkAllowed: boolean;
	foregroundServiceRequired: boolean;
}) {
	return (
		input.platformOS === 'android' &&
		!input.appActive &&
		!input.backgroundWorkAllowed &&
		input.foregroundServiceRequired
	);
}

export function canAttemptBackgroundReconnect(input: {
	platformOS: string;
	appActive: boolean;
	backgroundWorkAllowed: boolean;
}) {
	return input.appActive || input.backgroundWorkAllowed;
}

export function shouldPreservePendingWithoutTarget(input: {
	previousShellCount: number;
	shellCount: number;
	appActive: boolean;
	androidBackgroundWorkAllowed: boolean;
	isReconnecting: boolean;
}) {
	if (input.shellCount !== 0) return false;
	if (!(input.appActive || input.androidBackgroundWorkAllowed)) return false;
	return input.previousShellCount > 0 || input.isReconnecting;
}

export function shouldPreservePendingWithoutConfiguredTarget(input: {
	reconnectExpected: boolean;
	hasShell: boolean;
	hasConnection: boolean;
	settingsLoaded: boolean;
}) {
	return (
		input.reconnectExpected ||
		(input.hasShell && input.hasConnection && !input.settingsLoaded)
	);
}

export function canRunAgentNotificationBridge(input: {
	platformOS: string;
	appActive: boolean;
	foregroundServiceStarted: boolean;
}) {
	return (
		input.platformOS === 'android' &&
		(input.appActive ||
			canRunAndroidBackgroundWork({
				platformOS: input.platformOS,
				foregroundServiceStarted: input.foregroundServiceStarted,
			}))
	);
}

export function shouldClearPendingAgentNotifications(input: {
	hasListenerTarget: boolean;
	hasConfiguredTarget: boolean;
	reconnectExpected?: boolean;
}) {
	return (
		!input.hasListenerTarget &&
		!input.hasConfiguredTarget &&
		!input.reconnectExpected
	);
}

export function shouldClearPendingAgentNotificationsForResumeKeyChange(input: {
	previousResumeKey: string | null;
	nextResumeKey: string | null;
	reconnectExpected?: boolean;
}) {
	if (
		input.reconnectExpected &&
		input.previousResumeKey !== null &&
		input.nextResumeKey === null
	) {
		return false;
	}
	return (
		input.previousResumeKey !== null &&
		input.previousResumeKey !== input.nextResumeKey
	);
}

export function getNextConfiguredResumeKey(input: {
	previousResumeKey: string | null;
	nextResumeKey: string | null;
	reconnectExpected?: boolean;
}) {
	if (
		input.reconnectExpected &&
		input.previousResumeKey !== null &&
		input.nextResumeKey === null
	) {
		return input.previousResumeKey;
	}
	return input.nextResumeKey;
}

export function createAgentNotificationRestartCoordinator(input: {
	maxAttempts: number;
	delaysMs: readonly number[];
	healthyResetMs?: number;
}) {
	let attempts = 0;
	const healthyResetMs = input.healthyResetMs ?? 0;
	return {
		get attempts() {
			return attempts;
		},
		consume() {
			if (attempts >= input.maxAttempts) return null;
			const attempt = attempts;
			attempts += 1;
			const delayMs =
				input.delaysMs[Math.min(attempt, input.delaysMs.length - 1)] ?? 0;
			return { attempt, delayMs };
		},
		reset() {
			attempts = 0;
		},
		resetIfHealthy(input: { nowMs: number; startedAtMs: number | null }) {
			if (input.startedAtMs === null) return false;
			if (input.nowMs - input.startedAtMs < healthyResetMs) return false;
			attempts = 0;
			return true;
		},
	};
}

export type ForegroundServiceStartRequest = {
	id: number;
	key: string;
};

export function createForegroundServiceStartCoordinator() {
	let currentId = 0;
	return {
		begin(key: string): ForegroundServiceStartRequest {
			currentId += 1;
			return { id: currentId, key };
		},
		invalidate() {
			currentId += 1;
		},
		isCurrent(
			request: ForegroundServiceStartRequest,
			currentKey: string | null,
		) {
			return request.id === currentId && request.key === currentKey;
		},
	};
}
