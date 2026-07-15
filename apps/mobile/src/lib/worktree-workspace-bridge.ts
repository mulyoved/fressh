import { z } from 'zod';
import { type MdevBridgeOperationRequest } from './workmux-bridge-operations';

export const WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID =
	'tmux.worktree.new.prepare';
export const WORKTREE_WORKSPACE_CREATE_OPERATION_ID = 'tmux.worktree.new';
export const WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID =
	'tmux.worktree.close.prepare';
export const WORKTREE_WORKSPACE_CLOSE_OPERATION_ID = 'tmux.worktree.close';
export const WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS = 60_000;

export type WorktreeWorkspaceWindow = Readonly<{
	id: string;
	name: string;
}>;

export type NewWorktreeWorkspacePreparation = Readonly<{
	target: string;
	repositoryName: string;
	projectRoot: string;
	suggestedBranch: string;
}>;

export type CloseWorktreeWorkspacePreparation = Readonly<{
	session: string;
	workspaceId: string;
	workspaceLabel: string;
	worktreePath: string;
	closeFingerprint: string;
	windows: readonly WorktreeWorkspaceWindow[];
}>;

export type CreateWorktreeWorkspaceResult = Readonly<{
	status: 'created';
}>;

export type CloseWorktreeWorkspaceResult = Readonly<{
	status: 'closed';
}>;

const invalidResponseMessage = 'Invalid worktree workspace bridge response.';
const nonEmptyStringSchema = z.string().min(1);
const worktreeWorkspaceWindowSchema = z.strictObject({
	id: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
});
const newWorktreeWorkspacePreparationSchema = z.strictObject({
	target: nonEmptyStringSchema,
	repositoryName: nonEmptyStringSchema,
	projectRoot: nonEmptyStringSchema,
	suggestedBranch: nonEmptyStringSchema,
});
const closeWorktreeWorkspacePreparationSchema = z.strictObject({
	session: nonEmptyStringSchema,
	workspaceId: nonEmptyStringSchema,
	workspaceLabel: nonEmptyStringSchema,
	worktreePath: nonEmptyStringSchema,
	closeFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	windows: z.array(worktreeWorkspaceWindowSchema).min(1),
});
const createWorktreeWorkspaceResultSchema = z.strictObject({
	status: z.literal('created'),
});
const closeWorktreeWorkspaceResultSchema = z.strictObject({
	status: z.literal('closed'),
});

function parseWorktreeWorkspaceOutput<T>(
	output: string,
	schema: z.ZodType<T>,
): T {
	try {
		if (/^[\t\n\r ]/.test(output)) throw new Error();
		return schema.parse(JSON.parse(output));
	} catch {
		throw new Error(invalidResponseMessage);
	}
}

export function buildPrepareNewWorktreeWorkspaceRequest(
	target: string,
): MdevBridgeOperationRequest {
	return {
		operation: WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
		params: { target },
	};
}

export function buildCreateWorktreeWorkspaceRequest(
	input: Readonly<{
		target: string;
		expectedProjectRoot: string;
		branch: string;
	}>,
): MdevBridgeOperationRequest {
	return {
		operation: WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
		params: {
			target: input.target,
			expectedProjectRoot: input.expectedProjectRoot,
			branch: input.branch,
		},
	};
}

export function buildPrepareCloseWorktreeWorkspaceRequest(
	target: string,
): MdevBridgeOperationRequest {
	return {
		operation: WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
		params: { target },
	};
}

export function buildCloseWorktreeWorkspaceRequest(
	input: Readonly<{
		session: string;
		workspaceId: string;
		expectedWorktreePath: string;
		expectedCloseFingerprint: string;
	}>,
): MdevBridgeOperationRequest {
	return {
		operation: WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
		params: {
			session: input.session,
			workspaceId: input.workspaceId,
			expectedWorktreePath: input.expectedWorktreePath,
			expectedCloseFingerprint: input.expectedCloseFingerprint,
		},
	};
}

export function parsePrepareNewWorktreeWorkspaceOutput(
	output: string,
): NewWorktreeWorkspacePreparation {
	return parseWorktreeWorkspaceOutput(
		output,
		newWorktreeWorkspacePreparationSchema,
	);
}

export function parseCreateWorktreeWorkspaceOutput(
	output: string,
): CreateWorktreeWorkspaceResult {
	return parseWorktreeWorkspaceOutput(
		output,
		createWorktreeWorkspaceResultSchema,
	);
}

export function parsePrepareCloseWorktreeWorkspaceOutput(
	output: string,
): CloseWorktreeWorkspacePreparation {
	return parseWorktreeWorkspaceOutput(
		output,
		closeWorktreeWorkspacePreparationSchema,
	);
}

export function parseCloseWorktreeWorkspaceOutput(
	output: string,
): CloseWorktreeWorkspaceResult {
	return parseWorktreeWorkspaceOutput(
		output,
		closeWorktreeWorkspaceResultSchema,
	);
}
