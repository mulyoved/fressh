export type ControllerInvalidationReason =
	| 'closed'
	| 'source-change'
	| 'focus-lost'
	| 'app-inactive'
	| 'runtime-reset'
	| 'unmount';

export type ControllerOutcome<Failure = never> =
	| { status: 'completed' }
	| { status: 'superseded' }
	| { status: 'unavailable' }
	| { status: 'failed'; failure: Failure };

export type ControllerCore<State> = {
	getSnapshot(): State;
	subscribe(listener: () => void): () => void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export type ControllerPublisher<State> = {
	getSnapshot(): State;
	subscribe(listener: () => void): () => void;
	publish(snapshot: State): void;
	disposePublisher(): void;
};

export function createControllerPublisher<State>(
	initialSnapshot: State,
): ControllerPublisher<State> {
	let snapshot = initialSnapshot;
	let disposed = false;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		publish: (nextSnapshot) => {
			if (disposed) return;
			snapshot = nextSnapshot;
			for (const listener of listeners) listener();
		},
		disposePublisher: () => {
			if (disposed) return;
			disposed = true;
			listeners.clear();
		},
	};
}
