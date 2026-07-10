import { useIsFocused } from '@react-navigation/native';
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import {
	createShellActivityControllerCore,
	type ShellActivitySnapshot,
} from './activity-core';
import { createReplaySafeDisposer } from './controller-core';

export type ShellActivityControllerHandle = {
	snapshot: ShellActivitySnapshot;
	getSnapshot(): ShellActivitySnapshot;
	subscribe(listener: () => void): () => void;
};

export function useShellActivityController(): ShellActivityControllerHandle {
	const focused = useIsFocused();
	const [core] = useState(() =>
		createShellActivityControllerCore({
			focused,
			appState: AppState.currentState,
		}),
	);
	const [coreLifecycle] = useState(() =>
		createReplaySafeDisposer(core.dispose),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);

	useLayoutEffect(() => core.setFocused(focused), [core, focused]);
	useEffect(() => {
		// eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener -- React Native AppState cleans up via subscription.remove()
		const subscription = AppState.addEventListener('change', core.setAppState);
		return () => subscription.remove();
	}, [core]);
	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	return useMemo(
		() => ({
			snapshot,
			getSnapshot: core.getSnapshot,
			subscribe: core.subscribe,
		}),
		[core, snapshot],
	);
}
