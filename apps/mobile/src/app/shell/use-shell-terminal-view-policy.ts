import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import {
	configureScrollTraceEnabled,
	emitScrollTrace,
	isScrollTraceEnabled,
	type ScrollTraceSink,
} from '@/lib/scroll-trace';
import {
	resolveShellTouchScrollPolicy,
	type ShellTouchScrollPolicy,
} from './shell-touch-scroll';

type ExpoConstantsWithManifestExtra = typeof Constants & {
	manifest2?: { extra?: Record<string, unknown> };
};

function isConfiguredScrollTraceEnabled(): boolean {
	const constants = Constants as ExpoConstantsWithManifestExtra;
	const extra =
		(Constants.expoConfig?.extra as Record<string, unknown> | undefined) ??
		constants.manifest2?.extra;
	return (
		extra?.fresshEnableScrollTrace === true ||
		extra?.fresshEnableScrollTrace === 'true' ||
		isScrollTraceEnabled()
	);
}

export function useShellTerminalViewPolicy({
	hasConnection,
	tmuxEnabled,
	targetName,
}: {
	hasConnection: boolean;
	tmuxEnabled: boolean;
	targetName: string;
}): { policy: ShellTouchScrollPolicy; trace: ScrollTraceSink } {
	const { width, height } = useWindowDimensions();
	const scrollTraceEnabled = isConfiguredScrollTraceEnabled();
	useEffect(() => {
		configureScrollTraceEnabled(scrollTraceEnabled);
	}, [scrollTraceEnabled]);
	const policy = useMemo(
		() =>
			resolveShellTouchScrollPolicy({
				platformOS: Platform.OS,
				width,
				height,
				tmuxEnabled,
				hasConnection,
				scrollTraceEnabled,
				debug: __DEV__,
			}),
		[hasConnection, height, scrollTraceEnabled, tmuxEnabled, width],
	);
	const trace = useCallback<ScrollTraceSink>(
		(event) => emitScrollTrace({ targetName, ...event }),
		[targetName],
	);
	return { policy, trace };
}
