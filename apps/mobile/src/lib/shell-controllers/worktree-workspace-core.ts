import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../host-browser-actions';
import { WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE } from '../keyboard-actions';
import {
	type CloseWorktreeWorkspacePreparation,
	type CloseWorktreeWorkspaceResult,
	type CreateWorktreeWorkspaceResult,
	type NewWorktreeWorkspacePreparation,
} from '../worktree-workspace-bridge';
import {
	createControllerPublisher,
	type ControllerOutcome,
} from './controller-core';
import { createGenerationRequestGate } from './generation-request-gate';
import {
	type WorktreeWorkspaceCore,
	type WorktreeWorkspaceFailure,
	type WorktreeWorkspaceState,
} from './worktree-workspace-contracts';

type CreateWorktreeWorkspaceInput = Readonly<{
	target: string;
	expectedProjectRoot: string;
	branch: string;
}>;

type CloseWorktreeWorkspaceInput = Readonly<{
	session: string;
	workspaceId: string;
	expectedWorktreePath: string;
	expectedCloseFingerprint: string;
}>;

export type WorktreeWorkspaceCoreDependencies = Readonly<{
	initialSourceKey: unknown;
	hasConnection(): boolean;
	isWorkmuxEnabled(): boolean;
	requestOpen(onOpen: () => void): boolean;
	resolveTarget(): Promise<string>;
	prepareNewWorktreeWorkspace(
		target: string,
	): Promise<NewWorktreeWorkspacePreparation>;
	createWorktreeWorkspace(
		input: CreateWorktreeWorkspaceInput,
	): Promise<CreateWorktreeWorkspaceResult>;
	prepareCloseWorktreeWorkspace(
		target: string,
	): Promise<CloseWorktreeWorkspacePreparation>;
	closeWorktreeWorkspace(
		input: CloseWorktreeWorkspaceInput,
	): Promise<CloseWorktreeWorkspaceResult>;
	classifyFailure(error: unknown): WorktreeWorkspaceFailure;
	reportPrecondition(failure: WorktreeWorkspaceFailure): void;
	logger: Readonly<{
		error(message: string, payload?: unknown): void;
	}>;
}>;

const IDLE_STATE = { phase: 'idle' } as const;
const TASK_BRANCH_REQUIRED_FAILURE: WorktreeWorkspaceFailure = {
	kind: 'precondition',
	message: 'Task branch is required.',
};

type PreparationKind = 'new' | 'close';

function failedOutcome(
	failure: WorktreeWorkspaceFailure,
): ControllerOutcome<WorktreeWorkspaceFailure> {
	return { status: 'failed', failure };
}

export function createWorktreeWorkspaceCore(
	deps: WorktreeWorkspaceCoreDependencies,
): WorktreeWorkspaceCore {
	const publisher =
		createControllerPublisher<WorktreeWorkspaceState>(IDLE_STATE);
	const requestGate = createGenerationRequestGate();
	let sourceKey = deps.initialSourceKey;
	let disposed = false;

	const publish = (state: WorktreeWorkspaceState) => {
		if (!disposed) publisher.publish(state);
	};
	const reportPrecondition = (message: string) => {
		const failure: WorktreeWorkspaceFailure = {
			kind: 'precondition',
			message,
		};
		try {
			deps.reportPrecondition(failure);
		} catch {
			// Native failure reporting is best-effort.
		}
	};
	const logFailure = (message: string, failure: WorktreeWorkspaceFailure) => {
		try {
			deps.logger.error(message, { failure });
		} catch {
			// Diagnostics cannot change controller behavior.
		}
	};
	const classifyFailure = (error: unknown) => deps.classifyFailure(error);

	const runPreparation = (kind: PreparationKind) => {
		if (disposed) return;
		const token = requestGate.begin();
		if (token === null) return;
		publish({ phase: kind === 'new' ? 'preparing-new' : 'preparing-close' });

		void (async () => {
			try {
				const target = await deps.resolveTarget();
				if (!requestGate.isCurrent(token) || disposed) return;
				if (kind === 'new') {
					const preparation = await deps.prepareNewWorktreeWorkspace(target);
					if (!requestGate.isCurrent(token) || disposed) return;
					publish({ phase: 'editing-new', preparation });
				} else {
					const preparation = await deps.prepareCloseWorktreeWorkspace(target);
					if (!requestGate.isCurrent(token) || disposed) return;
					publish({ phase: 'confirming-close', preparation });
				}
			} catch (error) {
				if (!requestGate.isCurrent(token) || disposed) return;
				const failure = classifyFailure(error);
				logFailure('Worktree workspace preparation failed', failure);
				if (!requestGate.isCurrent(token) || disposed) return;
				publish({
					phase: kind === 'new' ? 'preparing-new' : 'preparing-close',
					error: failure,
				});
			} finally {
				requestGate.finish(token);
			}
		})();
	};

	const open = (kind: PreparationKind) => {
		if (disposed || publisher.getSnapshot().phase !== 'idle') return;
		if (!deps.hasConnection()) {
			reportPrecondition(HOST_BROWSER_NO_CONNECTION_MESSAGE);
			return;
		}
		if (!deps.isWorkmuxEnabled()) {
			reportPrecondition(WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE);
			return;
		}
		deps.requestOpen(() => {
			if (publisher.getSnapshot().phase === 'idle') runPreparation(kind);
		});
	};

	const invalidate = () => {
		if (disposed) return;
		requestGate.invalidate();
		publish(IDLE_STATE);
	};

	return {
		getSnapshot: publisher.getSnapshot,
		getState: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		openNew: () => open('new'),
		openClose: () => open('close'),
		retry: () => {
			const state = publisher.getSnapshot();
			if (state.phase === 'preparing-new' && state.error) {
				runPreparation('new');
			} else if (state.phase === 'preparing-close' && state.error) {
				runPreparation('close');
			}
		},
		create: async (branch) => {
			const state = publisher.getSnapshot();
			if (disposed || state.phase !== 'editing-new') {
				return { status: 'unavailable' };
			}
			const trimmedBranch = branch.trim();
			if (!trimmedBranch) {
				publish({
					phase: 'editing-new',
					preparation: state.preparation,
					error: TASK_BRANCH_REQUIRED_FAILURE,
				});
				return failedOutcome(TASK_BRANCH_REQUIRED_FAILURE);
			}
			const token = requestGate.begin();
			if (token === null) return { status: 'unavailable' };
			publish({ phase: 'creating', preparation: state.preparation });
			try {
				await deps.createWorktreeWorkspace({
					target: state.preparation.target,
					expectedProjectRoot: state.preparation.projectRoot,
					branch: trimmedBranch,
				});
				if (!requestGate.isCurrent(token) || disposed) {
					return { status: 'superseded' };
				}
				publish(IDLE_STATE);
				return { status: 'completed' };
			} catch (error) {
				if (!requestGate.isCurrent(token) || disposed) {
					return { status: 'superseded' };
				}
				const failure = classifyFailure(error);
				logFailure('Worktree workspace creation failed', failure);
				if (!requestGate.isCurrent(token) || disposed) {
					return { status: 'superseded' };
				}
				publish({
					phase: 'editing-new',
					preparation: state.preparation,
					error: failure,
				});
				return failedOutcome(failure);
			} finally {
				requestGate.finish(token);
			}
		},
		confirmClose: async () => {
			const state = publisher.getSnapshot();
			if (disposed || state.phase !== 'confirming-close') {
				return { status: 'unavailable' };
			}
			const token = requestGate.begin();
			if (token === null) return { status: 'unavailable' };
			publish({ phase: 'closing', preparation: state.preparation });
			try {
				await deps.closeWorktreeWorkspace({
					session: state.preparation.session,
					workspaceId: state.preparation.workspaceId,
					expectedWorktreePath: state.preparation.worktreePath,
					expectedCloseFingerprint: state.preparation.closeFingerprint,
				});
				if (!requestGate.isCurrent(token) || disposed) {
					return { status: 'superseded' };
				}
				publish(IDLE_STATE);
				return { status: 'completed' };
			} catch (error) {
				if (!requestGate.isCurrent(token) || disposed) {
					return { status: 'superseded' };
				}
				const failure = classifyFailure(error);
				logFailure('Worktree workspace close failed', failure);
				if (!requestGate.isCurrent(token) || disposed) {
					return { status: 'superseded' };
				}
				publish({ phase: 'preparing-close', error: failure });
				return failedOutcome(failure);
			} finally {
				requestGate.finish(token);
			}
		},
		close: () => {
			if (disposed) return true;
			const phase = publisher.getSnapshot().phase;
			if (phase === 'creating' || phase === 'closing') return false;
			invalidate();
			return true;
		},
		setSourceKey: (nextSourceKey) => {
			if (disposed || sourceKey === nextSourceKey) return;
			sourceKey = nextSourceKey;
			invalidate();
		},
		invalidate,
		dispose: () => {
			if (disposed) return;
			requestGate.invalidate();
			publisher.publish(IDLE_STATE);
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
