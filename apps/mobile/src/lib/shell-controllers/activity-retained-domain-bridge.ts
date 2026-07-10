import { type ShellActivitySnapshot } from './activity-core';
import {
	createReplaySafeDisposer,
	type ReplaySafeDisposer,
} from './controller-core';

export type ShellActivityRetainedDomainActions = {
	resume(snapshot: ShellActivitySnapshot): void;
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
};

export type ShellActivityRetainedDomainBridge = ReplaySafeDisposer & {
	reconcile(snapshot: ShellActivitySnapshot): void;
};

export function createShellActivityRetainedDomainBridge(
	getActions: () => ShellActivityRetainedDomainActions,
	defer: (task: () => void) => void = queueMicrotask,
): ShellActivityRetainedDomainBridge {
	let committedSnapshot: ShellActivitySnapshot | null = null;
	const lifecycle = createReplaySafeDisposer(
		() => getActions().invalidateRetainedDomains(),
		defer,
	);

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
			const becameInteractive =
				snapshot.interactive &&
				(initialReconciliation || !previous.interactive);
			const actions = getActions();
			if (
				generationChanged &&
				(!initialReconciliation || !snapshot.interactive)
			) {
				actions.invalidateRetainedDomains();
			}
			if (becameInteractive) {
				actions.resume(snapshot);
			}
			if (!focusLost && !appBecameInactive) return;

			actions.invalidateBrowserActions();
			if (focusLost) {
				actions.closeBrowserActions();
				actions.invalidateScrollbackRequests();
			}
			if (appBecameInactive) {
				actions.invalidateKeyboardRunner();
				void actions.runInactiveScrollbackCleanup(snapshot);
				actions.rememberKeyboardVisibility();
			} else {
				void actions.clearScrollbackDirectly();
			}
		},
	};
}
