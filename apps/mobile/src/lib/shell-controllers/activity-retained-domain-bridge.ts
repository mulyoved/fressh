import { type ShellActivitySnapshot } from './activity-core';
import {
	createReplaySafeDisposer,
	type ReplaySafeDisposer,
} from './controller-core';

export type ShellActivityRetainedDomainActions = {
	setupInitialKeyboard(snapshot: ShellActivitySnapshot): void;
	resumeFromAppState(snapshot: ShellActivitySnapshot): void;
	invalidateRetainedDomains(): void;
	invalidateBrowserActions(): void;
	closeBrowserActions(): void;
	invalidateKeyboardRunner(): void;
	invalidateScrollbackRequests(): void;
	clearScrollbackDirectly(): void | null | Promise<unknown>;
	runInactiveScrollbackCleanup(
		snapshot: ShellActivitySnapshot,
	): void | Promise<unknown>;
	rememberKeyboardVisibility(): void;
	cancelPendingResumeDismiss(): void;
};

export type ShellActivityRetainedDomainBridge = ReplaySafeDisposer & {
	reconcile(snapshot: ShellActivitySnapshot): void;
};

export type ShellKeyboardResumeDismissScheduler = {
	schedule(dismiss: () => void): void;
	cancel(): void;
};

export function createShellKeyboardResumeDismissScheduler<TTimer>(input: {
	schedule(task: () => void, delayMs: number): TTimer;
	cancel(timer: TTimer): void;
}): ShellKeyboardResumeDismissScheduler {
	let pending: TTimer | null = null;
	return {
		schedule: (dismiss) => {
			if (pending !== null) input.cancel(pending);
			pending = input.schedule(() => {
				pending = null;
				dismiss();
			}, 150);
		},
		cancel: () => {
			if (pending === null) return;
			const timer = pending;
			pending = null;
			input.cancel(timer);
		},
	};
}

export function createShellActivityRetainedDomainBridge(
	getActions: () => ShellActivityRetainedDomainActions,
	defer: (task: () => void) => void = queueMicrotask,
): ShellActivityRetainedDomainBridge {
	let committedSnapshot: ShellActivitySnapshot | null = null;
	const lifecycle = createReplaySafeDisposer(() => {
		const actions = getActions();
		actions.cancelPendingResumeDismiss();
		actions.invalidateRetainedDomains();
	}, defer);

	return {
		setup: lifecycle.setup,
		reconcile: (snapshot) => {
			const previous = committedSnapshot;
			if (
				previous?.focused === snapshot.focused &&
				previous.appState === snapshot.appState &&
				previous.appActive === snapshot.appActive &&
				previous.interactive === snapshot.interactive &&
				previous.generation === snapshot.generation
			) {
				return;
			}
			committedSnapshot = { ...snapshot };
			const initialReconciliation = previous === null;
			const generationChanged =
				initialReconciliation || previous.generation !== snapshot.generation;
			const focusLost = initialReconciliation
				? !snapshot.focused
				: previous.focused && !snapshot.focused;
			const appBecameInactive = initialReconciliation
				? !snapshot.appActive
				: previous.appActive && !snapshot.appActive;
			const shouldSetupInitialKeyboard =
				initialReconciliation && snapshot.interactive;
			const appBecameActive =
				!initialReconciliation && !previous.appActive && snapshot.appActive;
			const actions = getActions();
			if (focusLost || appBecameInactive) {
				actions.cancelPendingResumeDismiss();
			}
			if (
				generationChanged &&
				(!initialReconciliation || !snapshot.interactive)
			) {
				actions.invalidateRetainedDomains();
			}
			if (shouldSetupInitialKeyboard) {
				actions.setupInitialKeyboard(snapshot);
			} else if (appBecameActive) {
				actions.resumeFromAppState(snapshot);
			}
			if (!focusLost && !appBecameInactive) return;

			actions.invalidateBrowserActions();
			if (focusLost) {
				actions.closeBrowserActions();
				actions.invalidateScrollbackRequests();
			}
			actions.invalidateKeyboardRunner();
			if (appBecameInactive) {
				void actions.runInactiveScrollbackCleanup(snapshot);
				actions.rememberKeyboardVisibility();
			} else {
				void actions.clearScrollbackDirectly();
			}
		},
	};
}
