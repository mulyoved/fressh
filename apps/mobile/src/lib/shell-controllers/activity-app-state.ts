type AppStateChangeSubscription = {
	remove(): void;
};

export function subscribeShellActivityToAppState(input: {
	setAppState(appState: string): void;
	getCurrentAppState(): string;
	addChangeListener(
		listener: (appState: string) => void,
	): AppStateChangeSubscription;
}): () => void {
	const subscription = input.addChangeListener(input.setAppState);
	input.setAppState(input.getCurrentAppState());
	return () => subscription.remove();
}
