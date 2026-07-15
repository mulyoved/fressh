import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WORKTREE_WORKSPACE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_CREATE_OPERATION_ID,
	WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS,
	WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
	WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
	buildCloseWorktreeWorkspaceRequest,
	buildCreateWorktreeWorkspaceRequest,
	buildPrepareCloseWorktreeWorkspaceRequest,
	buildPrepareNewWorktreeWorkspaceRequest,
	parseCloseWorktreeWorkspaceOutput,
	parseCreateWorktreeWorkspaceOutput,
	parsePrepareCloseWorktreeWorkspaceOutput,
	parsePrepareNewWorktreeWorkspaceOutput,
} from '../../src/lib/worktree-workspace-bridge';

const INVALID_RESPONSE_MESSAGE = 'Invalid worktree workspace bridge response.';
const CLOSE_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

const newPreparation = {
	target: 'main:codex',
	repositoryName: 'fressh',
	projectRoot: '/home/muly/code/fressh',
	suggestedBranch: 'worktree/fressh',
};

const closePreparation = {
	session: 'main',
	workspaceId: 'workspace-42',
	workspaceLabel: 'fressh (workspace-42)',
	worktreePath: '/home/muly/code/fressh/.worktrees/workspace-42',
	closeFingerprint: CLOSE_FINGERPRINT,
	windows: [
		{ id: '@12', name: 'codex' },
		{ id: '@13', name: 'shell' },
	],
};

function assertInvalidResponse(
	parse: (output: string) => unknown,
	output: string,
): void {
	let error: unknown;
	try {
		parse(output);
	} catch (caught) {
		error = caught;
	}
	assert.ok(error instanceof Error);
	assert.equal(error.message, INVALID_RESPONSE_MESSAGE);
	assert.equal('cause' in error, false);
}

void test('worktree workspace request builders preserve exact operation contracts', () => {
	const cases = [
		{
			name: 'prepare new',
			actual: buildPrepareNewWorktreeWorkspaceRequest(' main:codex '),
			expected: {
				operation: 'tmux.worktree.new.prepare',
				params: { target: ' main:codex ' },
			},
		},
		{
			name: 'create',
			actual: buildCreateWorktreeWorkspaceRequest({
				target: ' main:codex ',
				expectedProjectRoot: ' /home/muly/code/fressh ',
				branch: ' feature/worktree ',
			}),
			expected: {
				operation: 'tmux.worktree.new',
				params: {
					target: ' main:codex ',
					expectedProjectRoot: ' /home/muly/code/fressh ',
					branch: ' feature/worktree ',
				},
			},
		},
		{
			name: 'prepare close',
			actual: buildPrepareCloseWorktreeWorkspaceRequest(' main:codex '),
			expected: {
				operation: 'tmux.worktree.close.prepare',
				params: { target: ' main:codex ' },
			},
		},
		{
			name: 'close',
			actual: buildCloseWorktreeWorkspaceRequest({
				session: ' main ',
				workspaceId: ' workspace-42 ',
				expectedWorktreePath: ' /tmp/worktree ',
				expectedCloseFingerprint: ` ${CLOSE_FINGERPRINT} `,
			}),
			expected: {
				operation: 'tmux.worktree.close',
				params: {
					session: ' main ',
					workspaceId: ' workspace-42 ',
					expectedWorktreePath: ' /tmp/worktree ',
					expectedCloseFingerprint: ` ${CLOSE_FINGERPRINT} `,
				},
			},
		},
	] as const;

	for (const { name, actual, expected } of cases) {
		assert.deepEqual(actual, expected, name);
	}
});

void test('worktree workspace bridge constants use the binding wire values', () => {
	assert.equal(
		WORKTREE_WORKSPACE_PREPARE_NEW_OPERATION_ID,
		'tmux.worktree.new.prepare',
	);
	assert.equal(WORKTREE_WORKSPACE_CREATE_OPERATION_ID, 'tmux.worktree.new');
	assert.equal(
		WORKTREE_WORKSPACE_PREPARE_CLOSE_OPERATION_ID,
		'tmux.worktree.close.prepare',
	);
	assert.equal(WORKTREE_WORKSPACE_CLOSE_OPERATION_ID, 'tmux.worktree.close');
	assert.equal(WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS, 60_000);
});

void test('worktree workspace output parsers accept every valid result', () => {
	const cases = [
		{
			name: 'prepare new',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			value: newPreparation,
		},
		{
			name: 'create',
			parse: parseCreateWorktreeWorkspaceOutput,
			value: { status: 'created' },
		},
		{
			name: 'prepare close',
			parse: parsePrepareCloseWorktreeWorkspaceOutput,
			value: closePreparation,
		},
		{
			name: 'close',
			parse: parseCloseWorktreeWorkspaceOutput,
			value: { status: 'closed' },
		},
	] as const;

	for (const { name, parse, value } of cases) {
		assert.deepEqual(parse(`${JSON.stringify(value)}\n\t`), value, name);
	}
});

void test('worktree workspace output parsers reject invalid response categories', () => {
	const cases: readonly {
		name: string;
		parse: (output: string) => unknown;
		output: string;
	}[] = [
		{
			name: 'malformed JSON',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			output: '{not-json}',
		},
		{
			name: 'trailing non-whitespace',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			output: `${JSON.stringify(newPreparation)} trailing`,
		},
		{
			name: 'leading JSON whitespace',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			output: ` ${JSON.stringify(newPreparation)}`,
		},
		{
			name: 'unknown top-level key',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			output: JSON.stringify({ ...newPreparation, extra: 'rejected' }),
		},
		{
			name: 'unknown nested window key',
			parse: parsePrepareCloseWorktreeWorkspaceOutput,
			output: JSON.stringify({
				...closePreparation,
				windows: [{ id: '@12', name: 'codex', extra: 'rejected' }],
			}),
		},
		{
			name: 'wrong create status',
			parse: parseCreateWorktreeWorkspaceOutput,
			output: JSON.stringify({ status: 'closed' }),
		},
		{
			name: 'wrong close status',
			parse: parseCloseWorktreeWorkspaceOutput,
			output: JSON.stringify({ status: 'created' }),
		},
		{
			name: 'invalid close fingerprint',
			parse: parsePrepareCloseWorktreeWorkspaceOutput,
			output: JSON.stringify({
				...closePreparation,
				closeFingerprint: `sha256:${'A'.repeat(64)}`,
			}),
		},
		{
			name: 'empty close windows',
			parse: parsePrepareCloseWorktreeWorkspaceOutput,
			output: JSON.stringify({ ...closePreparation, windows: [] }),
		},
		{
			name: 'empty response string field',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			output: JSON.stringify({ ...newPreparation, repositoryName: '' }),
		},
		{
			name: 'empty window string field',
			parse: parsePrepareCloseWorktreeWorkspaceOutput,
			output: JSON.stringify({
				...closePreparation,
				windows: [{ id: '@12', name: '' }],
			}),
		},
		{
			name: 'missing field',
			parse: parsePrepareNewWorktreeWorkspaceOutput,
			output: JSON.stringify({
				target: newPreparation.target,
				repositoryName: newPreparation.repositoryName,
				projectRoot: newPreparation.projectRoot,
			}),
		},
		{
			name: 'wrong field type',
			parse: parsePrepareCloseWorktreeWorkspaceOutput,
			output: JSON.stringify({ ...closePreparation, session: 42 }),
		},
	];

	for (const { name, parse, output } of cases) {
		assert.doesNotThrow(() => assertInvalidResponse(parse, output), name);
	}
});
