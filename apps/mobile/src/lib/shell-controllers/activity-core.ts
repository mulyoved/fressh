import {
	createControllerPublisher,
	type ControllerCore,
	type ControllerInvalidationReason,
} from './controller-core';

export type ShellActivitySnapshot = {
	focused: boolean;
	appState: string;
	appActive: boolean;
	interactive: boolean;
	generation: number;
};

export type ShellActivityControllerCore =
	ControllerCore<ShellActivitySnapshot> & {
		setFocused(focused: boolean): void;
		setAppState(appState: string): void;
	};

export function createShellActivityControllerCore(input: {
	focused: boolean;
	appState: string;
}): ShellActivityControllerCore {
	const appActive = input.appState === 'active';
	const publisher = createControllerPublisher<ShellActivitySnapshot>({
		focused: input.focused,
		appState: input.appState,
		appActive,
		interactive: input.focused && appActive,
		generation: 0,
	});
	let disposed = false;

	const publishSignals = (focused: boolean, appState: string): void => {
		if (disposed) return;
		const current = publisher.getSnapshot();
		if (current.focused === focused && current.appState === appState) return;

		const nextAppActive = appState === 'active';
		const nextInteractive = focused && nextAppActive;
		publisher.publish({
			focused,
			appState,
			appActive: nextAppActive,
			interactive: nextInteractive,
			generation:
				current.generation + (current.interactive === nextInteractive ? 0 : 1),
		});
	};

	const setFocused = (focused: boolean): void => {
		publishSignals(focused, publisher.getSnapshot().appState);
	};

	const setAppState = (appState: string): void => {
		publishSignals(publisher.getSnapshot().focused, appState);
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setFocused,
		setAppState,
		invalidate: (reason: ControllerInvalidationReason) => {
			if (reason === 'focus-lost') {
				setFocused(false);
			} else if (reason === 'app-inactive') {
				setAppState('inactive');
			}
		},
		dispose: () => {
			if (disposed) return;
			setFocused(false);
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
