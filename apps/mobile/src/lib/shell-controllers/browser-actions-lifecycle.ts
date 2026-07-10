import { createReplaySafeDisposer } from './controller-core';
import { type ShellTargetKey } from './source-keys';

type BrowserSource = {
	sourceKey: ShellTargetKey;
	tmuxEnabled: boolean;
};

export function syncBrowserActionsControllerSource<
	Dependencies extends BrowserSource,
>(input: {
	committedDependencies: { current: Dependencies };
	trackedSource: { current: BrowserSource };
	dependencies: Dependencies;
	core: {
		setSourceKey(sourceKey: ShellTargetKey): void;
		invalidate(reason: 'source-change'): void;
	};
}): void {
	const previous = input.trackedSource.current;
	const sourceChanged = previous.sourceKey !== input.dependencies.sourceKey;
	const tmuxEnabledChanged =
		previous.tmuxEnabled !== input.dependencies.tmuxEnabled;

	input.committedDependencies.current = input.dependencies;
	input.core.setSourceKey(input.dependencies.sourceKey);
	if (!sourceChanged && tmuxEnabledChanged) {
		input.core.invalidate('source-change');
	}
	input.trackedSource.current = {
		sourceKey: input.dependencies.sourceKey,
		tmuxEnabled: input.dependencies.tmuxEnabled,
	};
}

export function createBrowserActionsControllerLifecycle(
	core: {
		invalidate(reason: 'unmount'): void;
		dispose(): void;
	},
	defer?: (task: () => void) => void,
): { setup(): () => void } {
	const replaySafeDisposer = createReplaySafeDisposer(core.dispose, defer);
	return {
		setup: () => {
			const scheduleDispose = replaySafeDisposer.setup();
			return () => {
				core.invalidate('unmount');
				scheduleDispose();
			};
		},
	};
}
