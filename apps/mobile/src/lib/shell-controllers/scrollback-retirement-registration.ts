import { type ShellScrollbackContext } from './scrollback-contracts';

export type ScrollbackRetirementRegistration = {
	sync(remoteCopyModeOwned: boolean): void;
};

export function createRemoteCopyOwnershipRef(
	backing: { current: boolean },
	onChange: () => void,
): { current: boolean } {
	return {
		get current() {
			return backing.current;
		},
		set current(active: boolean) {
			backing.current = active;
			onChange();
		},
	};
}

export function createScrollbackRetirementRegistration({
	getContext,
	isDisposed,
	warn,
}: {
	getContext(): ShellScrollbackContext | null;
	isDisposed(): boolean;
	warn(context: ShellScrollbackContext, message: string, error?: unknown): void;
}): ScrollbackRetirementRegistration {
	let registered: {
		context: ShellScrollbackContext;
		unregister(): void;
	} | null = null;

	const unregister = (): void => {
		const registration = registered;
		registered = null;
		if (!registration) return;
		try {
			registration.unregister();
		} catch (error) {
			warn(
				registration.context,
				'Failed to unregister Workmux scrollback retirement cleanup',
				error,
			);
		}
	};

	return {
		sync: (remoteCopyModeOwned) => {
			const context = getContext();
			if (isDisposed() || !remoteCopyModeOwned || context === null) {
				unregister();
				return;
			}
			if (registered?.context === context) return;
			unregister();
			try {
				const unregisterCurrent = context.workmux.registerBeforeDispose(
					`scrollback:${context.workmux.key}`,
					async (retiringPort) => {
						const outcome = await retiringPort.exitScroll({
							sessionName: context.targetName,
						});
						if (outcome.status === 'unavailable') {
							throw new Error('Workmux scrollback retirement unavailable.');
						}
					},
				);
				registered = { context, unregister: unregisterCurrent };
			} catch (error) {
				warn(
					context,
					'Failed to register Workmux scrollback retirement cleanup',
					error,
				);
			}
		},
	};
}
