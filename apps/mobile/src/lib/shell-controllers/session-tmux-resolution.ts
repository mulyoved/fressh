import {
	createControllerPublisher,
	type ControllerCore,
} from './controller-core';

export type ShellTmuxResolution = {
	enabled: boolean;
	target: string;
};

export type ShellTmuxResolutionOwner = ControllerCore<ShellTmuxResolution> & {
	resolve(storedConnectionId: string | undefined): void;
};

export function createShellTmuxResolutionOwner({
	initialTarget,
	load,
	warn,
}: {
	initialTarget: string;
	load(storedConnectionId: string): Promise<{
		useTmux?: boolean;
		tmuxSessionName?: string;
	} | null>;
	warn(message: string, error?: unknown): void;
}): ShellTmuxResolutionOwner {
	const publisher = createControllerPublisher<ShellTmuxResolution>({
		enabled: false,
		target: initialTarget.trim() || 'main',
	});
	let requestGeneration = 0;
	let disposed = false;

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		resolve: (storedConnectionId) => {
			const generation = requestGeneration + 1;
			requestGeneration = generation;
			if (!storedConnectionId) return;
			void load(storedConnectionId).then(
				(details) => {
					if (disposed || requestGeneration !== generation || !details) return;
					const current = publisher.getSnapshot();
					const enabled = details.useTmux ?? true;
					const target = enabled
						? details.tmuxSessionName?.trim() || 'main'
						: current.target;
					if (current.enabled === enabled && current.target === target) return;
					publisher.publish({ enabled, target });
				},
				(error) => {
					if (disposed || requestGeneration !== generation) return;
					warn('Failed to load tmux session info', error);
				},
			);
		},
		invalidate: () => {
			requestGeneration += 1;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			requestGeneration += 1;
			publisher.disposePublisher();
		},
	};
}
