import {
	type CloseWorktreeWorkspacePreparation,
	type NewWorktreeWorkspacePreparation,
} from '../worktree-workspace-bridge';
import { type WorktreeWorkspaceState } from './worktree-workspace-contracts';

type ModalCallbacks = Readonly<{
	onRetry(): void;
	onClose(): boolean;
	onCreate(branch: string): void;
	onConfirm(): void;
}>;

export type WorktreeWorkspaceModalControllerProps =
	| Readonly<{ open: false; mode: 'closed' }>
	| Readonly<{
			open: true;
			mode: 'new';
			phase: 'preparing' | 'editing' | 'submitting';
			preparation: NewWorktreeWorkspacePreparation | null;
			error: string | null;
			onRetry: ModalCallbacks['onRetry'];
			onClose: ModalCallbacks['onClose'];
			onCreate: ModalCallbacks['onCreate'];
	  }>
	| Readonly<{
			open: true;
			mode: 'close';
			phase: 'preparing' | 'confirming' | 'submitting';
			preview: CloseWorktreeWorkspacePreparation | null;
			error: string | null;
			onRetry: ModalCallbacks['onRetry'];
			onClose: ModalCallbacks['onClose'];
			onConfirm: ModalCallbacks['onConfirm'];
	  }>;

export type WorktreeWorkspaceModalProps =
	WorktreeWorkspaceModalControllerProps & Readonly<{ bottomOffset: number }>;

export function buildWorktreeWorkspaceModalControllerProps(
	state: WorktreeWorkspaceState,
	callbacks: ModalCallbacks,
): WorktreeWorkspaceModalControllerProps {
	switch (state.phase) {
		case 'idle':
			return { open: false, mode: 'closed' };
		case 'preparing-new':
			return {
				open: true,
				mode: 'new',
				phase: 'preparing',
				preparation: null,
				error: state.error?.message ?? null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onCreate: callbacks.onCreate,
			};
		case 'editing-new':
			return {
				open: true,
				mode: 'new',
				phase: 'editing',
				preparation: state.preparation,
				error: state.error?.message ?? null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onCreate: callbacks.onCreate,
			};
		case 'creating':
			return {
				open: true,
				mode: 'new',
				phase: 'submitting',
				preparation: state.preparation,
				error: null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onCreate: callbacks.onCreate,
			};
		case 'preparing-close':
			return {
				open: true,
				mode: 'close',
				phase: 'preparing',
				preview: null,
				error: state.error?.message ?? null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onConfirm: callbacks.onConfirm,
			};
		case 'confirming-close':
			return {
				open: true,
				mode: 'close',
				phase: 'confirming',
				preview: state.preparation,
				error: state.error?.message ?? null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onConfirm: callbacks.onConfirm,
			};
		case 'closing':
			return {
				open: true,
				mode: 'close',
				phase: 'submitting',
				preview: state.preparation,
				error: null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onConfirm: callbacks.onConfirm,
			};
	}
}

export function getWorktreeWorkspaceDraftResetKey(
	props: WorktreeWorkspaceModalControllerProps,
): string | null {
	if (!props.open || props.mode !== 'new' || props.preparation === null) {
		return null;
	}
	return JSON.stringify([
		props.preparation.target,
		props.preparation.projectRoot,
	]);
}
