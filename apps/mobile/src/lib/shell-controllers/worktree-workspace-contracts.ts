import {
	type CloseWorktreeWorkspacePreparation,
	type NewWorktreeWorkspacePreparation,
} from '../worktree-workspace-bridge';
import { type ControllerCore, type ControllerOutcome } from './controller-core';

export type WorktreeWorkspaceFailure = Readonly<{
	kind:
		| 'precondition'
		| 'unsupported'
		| 'timeout'
		| 'stale-target'
		| 'remote'
		| 'invalid-response';
	message: string;
}>;

export type WorktreeWorkspaceState =
	| Readonly<{ phase: 'idle' }>
	| Readonly<{
			phase: 'preparing-new';
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'editing-new';
			preparation: NewWorktreeWorkspacePreparation;
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'creating';
			preparation: NewWorktreeWorkspacePreparation;
	  }>
	| Readonly<{
			phase: 'preparing-close';
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'confirming-close';
			preparation: CloseWorktreeWorkspacePreparation;
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'closing';
			preparation: CloseWorktreeWorkspacePreparation;
	  }>;

export type WorktreeWorkspaceCore = ControllerCore<WorktreeWorkspaceState> &
	Readonly<{
		getState(): WorktreeWorkspaceState;
		openNew(): void;
		openClose(): void;
		retry(): void;
		create(
			branch: string,
		): Promise<ControllerOutcome<WorktreeWorkspaceFailure>>;
		confirmClose(): Promise<ControllerOutcome<WorktreeWorkspaceFailure>>;
		close(): boolean;
		setSourceKey(sourceKey: unknown): void;
	}>;
