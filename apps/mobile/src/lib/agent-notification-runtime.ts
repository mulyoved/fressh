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
}) {
	return !input.hasListenerTarget && !input.hasConfiguredTarget;
}

export function shouldClearPendingAgentNotificationsForResumeKeyChange(input: {
	previousResumeKey: string | null;
	nextResumeKey: string | null;
}) {
	return (
		input.previousResumeKey !== null &&
		input.previousResumeKey !== input.nextResumeKey
	);
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
