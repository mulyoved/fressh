import {
	isMdevBridgeFailureClass,
	MDEV_BRIDGE_UPDATE_MESSAGE,
	type MdevBridgeFailureClass,
} from '../mdev-bridge-client';
import {
	buildWorkmuxAppContextArgv,
	parseWorkmuxAppContextOutput,
} from '../workmux-app-commands';
import {
	type WorkmuxControlChannel,
	type WorkmuxControlCommandResult,
} from '../workmux-control-channel';
import {
	buildCloseWorktreeWorkspaceRequest,
	buildCreateWorktreeWorkspaceRequest,
	buildPrepareCloseWorktreeWorkspaceRequest,
	buildPrepareNewWorktreeWorkspaceRequest,
	parseCloseWorktreeWorkspaceOutput,
	parseCreateWorktreeWorkspaceOutput,
	parsePrepareCloseWorktreeWorkspaceOutput,
	parsePrepareNewWorktreeWorkspaceOutput,
	WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
	WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS,
	WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
} from '../worktree-workspace-bridge';
import { type ShellModalArbiter } from './modal-arbiter';
import { type WorktreeWorkspaceFailure } from './worktree-workspace-contracts';
import { type WorktreeWorkspaceCoreDependencies } from './worktree-workspace-core';

export type WorktreeWorkspaceControllerDependencies<TConnection> = Readonly<{
	connection: TConnection | null;
	tmuxEnabled: boolean;
	sessionName: string;
	sourceKey: unknown;
	workmuxControlChannel: Pick<WorkmuxControlChannel, 'command' | 'operation'>;
	arbiter: ShellModalArbiter;
}>;

type AdapterCoreDependencies = Omit<
	WorktreeWorkspaceCoreDependencies,
	'initialSourceKey'
>;

export type WorktreeWorkspaceControllerAdapter = AdapterCoreDependencies &
	Readonly<{
		registerClose(close: () => boolean): () => void;
	}>;

const WORKTREE_WORKSPACE_CONFLICTS = [
	'command-menu',
	'commander',
	'text-entry',
	'configure',
	'browser-actions',
	'feature-request',
	'skill-selector',
] as const;

const WORKTREE_WORKSPACE_OPERATION_IDS = [
	WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
	WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
	WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
] as const;

const STALE_TARGET_FAILURE_PREFIXES = [
	'Worktree creation target changed; refusing stale project context',
	'Worktree close target changed; refusing stale workspace window set',
	'Worktree close target changed; refusing to remove stale worktree path',
] as const;

const TIMEOUT_FAILURE_MESSAGE =
	'Worktree workspace request timed out. The remote operation may have completed; inspect the workspace list before trying again.';
const INVALID_RESPONSE_MESSAGE = 'Invalid worktree workspace bridge response.';
const REMOTE_FAILURE_FALLBACK = 'Worktree workspace request failed.';

class WorktreeWorkspaceRequestError extends Error {
	readonly failureClass?: MdevBridgeFailureClass;

	constructor(message: string, failureClass?: MdevBridgeFailureClass) {
		super(message);
		this.name = 'WorktreeWorkspaceRequestError';
		this.failureClass = failureClass;
	}
}

function readFailureClass(error: unknown): MdevBridgeFailureClass | undefined {
	if (
		typeof error === 'object' &&
		error !== null &&
		'failureClass' in error &&
		isMdevBridgeFailureClass(error.failureClass)
	) {
		return error.failureClass;
	}
	return undefined;
}

function readMessage(error: unknown): string {
	if (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message;
	}
	return typeof error === 'string' ? error : String(error);
}

function sanitizeMessage(message: string | undefined): string {
	return message?.trim() || REMOTE_FAILURE_FALLBACK;
}

function isUnsupportedOperationFailure(message: string): boolean {
	const namesWorktreeOperation = WORKTREE_WORKSPACE_OPERATION_IDS.some(
		(operationId) => message.includes(operationId),
	);
	return (
		namesWorktreeOperation &&
		/\b(?:unsupported|unknown|missing|not[- ]supported|not[- ]implemented)\b/i.test(
			message,
		)
	);
}

export function classifyWorktreeWorkspaceFailure(
	error: unknown,
): WorktreeWorkspaceFailure {
	const message = sanitizeMessage(readMessage(error));
	if (readFailureClass(error) === 'timeout') {
		return { kind: 'timeout', message: TIMEOUT_FAILURE_MESSAGE };
	}
	if (isUnsupportedOperationFailure(message)) {
		return { kind: 'unsupported', message: MDEV_BRIDGE_UPDATE_MESSAGE };
	}
	if (message === INVALID_RESPONSE_MESSAGE) {
		return { kind: 'invalid-response', message: INVALID_RESPONSE_MESSAGE };
	}
	if (
		STALE_TARGET_FAILURE_PREFIXES.some((prefix) => message.startsWith(prefix))
	) {
		return { kind: 'stale-target', message };
	}
	return { kind: 'remote', message };
}

function requestError(
	message: string | undefined,
	failureClass?: MdevBridgeFailureClass,
): WorktreeWorkspaceRequestError {
	return new WorktreeWorkspaceRequestError(
		sanitizeMessage(message),
		failureClass,
	);
}

async function runBridgeRequest(
	request: () => Promise<WorkmuxControlCommandResult>,
): Promise<string> {
	let result: WorkmuxControlCommandResult;
	try {
		result = await request();
	} catch (error) {
		throw requestError(readMessage(error), readFailureClass(error));
	}
	if (!result.success) {
		throw requestError(result.error, result.failureClass);
	}
	return result.output;
}

export function createWorktreeWorkspaceControllerAdapter<TConnection>(input: {
	getCommittedDependencies(): WorktreeWorkspaceControllerDependencies<TConnection>;
	reportPrecondition(failure: WorktreeWorkspaceFailure): void;
	logger: WorktreeWorkspaceCoreDependencies['logger'];
}): WorktreeWorkspaceControllerAdapter {
	const runOperation = (
		request: Parameters<WorkmuxControlChannel['operation']>[0],
	) =>
		runBridgeRequest(() =>
			input
				.getCommittedDependencies()
				.workmuxControlChannel.operation(request, {
					timeoutMs: WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS,
				}),
		);

	return {
		hasConnection: () => input.getCommittedDependencies().connection !== null,
		isWorkmuxEnabled: () => input.getCommittedDependencies().tmuxEnabled,
		requestOpen: (onOpen) =>
			input.getCommittedDependencies().arbiter.requestOpen({
				target: 'worktree-workspace',
				conflicts: WORKTREE_WORKSPACE_CONFLICTS,
				onOpen,
			}),
		resolveTarget: async () => {
			const current = input.getCommittedDependencies();
			const output = await runBridgeRequest(() =>
				current.workmuxControlChannel.command(
					buildWorkmuxAppContextArgv(current.sessionName),
					{ timeoutMs: WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS },
				),
			);
			return parseWorkmuxAppContextOutput(output).target;
		},
		prepareNewWorktreeWorkspace: async (target) =>
			parsePrepareNewWorktreeWorkspaceOutput(
				await runOperation(buildPrepareNewWorktreeWorkspaceRequest(target)),
			),
		createWorktreeWorkspace: async (request) =>
			parseCreateWorktreeWorkspaceOutput(
				await runOperation(buildCreateWorktreeWorkspaceRequest(request)),
			),
		prepareCloseWorktreeWorkspace: async (target) =>
			parsePrepareCloseWorktreeWorkspaceOutput(
				await runOperation(buildPrepareCloseWorktreeWorkspaceRequest(target)),
			),
		closeWorktreeWorkspace: async (request) =>
			parseCloseWorktreeWorkspaceOutput(
				await runOperation(buildCloseWorktreeWorkspaceRequest(request)),
			),
		classifyFailure: classifyWorktreeWorkspaceFailure,
		reportPrecondition: input.reportPrecondition,
		logger: input.logger,
		registerClose: (close) =>
			input
				.getCommittedDependencies()
				.arbiter.register('worktree-workspace', close),
	};
}
