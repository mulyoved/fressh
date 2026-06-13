import { MDEV_BRIDGE_UPDATE_MESSAGE } from './mdev-bridge-client';
import {
	buildWorkmuxAppContextArgv,
	formatWorkmuxAppCommandFailureMessage,
	parseWorkmuxAppContextOutput,
} from './workmux-app-commands';
import {
	buildCodexRestartBridgeOperation,
	type MdevBridgeOperationRequest,
} from './workmux-bridge-operations';
import {
	type WorkmuxControlChannel,
	type WorkmuxControlCommandResult,
} from './workmux-control-channel';

export const CODEX_RESTART_WORKMUX_DISABLED_MESSAGE =
	'Enable Workmux to restart Codex.';

export type CodexRestartResult = {
	status: 'handled' | 'failed';
};

export type CodexRestartDeps = {
	tmuxEnabled: boolean;
	sessionName: string;
	workmuxControlChannel: Pick<WorkmuxControlChannel, 'command' | 'operation'>;
	showFailure: (message: string) => void | Promise<void>;
	timeoutMs?: number;
};

const DEFAULT_CODEX_RESTART_TIMEOUT_MS = 10_000;

function failureResult(): CodexRestartResult {
	return { status: 'failed' };
}

function successResult(): CodexRestartResult {
	return { status: 'handled' };
}

function bridgeOperationFailureMessage(error: string | undefined): string {
	const trimmed = error?.trim() ?? '';
	if (!trimmed || isUnsupportedRestartOperationFailure(trimmed)) {
		return MDEV_BRIDGE_UPDATE_MESSAGE;
	}
	return trimmed;
}

function isUnsupportedRestartOperationFailure(message: string): boolean {
	return [
		/\b(?:unsupported|unknown)\s+(?:bridge\s+)?operation\b.*\bcodex\.restart\b/i,
		/\bmissing\b.*\bcodex\.restart\b.*\b(?:bridge\s+)?operation\b/i,
		/\bmissing\b.*\b(?:bridge\s+)?operation\b.*\bcodex\.restart\b/i,
		/\bcodex\.restart\b\s+(?:is\s+)?(?:not[- ]supported|not[- ]implemented)\b/i,
		/^(?:bridge\s+)?operation\s+(?:missing|not[- ]supported|not[- ]implemented)\.?$/i,
	].some((pattern) => pattern.test(message));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function showRestartFailure(
	showFailure: CodexRestartDeps['showFailure'],
	message: string,
): Promise<CodexRestartResult> {
	try {
		await showFailure(message);
	} catch {
		// Failure UI is best-effort; callers still need a deterministic result.
	}
	return failureResult();
}

export async function restartCodexWithBridge({
	tmuxEnabled,
	sessionName,
	workmuxControlChannel,
	showFailure,
	timeoutMs = DEFAULT_CODEX_RESTART_TIMEOUT_MS,
}: CodexRestartDeps): Promise<CodexRestartResult> {
	if (!tmuxEnabled) {
		return showRestartFailure(
			showFailure,
			CODEX_RESTART_WORKMUX_DISABLED_MESSAGE,
		);
	}

	let contextResult: WorkmuxControlCommandResult;
	try {
		contextResult = await workmuxControlChannel.command(
			buildWorkmuxAppContextArgv(sessionName),
			{ timeoutMs },
		);
	} catch (error) {
		return showRestartFailure(
			showFailure,
			formatWorkmuxAppCommandFailureMessage(errorMessage(error)),
		);
	}
	if (!contextResult.success) {
		return showRestartFailure(
			showFailure,
			formatWorkmuxAppCommandFailureMessage(contextResult.error ?? ''),
		);
	}

	let restartOperation: MdevBridgeOperationRequest;
	try {
		const context = parseWorkmuxAppContextOutput(contextResult.output);
		restartOperation = buildCodexRestartBridgeOperation(context.target);
	} catch (error) {
		return showRestartFailure(showFailure, errorMessage(error));
	}

	let restartResult: WorkmuxControlCommandResult;
	try {
		restartResult = await workmuxControlChannel.operation(restartOperation, {
			timeoutMs,
		});
	} catch (error) {
		return showRestartFailure(
			showFailure,
			bridgeOperationFailureMessage(errorMessage(error)),
		);
	}
	if (!restartResult.success) {
		return showRestartFailure(
			showFailure,
			bridgeOperationFailureMessage(restartResult.error),
		);
	}

	return successResult();
}
