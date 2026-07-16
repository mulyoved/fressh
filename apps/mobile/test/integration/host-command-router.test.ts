import assert from 'node:assert/strict';
import test from 'node:test';
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../../src/lib/host-browser-actions';
import { runHostCommandWithBoundary } from '../../src/lib/host-command-router';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

void test('runHostCommandWithBoundary sends Workmux app commands to bridge argv transport', async () => {
	const calls: { argv: string[]; timeoutMs: number }[] = [];
	const output = await runHostCommandWithBoundary({
		hostCommands: { key: 'host' as never, run: async () => assert.fail() },
		command: "mdev tmux app window --session 'main'",
		timeoutMs: 10_000,
		workmux: {
			command: async (argv, options) => {
				calls.push({ argv, timeoutMs: options?.timeoutMs ?? 0 });
				return { status: 'completed', output: '{"windowId":"@12"}' };
			},
		},
	});

	assert.equal(output, '{"windowId":"@12"}');
	assert.deepEqual(calls, [
		{ argv: ['tmux', 'app', 'window', '--session', 'main'], timeoutMs: 10_000 },
	]);
});

void test('runHostCommandWithBoundary rejects missing connection before any transport', async () => {
	let workmuxCalls = 0;

	await assert.rejects(
		runHostCommandWithBoundary({
			hostCommands: null,
			command: "mdev tmux app window --session 'main'",
			timeoutMs: 10_000,
			workmux: {
				command: async () => {
					workmuxCalls += 1;
					return { status: 'completed', output: '' };
				},
			},
		}),
		(error) =>
			error instanceof Error &&
			error.message === HOST_BROWSER_NO_CONNECTION_MESSAGE,
	);
	assert.equal(workmuxCalls, 0);
});

void test('runHostCommandWithBoundary parses quoted Workmux app command values', async () => {
	const calls: string[][] = [];
	await runHostCommandWithBoundary({
		hostCommands: { key: 'host' as never, run: async () => assert.fail() },
		command: "mdev tmux app focus 'don'\\''t' --session 'main session'",
		timeoutMs: 10_000,
		workmux: {
			command: async (argv) => {
				calls.push(argv);
				return { status: 'completed', output: '' };
			},
		},
	});

	assert.deepEqual(calls, [
		['tmux', 'app', 'focus', "don't", '--session', 'main session'],
	]);
});

void test('runHostCommandWithBoundary preserves side channel for non-Workmux commands', async () => {
	const calls: string[] = [];
	const output = await runHostCommandWithBoundary({
		hostCommands: {
			key: 'host' as never,
			run: async (command, timeoutMs) => {
				calls.push(`side:${command}:${timeoutMs}`);
				return {
					status: 'completed',
					output: 'git@github.com:mulyoved/fressh.git\n',
				};
			},
		},
		command: 'git remote get-url origin',
		timeoutMs: 20_000,
	});

	assert.equal(output, 'git@github.com:mulyoved/fressh.git');
	assert.deepEqual(calls, ['side:git remote get-url origin:20000']);
});

void test('runHostCommandWithBoundary does not emit debug fetches for side-channel commands', async () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls += 1;
		return new Response(null, { status: 204 });
	}) as typeof fetch;
	try {
		const output = await runHostCommandWithBoundary({
			hostCommands: {
				key: 'host' as never,
				run: async () => ({ status: 'completed', output: 'clean\n' }),
			},
			command: 'git status',
			timeoutMs: 20_000,
		});

		assert.equal(output, 'clean');
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

void test('runHostCommandWithBoundary tells users to update mdev for old Workmux command failures', async () => {
	await assert.rejects(
		runHostCommandWithBoundary({
			hostCommands: { key: 'host' as never, run: async () => assert.fail() },
			command: "mdev tmux app context --session 'main'",
			timeoutMs: 10_000,
			workmux: {
				command: async () => ({
					status: 'failed',
					failure: { message: 'Unknown tmux command: nav' },
				}),
			},
		}),
		(error) =>
			error instanceof Error &&
			error.message === WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
});

void test('runHostCommandWithBoundary throws side-channel failures', async () => {
	await assert.rejects(
		runHostCommandWithBoundary({
			hostCommands: {
				key: 'host' as never,
				run: async () => ({
					status: 'failed',
					failure: { message: 'Remote command failed.' },
				}),
			},
			command: 'git status',
			timeoutMs: 10_000,
		}),
		/Remote command failed/,
	);
});
