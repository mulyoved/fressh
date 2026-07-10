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
	let reconciledGeneration: number | null = null;
	const lifecycle = createReplaySafeDisposer(
		() => getActions().invalidateRetainedDomains(),
		defer,
	);

	return {
		setup: lifecycle.setup,
		reconcile: (snapshot) => {
			if (reconciledGeneration === snapshot.generation) return;
			const initialReconciliation = reconciledGeneration === null;
			reconciledGeneration = snapshot.generation;
			const actions = getActions();
			if (!initialReconciliation || !snapshot.interactive) {
				actions.invalidateRetainedDomains();
			}
			if (snapshot.interactive) {
				actions.resume(snapshot);
				return;
			}

			actions.invalidateBrowserActions();
			actions.closeBrowserActions();
			actions.invalidateKeyboardRunner();
			actions.invalidateScrollbackRequests();
			if (snapshot.appActive) {
				void actions.clearScrollbackDirectly();
			} else {
				void actions.runInactiveScrollbackCleanup(snapshot);
				actions.rememberKeyboardVisibility();
			}
		},
	};
}
