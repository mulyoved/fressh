export type ShellModalId =
	| 'command-menu'
	| 'commander'
	| 'text-entry'
	| 'configure'
	| 'browser-actions'
	| 'feature-request'
	| 'skill-selector';

export type ShellModalClose = (context: {
	opening: ShellModalId;
}) => boolean | void;

export type ShellModalArbiter = {
	register(id: ShellModalId, close: ShellModalClose): () => void;
	requestOpen(input: {
		target: ShellModalId;
		conflicts: readonly ShellModalId[];
		onOpen: () => void;
	}): boolean;
};

export function createShellModalArbiter(): ShellModalArbiter {
	const closers = new Map<ShellModalId, ShellModalClose>();

	return {
		register: (id, close) => {
			closers.set(id, close);
			return () => {
				if (closers.get(id) === close) closers.delete(id);
			};
		},
		requestOpen: ({ target, conflicts, onOpen }) => {
			for (const conflict of conflicts) {
				if (conflict === target) continue;
				const close = closers.get(conflict);
				if (close?.({ opening: target }) === false) return false;
			}
			onOpen();
			return true;
		},
	};
}
