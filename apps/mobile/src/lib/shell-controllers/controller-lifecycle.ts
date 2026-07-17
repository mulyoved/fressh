import { createReplaySafeDisposer } from './controller-core';

type ControllerSourceBoundary = {
	sourceKey: unknown;
	tmuxEnabled: boolean;
};

type TrackedControllerSource<Dependencies extends ControllerSourceBoundary> = {
	sourceKey: Dependencies['sourceKey'];
	tmuxEnabled: boolean;
	authority: unknown;
};

export function syncControllerSource<
	Dependencies extends ControllerSourceBoundary,
>(input: {
	committedDependencies: { current: Dependencies };
	trackedSource: { current: TrackedControllerSource<Dependencies> };
	dependencies: Dependencies;
	getAuthority(dependencies: Dependencies): unknown;
	core: {
		setSourceKey(sourceKey: Dependencies['sourceKey']): void;
		invalidate(reason: 'source-change'): void;
	};
}): void {
	const previous = input.trackedSource.current;
	const sourceChanged = previous.sourceKey !== input.dependencies.sourceKey;
	const tmuxEnabledChanged =
		previous.tmuxEnabled !== input.dependencies.tmuxEnabled;
	const authority = input.getAuthority(input.dependencies);
	const authorityChanged = previous.authority !== authority;

	input.committedDependencies.current = input.dependencies;
	input.core.setSourceKey(input.dependencies.sourceKey);
	if (!sourceChanged && (tmuxEnabledChanged || authorityChanged)) {
		input.core.invalidate('source-change');
	}
	input.trackedSource.current = {
		sourceKey: input.dependencies.sourceKey,
		tmuxEnabled: input.dependencies.tmuxEnabled,
		authority,
	};
}

export function createReplaySafeControllerLifecycle(
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
