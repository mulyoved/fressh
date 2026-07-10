type SkillSelectorSource = {
	sourceKey: string;
	tmuxEnabled: boolean;
};

export function syncSkillSelectorControllerSource<
	Dependencies extends SkillSelectorSource,
>(input: {
	committedDependencies: { current: Dependencies };
	trackedSource: { current: SkillSelectorSource };
	dependencies: Dependencies;
	core: {
		setSourceKey(sourceKey: string): void;
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
