import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { WorktreeWorkspaceModal } from '@/app/shell/components/WorktreeWorkspaceModal';
import {
	type CloseWorktreeWorkspacePreparation,
	type NewWorktreeWorkspacePreparation,
} from '@/lib/worktree-workspace-bridge';

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return {
		...actual,
		useTheme: jest.fn(() => actual.darkTheme),
	};
});

const NEW_PREPARATION: NewWorktreeWorkspacePreparation = {
	target: 'main:codex',
	repositoryName: 'fressh',
	projectRoot: '/home/muly/code/fressh',
	suggestedBranch: 'issue-131-native-worktree-workspace',
};

const CLOSE_PREPARATION: CloseWorktreeWorkspacePreparation = {
	session: 'main',
	workspaceId: 'workspace-131',
	workspaceLabel: 'Issue 131',
	worktreePath: '/home/muly/code/fressh/.worktrees/issue-131',
	closeFingerprint: `sha256:${'a'.repeat(64)}`,
	windows: [
		{ id: '@1', name: 'editor' },
		{ id: '@2', name: 'tests' },
	],
};

test('preserves a new-worktree draft for the same preparation and resets it for a new target', () => {
	const onCreate = jest.fn<(branch: string) => void>();
	const props = {
		open: true,
		mode: 'new',
		phase: 'editing',
		preparation: NEW_PREPARATION,
		error: null,
		onRetry: jest.fn(),
		onClose: jest.fn(() => true),
		onCreate,
		bottomOffset: 0,
	} as const;
	const view = render(<WorktreeWorkspaceModal {...props} />);

	fireEvent.changeText(
		screen.getByDisplayValue(NEW_PREPARATION.suggestedBranch),
		'custom-branch',
	);
	expect(screen.getByDisplayValue('custom-branch')).toBeOnTheScreen();

	view.rerender(
		<WorktreeWorkspaceModal
			{...props}
			preparation={{
				...NEW_PREPARATION,
				suggestedBranch: 'ignored-suggestion',
			}}
		/>,
	);
	expect(screen.getByDisplayValue('custom-branch')).toBeOnTheScreen();
	fireEvent.press(screen.getByRole('button', { name: 'Create' }));
	expect(onCreate).toHaveBeenCalledWith('custom-branch');

	view.rerender(
		<WorktreeWorkspaceModal
			{...props}
			preparation={{
				...NEW_PREPARATION,
				target: 'main:other',
				suggestedBranch: 'reset-branch',
			}}
		/>,
	);
	expect(screen.getByDisplayValue('reset-branch')).toBeOnTheScreen();
});

test('blocks every close action while busy and enables dismissal and removal when idle', () => {
	const onClose = jest.fn(() => true);
	const onConfirm = jest.fn();
	const busyProps = {
		open: true,
		mode: 'close',
		phase: 'submitting',
		preview: CLOSE_PREPARATION,
		error: null,
		onRetry: jest.fn(),
		onClose,
		onConfirm,
		bottomOffset: 0,
	} as const;
	const view = render(<WorktreeWorkspaceModal {...busyProps} />);

	const busyModal = screen.UNSAFE_getByType(Modal);
	const busyBackdrop = screen.getByTestId('worktree-workspace-backdrop');
	const busyCancel = screen.getByRole('button', { name: 'Cancel' });
	const busyRemove = screen.getByRole('button', { name: 'Removing…' });
	expect(busyBackdrop).toBeDisabled();
	expect(busyCancel).toBeDisabled();
	expect(busyRemove).toBeDisabled();
	fireEvent(busyModal, 'requestClose');
	fireEvent.press(busyBackdrop);
	fireEvent.press(busyCancel);
	fireEvent.press(busyRemove);
	expect(onClose).not.toHaveBeenCalled();
	expect(onConfirm).not.toHaveBeenCalled();

	view.rerender(<WorktreeWorkspaceModal {...busyProps} phase="confirming" />);
	const idleModal = screen.UNSAFE_getByType(Modal);
	const idleBackdrop = screen.getByTestId('worktree-workspace-backdrop');
	const idleCancel = screen.getByRole('button', { name: 'Cancel' });
	const idleRemove = screen.getByRole('button', {
		name: 'Remove Worktree',
	});
	expect(idleBackdrop).toBeEnabled();
	expect(idleCancel).toBeEnabled();
	expect(idleRemove).toBeEnabled();
	fireEvent(idleModal, 'requestClose');
	fireEvent.press(idleBackdrop);
	fireEvent.press(idleCancel);
	fireEvent.press(idleRemove);
	expect(onClose).toHaveBeenCalledTimes(3);
	expect(onConfirm).toHaveBeenCalledTimes(1);

	expect(screen.getByText(CLOSE_PREPARATION.workspaceLabel)).toBeOnTheScreen();
	expect(screen.getByText(CLOSE_PREPARATION.worktreePath)).toBeOnTheScreen();
	expect(screen.getByText('editor')).toBeOnTheScreen();
	expect(screen.getByText('tests')).toBeOnTheScreen();
});
