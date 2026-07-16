import {
	type ShellScrollbackContext,
	type ShellScrollbackState,
} from './scrollback-contracts';

export const INITIAL_SCROLLBACK_STATE: ShellScrollbackState = {
	active: false,
	phase: 'active',
	runtimeInstanceId: null,
};

export function normalizeScrollbackContext(
	context: ShellScrollbackContext,
): ShellScrollbackContext {
	return {
		...context,
		targetName: context.targetName.trim() || 'main',
	};
}

export function isSameScrollbackTarget(
	left: ShellScrollbackContext,
	right: ShellScrollbackContext,
): boolean {
	return (
		left.targetKey === right.targetKey && left.targetName === right.targetName
	);
}

export function requiresScrollbackExecutorReplacement(input: {
	current: ShellScrollbackContext | null;
	next: ShellScrollbackContext;
	executorAvailable: boolean;
}): boolean {
	const { current, executorAvailable, next } = input;
	return (
		!executorAvailable ||
		current === null ||
		current.targetKey !== next.targetKey ||
		current.targetName !== next.targetName ||
		current.workmux !== next.workmux ||
		current.terminalTransport !== next.terminalTransport ||
		current.terminalView !== next.terminalView
	);
}
