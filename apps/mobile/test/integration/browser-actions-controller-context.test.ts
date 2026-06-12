import assert from 'node:assert/strict';
import test from 'node:test';
import {
	runBrowserActionsDiffityShare,
	runBrowserActionsDiffityShareWithContext,
	resolveBrowserActionsWorkspace,
} from '../../src/lib/browser-actions-controller-actions';
import { HostDiffityShareError } from '../../src/lib/host-diffity-open-request';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	type WorkmuxAppContext,
} from '../../src/lib/workmux-app-commands';

type BrowserActionsRemoteCommand = {
	command: string;
	timeoutMs: number;
};

const context: WorkmuxAppContext = {
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 12,
	windowName: 'mobile',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
	paneId: '%34',
	paneTty: '/dev/pts/12',
	panePath: "/home/muly/fressh/apps/mobile's",
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
};

function createRemoteHarness(options?: {
	contextFailure?: { output?: string; error?: string };
}) {
	const commands: BrowserActionsRemoteCommand[] = [];
	const workmuxCommands: { argv: string[]; timeoutMs: number }[] = [];

	return {
		commands,
		workmuxCommands,
		runHostBrowserCommand: async (
			command: string,
			timeoutMs: number,
		): Promise<string> => {
			commands.push({ command, timeoutMs });
			if (command.includes('mdev diffity share')) {
				return 'https://example.test/diff';
			}
			return '';
		},
		runWorkmuxCommand: async (
			argv: string[],
			timeoutMs: number,
		): Promise<string> => {
			workmuxCommands.push({ argv, timeoutMs });
			const failure = options?.contextFailure;
			if (failure) {
				throw new Error(
					failure.error ?? failure.output ?? 'Remote command failed.',
				);
			}
			return JSON.stringify(context);
		},
	};
}

void test('browser actions diffity resolves pane path through Workmux app context', async () => {
	const harness = createRemoteHarness();

	const result = await runBrowserActionsDiffityShareWithContext({
		tmuxEnabled: true,
		tmuxTarget: "main'quoted",
		runHostBrowserCommand: harness.runHostBrowserCommand,
		runWorkmuxCommand: harness.runWorkmuxCommand,
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.deepEqual(result, {
		output: 'https://example.test/diff',
		panePath: "/home/muly/fressh/apps/mobile's",
		command: "cd '/home/muly/fressh/apps/mobile'\\''s' && mdev diffity share",
	});
	assert.deepEqual(harness.workmuxCommands, [
		{
			argv: ['tmux', 'app', 'context', '--session', "main'quoted"],
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(harness.commands, [
		{
			command: "cd '/home/muly/fressh/apps/mobile'\\''s' && mdev diffity share",
			timeoutMs: 60_000,
		},
	]);
});

void test('browser actions diffity legacy helper returns output string', async () => {
	const harness = createRemoteHarness();

	const output = await runBrowserActionsDiffityShare({
		tmuxEnabled: true,
		tmuxTarget: "main'quoted",
		runHostBrowserCommand: harness.runHostBrowserCommand,
		runWorkmuxCommand: harness.runWorkmuxCommand,
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.equal(output, 'https://example.test/diff');
});

void test('browser actions diffity legacy helper preserves host command rejection', async () => {
	const harness = createRemoteHarness();
	const commandFailure = new Error('diffity share failed hard');

	await assert.rejects(
		runBrowserActionsDiffityShare({
			tmuxEnabled: true,
			tmuxTarget: 'main',
			runHostBrowserCommand: async () => {
				throw commandFailure;
			},
			runWorkmuxCommand: harness.runWorkmuxCommand,
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		(error) => {
			assert.equal(error, commandFailure);
			return true;
		},
	);
});

void test('browser actions diffity wraps host command rejection with command context', async () => {
	const harness = createRemoteHarness();
	const commandFailure = new Error('diffity share failed hard');
	const commands: BrowserActionsRemoteCommand[] = [];

	await assert.rejects(
		runBrowserActionsDiffityShareWithContext({
			tmuxEnabled: true,
			tmuxTarget: 'main',
			runHostBrowserCommand: async (command, timeoutMs) => {
				commands.push({ command, timeoutMs });
				throw commandFailure;
			},
			runWorkmuxCommand: harness.runWorkmuxCommand,
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		(error) => {
			assert.ok(error instanceof HostDiffityShareError);
			assert.equal(error.message, 'diffity share failed hard');
			assert.equal(error.panePath, "/home/muly/fressh/apps/mobile's");
			assert.equal(
				error.command,
				"cd '/home/muly/fressh/apps/mobile'\\''s' && mdev diffity share",
			);
			assert.equal(
				(error as Error & { cause?: unknown }).cause,
				commandFailure,
			);
			return true;
		},
	);
	assert.deepEqual(commands, [
		{
			command: "cd '/home/muly/fressh/apps/mobile'\\''s' && mdev diffity share",
			timeoutMs: 60_000,
		},
	]);
});

void test('browser actions resolves workspace through Workmux app context', async () => {
	const harness = createRemoteHarness();

	const workspace = await resolveBrowserActionsWorkspace({
		tmuxEnabled: true,
		tmuxTarget: 'main',
		runHostBrowserCommand: harness.runHostBrowserCommand,
		runWorkmuxCommand: harness.runWorkmuxCommand,
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.deepEqual(harness.workmuxCommands, [
		{
			argv: ['tmux', 'app', 'context', '--session', 'main'],
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(workspace, {
		panePath: "/home/muly/fressh/apps/mobile's",
		projectRoot: '/home/muly/fressh',
		projectName: 'fressh',
	});
});

void test('browser actions format old mdev Workmux app context failures', async () => {
	const harness = createRemoteHarness({
		contextFailure: { error: 'mdev: command not found' },
	});

	await assert.rejects(
		runBrowserActionsDiffityShareWithContext({
			tmuxEnabled: true,
			tmuxTarget: 'main',
			runHostBrowserCommand: harness.runHostBrowserCommand,
			runWorkmuxCommand: harness.runWorkmuxCommand,
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		(error) => {
			assert.equal(
				error instanceof Error ? error.message : String(error),
				WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
			);
			return true;
		},
	);
});
