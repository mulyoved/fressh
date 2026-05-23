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
