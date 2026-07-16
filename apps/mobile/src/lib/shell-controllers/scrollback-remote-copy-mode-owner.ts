import { type ShellScrollbackContext } from './scrollback-contracts';

export type ScrollbackRemoteCopyModeToken = Readonly<{
	generation: number;
}>;

export type ScrollbackRemoteCopyModeOwner = {
	acquire(): ScrollbackRemoteCopyModeToken;
	dispose(): void;
	generation(): number;
	isOwned(): boolean;
	release(): ScrollbackRemoteCopyModeToken;
	restore(): void;
	setContext(context: ShellScrollbackContext | null): void;
	settle(token: ScrollbackRemoteCopyModeToken, owned: boolean): boolean;
	transition(): ScrollbackRemoteCopyModeToken;
};

export function createScrollbackRemoteCopyModeOwner({
	warn,
}: {
	warn(context: ShellScrollbackContext, message: string, error?: unknown): void;
}): ScrollbackRemoteCopyModeOwner {
	let context: ShellScrollbackContext | null = null;
	let disposed = false;
	let generation = 0;
	let owned = false;
	let synchronizationRevision = 0;
	let registered: {
		context: ShellScrollbackContext;
		unregister(): void;
	} | null = null;

	const safelyUnregister = (registration: NonNullable<typeof registered>) => {
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

	const synchronize = (): void => {
		const revision = ++synchronizationRevision;
		const desiredContext = !disposed && owned ? context : null;
		if (registered?.context === desiredContext) return;

		const previous = registered;
		registered = null;
		if (previous) safelyUnregister(previous);
		if (
			revision !== synchronizationRevision ||
			desiredContext === null ||
			disposed ||
			!owned ||
			context !== desiredContext
		) {
			return;
		}

		let unregister: (() => void) | null = null;
		try {
			unregister = desiredContext.workmux.registerBeforeDispose(
				`scrollback:${desiredContext.workmux.key}`,
				async (retiringPort) => {
					const outcome = await retiringPort.exitScroll({
						sessionName: desiredContext.targetName,
					});
					if (outcome.status === 'unavailable') {
						throw new Error('Workmux scrollback retirement unavailable.');
					}
				},
			);
		} catch (error) {
			warn(
				desiredContext,
				'Failed to register Workmux scrollback retirement cleanup',
				error,
			);
			return;
		}

		if (
			revision !== synchronizationRevision ||
			disposed ||
			!owned ||
			context !== desiredContext
		) {
			safelyUnregister({ context: desiredContext, unregister });
			return;
		}
		registered = { context: desiredContext, unregister };
	};

	const advanceGeneration = (): ScrollbackRemoteCopyModeToken => {
		if (!disposed) generation += 1;
		return Object.freeze({ generation });
	};
	const transition = (): ScrollbackRemoteCopyModeToken => {
		const token = advanceGeneration();
		synchronize();
		return token;
	};

	return {
		acquire: () => {
			const token = advanceGeneration();
			if (!disposed) owned = true;
			synchronize();
			return token;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation += 1;
			owned = false;
			context = null;
			synchronize();
		},
		generation: () => generation,
		isOwned: () => owned,
		release: () => {
			const token = advanceGeneration();
			if (!disposed) owned = false;
			synchronize();
			return token;
		},
		restore: () => {
			if (disposed) return;
			owned = true;
			synchronize();
		},
		setContext: (nextContext) => {
			if (disposed) return;
			context = nextContext;
			synchronize();
		},
		settle: (token, nextOwned) => {
			if (disposed || token.generation !== generation) return false;
			owned = nextOwned;
			synchronize();
			return true;
		},
		transition,
	};
}
