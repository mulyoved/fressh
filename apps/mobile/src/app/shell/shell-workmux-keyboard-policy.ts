import { shouldShowFocusedActiveFeedback } from '@/lib/focused-active-request';
import {
	isMdevBridgeDisposedByReconnectFailureClass,
	type MdevBridgeFailureClass,
} from '@/lib/mdev-bridge-client';
import { type WorkmuxControlCommandResult } from '@/lib/workmux-control-channel';

export class WorkmuxCommandFailure extends Error {
	readonly failureClass?: MdevBridgeFailureClass;

	constructor(message: string, failureClass?: MdevBridgeFailureClass) {
		super(message);
		this.name = 'WorkmuxCommandFailure';
		this.failureClass = failureClass;
	}
}

export async function runShellWorkmuxKeyboardCommand({
	argv,
	runCommand,
	timeoutMs,
}: {
	argv: string[];
	runCommand: (
		argv: string[],
		options: { timeoutMs?: number },
	) => Promise<WorkmuxControlCommandResult>;
	timeoutMs?: number;
}): Promise<string> {
	const result = await runCommand(argv, { timeoutMs });
	if (!result.success) {
		throw new WorkmuxCommandFailure(
			result.error || result.output || 'Workmux command failed.',
			result.failureClass,
		);
	}
	return result.output;
}

export function shouldShowShellWorkmuxKeyboardFailure({
	failureClass,
	isAppActive,
	isFocused,
}: {
	failureClass?: MdevBridgeFailureClass;
	isAppActive: boolean;
	isFocused: boolean;
}): boolean {
	if (isMdevBridgeDisposedByReconnectFailureClass(failureClass)) {
		return false;
	}
	return shouldShowFocusedActiveFeedback({ isFocused, isAppActive });
}

export function showShellWorkmuxKeyboardFailure({
	failureClass,
	isAppActive,
	isFocused,
	message,
	showAlert,
}: {
	failureClass?: MdevBridgeFailureClass;
	isAppActive: boolean;
	isFocused: boolean;
	message: string;
	showAlert: (title: string, message: string) => void;
}): void {
	if (
		!shouldShowShellWorkmuxKeyboardFailure({
			failureClass,
			isFocused,
			isAppActive,
		})
	) {
		return;
	}
	showAlert('Workmux action failed', message);
}
