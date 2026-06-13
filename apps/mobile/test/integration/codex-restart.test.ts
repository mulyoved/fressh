import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CODEX_RESTART_WORKMUX_DISABLED_MESSAGE,
	restartCodexWithBridge,
	type CodexRestartDeps,
} from '../../src/lib/codex-restart';
import { MDEV_BRIDGE_UPDATE_MESSAGE } from '../../src/lib/mdev-bridge-client';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

const contextOutput = JSON.stringify({
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 1,
	windowName: 'codex',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	paneId: '%34',
	paneTty: '/dev/pts/12',
	panePath: '/home/muly/fressh',
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
});

function createRestartDeps(
	overrides: Partial<CodexRestartDeps> = {},
): CodexRestartDeps & {
	failures: string[];
	commandCalls: {
		argv: string[];
		timeoutMs?: number;
	}[];
	operationCalls: {
		operation: string;
		params: Record<string, string | number>;
		timeoutMs?: number;
	}[];
} {
	const failures: string[] = [];
	const commandCalls: {
		argv: string[];
		timeoutMs?: number;
	}[] = [];
	const operationCalls: {
		operation: string;
		params: Record<string, string | number>;
		timeoutMs?: number;
	}[] = [];
	const workmuxControlChannel: CodexRestartDeps['workmuxControlChannel'] = {
		command: async (argv, options) => {
			commandCalls.push({
				argv,
				...(options?.timeoutMs === undefined
					? {}
					: { timeoutMs: options.timeoutMs }),
			});
			return { success: true, output: contextOutput };
		},
		operation: async (request, options) => {
			operationCalls.push({
				operation: request.operation,
				params: request.params,
				...(options?.timeoutMs === undefined
					? {}
					: { timeoutMs: options.timeoutMs }),
			});
			return { success: true, output: '' };
		},
	};

	return {
		tmuxEnabled: true,
		sessionName: 'main',
		workmuxControlChannel,
		showFailure: (message) => {
			failures.push(message);
		},
		...overrides,
		failures,
		commandCalls,
		operationCalls,
	};
}

void test('resolves Workmux context and restarts Codex through the bridge', async () => {
	const deps = createRestartDeps();

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'handled' });
	assert.deepEqual(deps.commandCalls, [
		{
			argv: ['tmux', 'app', 'context', '--session', 'main'],
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(deps.operationCalls, [
		{
			operation: 'codex.restart',
			params: { target: 'main:@12' },
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(deps.failures, []);
});

void test('rejects before bridge calls when Workmux is disabled', async () => {
	const deps = createRestartDeps({ tmuxEnabled: false });

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(deps.failures, [CODEX_RESTART_WORKMUX_DISABLED_MESSAGE]);
	assert.deepEqual(deps.commandCalls, []);
	assert.deepEqual(deps.operationCalls, []);
});

void test('maps old Workmux app context command failures to update guidance', async () => {
	const deps = createRestartDeps();
	deps.workmuxControlChannel.command = async () => ({
		success: false,
		output: '',
		error: 'Unknown tmux command: app',
	});

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(deps.failures, [WORKMUX_APP_COMMAND_UPDATE_MESSAGE]);
	assert.deepEqual(deps.operationCalls, []);
});

void test('maps rejected Workmux app context calls to failure guidance', async () => {
	const deps = createRestartDeps();
	deps.workmuxControlChannel.command = async () => {
		throw new Error('Unknown tmux command: app');
	};

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(deps.failures, [WORKMUX_APP_COMMAND_UPDATE_MESSAGE]);
	assert.deepEqual(deps.operationCalls, []);
});

void test('preserves ordinary Workmux app context command failures', async () => {
	for (const error of [
		'No SSH connection available.',
		'tmux session not found',
	]) {
		const deps = createRestartDeps();
		deps.workmuxControlChannel.command = async () => ({
			success: false,
			output: '',
			error,
		});

		const result = await restartCodexWithBridge(deps);

		assert.deepEqual(result, { status: 'failed' });
		assert.deepEqual(deps.failures, [error]);
		assert.deepEqual(deps.operationCalls, []);
	}
});

void test('reports invalid Workmux app context output', async () => {
	const deps = createRestartDeps();
	deps.workmuxControlChannel.command = async () => ({
		success: true,
		output: '{"target":""}',
	});

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(deps.failures, ['Invalid Workmux app context']);
	assert.deepEqual(deps.operationCalls, []);
});

void test('returns failed when failure notification rejects after command failure', async () => {
	let attemptedFailure = '';
	const deps = createRestartDeps({
		showFailure: async (message) => {
			attemptedFailure = message;
			throw new Error('Alert failed');
		},
	});
	deps.workmuxControlChannel.command = async () => ({
		success: false,
		output: '',
		error: 'No SSH connection available.',
	});

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.equal(attemptedFailure, 'No SSH connection available.');
	assert.deepEqual(deps.operationCalls, []);
});

void test('maps unsupported Codex restart bridge operation to update guidance', async () => {
	for (const error of [
		'Unsupported operation: codex.restart',
		'Unknown operation codex.restart',
		'operation not supported',
		'missing codex.restart bridge operation',
		'Missing bridge operation: codex.restart',
		'Missing operation codex.restart',
		'codex.restart not-supported',
		'codex.restart is not implemented by this bridge',
	]) {
		const deps = createRestartDeps();
		deps.workmuxControlChannel.command = async () => ({
			success: true,
			output: contextOutput,
		});
		deps.workmuxControlChannel.operation = async () => ({
			success: false,
			output: '',
			error,
		});

		const result = await restartCodexWithBridge(deps);

		assert.deepEqual(result, { status: 'failed' });
		assert.deepEqual(deps.failures, [MDEV_BRIDGE_UPDATE_MESSAGE]);
	}
});

void test('maps rejected Codex restart bridge operation support failures to update guidance', async () => {
	const deps = createRestartDeps();
	deps.workmuxControlChannel.operation = async () => {
		throw new Error('operation not supported');
	};

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(deps.failures, [MDEV_BRIDGE_UPDATE_MESSAGE]);
});

void test('returns failed when failure notification rejects after operation failure', async () => {
	let attemptedFailure = '';
	const deps = createRestartDeps({
		showFailure: async (message) => {
			attemptedFailure = message;
			throw new Error('Alert failed');
		},
	});
	deps.workmuxControlChannel.operation = async () => ({
		success: false,
		output: '',
		error: 'operation not supported for target main:@12',
	});

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.equal(attemptedFailure, 'operation not supported for target main:@12');
});

void test('preserves real Codex restart bridge operation failures', async () => {
	for (const error of [
		'codex.restart failed: no Codex pane found',
		'codex.restart failed: missing Codex pane',
		'codex.restart failed: unknown target main:@12',
		'codex.restart failed: unsupported target',
		'operation not supported for target main:@12',
	]) {
		const deps = createRestartDeps();
		deps.workmuxControlChannel.command = async () => ({
			success: true,
			output: contextOutput,
		});
		deps.workmuxControlChannel.operation = async () => ({
			success: false,
			output: '',
			error,
		});

		const result = await restartCodexWithBridge(deps);

		assert.deepEqual(result, { status: 'failed' });
		assert.deepEqual(deps.failures, [error]);
	}
});

void test('preserves rejected real Codex restart bridge operation failures', async () => {
	const deps = createRestartDeps();
	deps.workmuxControlChannel.operation = async () => {
		throw new Error('operation not supported for target main:@12');
	};

	const result = await restartCodexWithBridge(deps);

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(deps.failures, [
		'operation not supported for target main:@12',
	]);
});
