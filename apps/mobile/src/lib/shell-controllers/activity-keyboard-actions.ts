export type ShellActivityKeyboardActions = {
	setupInitialKeyboard(): void;
	resumeFromAppState(): void;
};

export function createShellActivityKeyboardActions(input: {
	platformOS: string;
	getSystemKeyboardEnabled(): boolean;
	getWasKeyboardVisible(): boolean;
	setKeyboardVisible(visible: boolean): void;
	setXtermSystemKeyboardEnabled(enabled: boolean): void;
	dismissKeyboard(): void;
	scheduleDelayedDismiss(dismiss: () => void): void;
}): ShellActivityKeyboardActions {
	const synchronizeXterm = (): boolean => {
		const enabled = input.getSystemKeyboardEnabled();
		input.setXtermSystemKeyboardEnabled(enabled);
		return enabled;
	};

	return {
		setupInitialKeyboard: () => {
			if (input.platformOS !== 'android') return;
			input.dismissKeyboard();
			synchronizeXterm();
		},
		resumeFromAppState: () => {
			if (input.platformOS !== 'android') return;
			const enabled = synchronizeXterm();
			if (enabled && input.getWasKeyboardVisible()) return;
			input.dismissKeyboard();
			input.scheduleDelayedDismiss(input.dismissKeyboard);
			input.setKeyboardVisible(false);
		},
	};
}
