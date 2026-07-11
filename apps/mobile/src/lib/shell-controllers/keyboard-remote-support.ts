import {
	type WorkmuxKeyboardCommand,
	type WorkmuxKeyboardCommandRunResult,
} from '@/lib/keyboard-actions';
import {
	type ShellKeyboardRemoteOutcome,
	type ShellKeyboardRemoteTargetContext,
} from './keyboard-remote-contracts';

export type KeyboardRemoteAuthority = {
	generation: number;
	activityGeneration: number;
	target: ShellKeyboardRemoteTargetContext;
};

export type QueuedKeyboardRemoteWorkmux = {
	command: WorkmuxKeyboardCommand;
	authority: KeyboardRemoteAuthority;
	resolve(result: WorkmuxKeyboardCommandRunResult): void;
};

export type KeyboardRemoteCancellation = {
	promise: Promise<ShellKeyboardRemoteOutcome>;
	settle(outcome: ShellKeyboardRemoteOutcome): void;
};

export function createKeyboardRemoteCancellation(): KeyboardRemoteCancellation {
	let resolve!: (outcome: ShellKeyboardRemoteOutcome) => void;
	let settled = false;
	const promise = new Promise<ShellKeyboardRemoteOutcome>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return {
		promise,
		settle: (outcome) => {
			if (settled) return;
			settled = true;
			resolve(outcome);
		},
	};
}

export function copyKeyboardRemoteTarget(
	context: ShellKeyboardRemoteTargetContext,
): ShellKeyboardRemoteTargetContext {
	return { ...context };
}

export function isSameKeyboardRemoteTarget(
	left: ShellKeyboardRemoteTargetContext,
	right: ShellKeyboardRemoteTargetContext,
): boolean {
	return (
		left.targetKey === right.targetKey &&
		left.tmuxEnabled === right.tmuxEnabled &&
		left.sessionName === right.sessionName &&
		left.connectionId === right.connectionId &&
		left.channelId === right.channelId &&
		left.workmuxControlChannel === right.workmuxControlChannel &&
		left.source === right.source
	);
}

export function getKeyboardRemoteErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
