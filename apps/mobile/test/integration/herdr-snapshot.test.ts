import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	HERDR_SNAPSHOT_COMMAND,
	findHerdrAgent,
	groupHerdrAgents,
	loadHerdrSnapshot,
	nextHerdrTerminalId,
	parseHerdrSnapshot,
} from '../../src/lib/herdr/snapshot';

function resolvePosixShell(): string {
	return execFileSync('sh', ['-c', 'command -v sh'], {
		encoding: 'utf8',
	}).trim();
}

function quoteShell(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function baseResponse() {
	return {
		id: 'request-1',
		result: {
			type: 'session_snapshot',
			snapshot: {
				version: '0.7.2',
				protocol: 1,
				workspaces: [
					{
						workspace_id: 'workspace-a',
						label: 'Fressh',
					},
				],
				tabs: [
					{
						tab_id: 'tab-a',
						workspace_id: 'workspace-a',
						label: 'Agents',
					},
				],
				panes: [
					{
						pane_id: 'pane-old',
						terminal_id: 'terminal-stable',
						workspace_id: 'workspace-a',
						tab_id: 'tab-a',
						label: 'Codex',
					},
				],
				agents: [
					{
						terminal_id: 'terminal-stable',
						pane_id: 'pane-old',
						workspace_id: 'workspace-a',
						tab_id: 'tab-a',
						display_agent: 'Codex',
						agent_status: 'blocked',
						foreground_cwd: '/home/muly/code/fressh',
					},
				],
			},
		},
	};
}

void test('parseHerdrSnapshot preserves stable terminal identity when pane identity changes', () => {
	const first = parseHerdrSnapshot(JSON.stringify(baseResponse()));
	const movedResponse = baseResponse();
	movedResponse.result.snapshot.panes[0]!.pane_id = 'pane-new';
	movedResponse.result.snapshot.agents[0]!.pane_id = 'pane-new';
	const moved = parseHerdrSnapshot(JSON.stringify(movedResponse));

	assert.deepEqual(first.agents[0], {
		terminalId: 'terminal-stable',
		paneId: 'pane-old',
		workspaceId: 'workspace-a',
		workspaceLabel: 'Fressh',
		tabId: 'tab-a',
		tabLabel: 'Agents',
		label: 'Codex',
		status: 'blocked',
		cwdBasename: 'fressh',
		order: 0,
	});
	assert.equal(moved.agents[0]?.terminalId, 'terminal-stable');
	assert.equal(moved.agents[0]?.paneId, 'pane-new');
	assert.equal(findHerdrAgent(moved, 'terminal-stable'), moved.agents[0]);
	assert.equal(findHerdrAgent(moved, 'pane-new'), null);
});

void test('parseHerdrSnapshot uses the authoritative agent when presentation labels are absent', () => {
	const response = baseResponse();
	const rawAgent = response.result.snapshot.agents[0]!;
	Object.assign(rawAgent, { agent: '  Claude Code  ' });
	Object.assign(response.result.snapshot.panes[0]!, { label: null });
	assert.equal(
		parseHerdrSnapshot(JSON.stringify(response)).agents[0]?.label,
		'Codex',
	);
	delete (rawAgent as { display_agent?: string }).display_agent;

	const snapshot = parseHerdrSnapshot(JSON.stringify(response));

	assert.equal(snapshot.agents[0]?.label, 'Claude Code');
	assert.notEqual(snapshot.agents[0]?.label, 'terminal-stable');
});

void test('parseHerdrSnapshot accepts future fields and normalizes unknown or missing statuses', () => {
	const response = baseResponse();
	Object.assign(response, { future_envelope_field: true });
	Object.assign(response.result, {
		future_result_field: { enabled: true },
	});
	Object.assign(response.result.snapshot, {
		future_snapshot_field: 'ignored',
	});
	response.result.snapshot.panes.push({
		pane_id: 'pane-b',
		terminal_id: 'terminal-b',
		workspace_id: 'workspace-a',
		tab_id: 'tab-a',
		label: 'Claude',
	});
	response.result.snapshot.agents[0]!.agent_status = 'paused';
	response.result.snapshot.agents.push({
		terminal_id: 'terminal-b',
		pane_id: 'pane-b',
		workspace_id: 'workspace-a',
		tab_id: 'tab-a',
		display_agent: 'Claude',
		agent_status: 'idle',
		foreground_cwd: '/',
	});
	delete (response.result.snapshot.agents[1] as { agent_status?: string })
		.agent_status;

	const snapshot = parseHerdrSnapshot(JSON.stringify(response));

	assert.deepEqual(
		snapshot.agents.map((agent) => [agent.terminalId, agent.status]),
		[
			['terminal-stable', 'unknown'],
			['terminal-b', 'unknown'],
		],
	);
	assert.equal(snapshot.agents[1]?.cwdBasename, null);
});

void test('parseHerdrSnapshot rejects duplicate and empty stable terminal IDs', () => {
	const duplicateResponse = baseResponse();
	duplicateResponse.result.snapshot.agents.push({
		...duplicateResponse.result.snapshot.agents[0]!,
	});
	assert.throws(
		() => parseHerdrSnapshot(JSON.stringify(duplicateResponse)),
		/Herdr returned an invalid snapshot/i,
	);

	const emptyResponse = baseResponse();
	emptyResponse.result.snapshot.agents[0]!.terminal_id = '';
	assert.throws(
		() => parseHerdrSnapshot(JSON.stringify(emptyResponse)),
		/Herdr returned an invalid snapshot/i,
	);
});

void test('parseHerdrSnapshot sanitizes malformed envelope errors', () => {
	const rawSecret = 'PRIVATE_SNAPSHOT_VALUE';
	const malformed = JSON.stringify({
		id: 'request-1',
		result: {
			type: 'unexpected_response',
			snapshot: { rawSecret },
		},
	});

	assert.throws(
		() => parseHerdrSnapshot(malformed),
		(error) =>
			error instanceof Error &&
			error.message === 'Herdr returned an invalid snapshot.' &&
			!error.message.includes(rawSecret) &&
			!error.message.includes(malformed),
	);
});

void test('loadHerdrSnapshot runs the compound capability probe and sanitizes availability failures', async () => {
	const commands: string[] = [];
	const snapshot = await loadHerdrSnapshot({
		run: async (command) => {
			commands.push(command);
			return JSON.stringify(baseResponse());
		},
	});

	assert.deepEqual(commands, [HERDR_SNAPSHOT_COMMAND]);
	assert.equal(
		HERDR_SNAPSHOT_COMMAND,
		'herdr_bin="$(command -v herdr 2>/dev/null || true)"; ' +
			'if [ -z "$herdr_bin" ] && [ -x "$HOME/.local/bin/herdr" ]; then ' +
			'herdr_bin="$HOME/.local/bin/herdr"; ' +
			'fi; ' +
			'[ -n "$herdr_bin" ] && ' +
			'"$herdr_bin" terminal session control --help >/dev/null 2>&1 && ' +
			'"$herdr_bin" api snapshot',
	);
	assert.equal(snapshot.version, '0.7.2');

	const rawFailure = 'PRIVATE_REMOTE_STDERR';
	await assert.rejects(
		loadHerdrSnapshot({
			run: async () => {
				throw new Error(rawFailure);
			},
		}),
		(error) =>
			error instanceof Error &&
			error.message ===
				'Herdr 0.7.2 or newer is required on the selected host.' &&
			!error.message.includes(rawFailure),
	);
});

void test('snapshot probe uses executable user-local Herdr when command lookup fails', (t) => {
	const shell = resolvePosixShell();
	const home = mkdtempSync(join(tmpdir(), 'herdr snapshot '));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const userBin = join(home, '.local', 'bin');
	mkdirSync(userBin, { recursive: true });
	const snapshotFixture = JSON.stringify(baseResponse());
	writeFileSync(
		join(userBin, 'herdr'),
		`#!${shell}\n` +
			'case "$*" in\n' +
			'  "terminal session control --help") exit 0 ;;\n' +
			`  "api snapshot") printf '%s\\n' ${quoteShell(snapshotFixture)} ;;\n` +
			'  *) exit 64 ;;\n' +
			'esac\n',
		{ mode: 0o755 },
	);
	const emptyPath = join(home, 'empty-path');
	mkdirSync(emptyPath);
	const env = { ...process.env, HOME: home, PATH: emptyPath };

	assert.throws(() => execFileSync(shell, ['-c', 'command -v herdr'], { env }));
	const output = execFileSync(shell, ['-c', HERDR_SNAPSHOT_COMMAND], {
		env,
		encoding: 'utf8',
	});

	assert.equal(parseHerdrSnapshot(output).version, '0.7.2');
});

void test('snapshot agents and groups use status then workspace, tab, and pane order', () => {
	const response = {
		id: 'request-order',
		result: {
			type: 'session_snapshot',
			snapshot: {
				version: '0.8.0',
				protocol: 2,
				workspaces: [
					{ workspace_id: 'workspace-b', label: 'First workspace' },
					{ workspace_id: 'workspace-a', label: 'Second workspace' },
				],
				tabs: [
					{
						tab_id: 'tab-b2',
						workspace_id: 'workspace-b',
						label: 'First tab',
					},
					{
						tab_id: 'tab-a',
						workspace_id: 'workspace-a',
						label: 'Second workspace tab',
					},
					{
						tab_id: 'tab-b1',
						workspace_id: 'workspace-b',
						label: 'Later tab',
					},
				],
				panes: [
					{
						pane_id: 'pane-done-late',
						terminal_id: 'done-late',
						workspace_id: 'workspace-a',
						tab_id: 'tab-a',
						label: 'Done late',
					},
					{
						pane_id: 'pane-working',
						terminal_id: 'working',
						workspace_id: 'workspace-b',
						tab_id: 'tab-b1',
						label: 'Working',
					},
					{
						pane_id: 'pane-done-early',
						terminal_id: 'done-early',
						workspace_id: 'workspace-b',
						tab_id: 'tab-b2',
						label: 'Done early',
					},
					{
						pane_id: 'pane-unknown',
						terminal_id: 'unknown',
						workspace_id: 'workspace-a',
						tab_id: 'tab-a',
						label: 'Unknown',
					},
					{
						pane_id: 'pane-blocked-late',
						terminal_id: 'blocked-late',
						workspace_id: 'workspace-a',
						tab_id: 'tab-a',
						label: 'Blocked late',
					},
					{
						pane_id: 'pane-blocked-early',
						terminal_id: 'blocked-early',
						workspace_id: 'workspace-b',
						tab_id: 'tab-b2',
						label: 'Blocked early',
					},
					{
						pane_id: 'pane-idle',
						terminal_id: 'idle',
						workspace_id: 'workspace-b',
						tab_id: 'tab-b2',
						label: 'Idle',
					},
				],
				agents: [
					['unknown', 'pane-unknown', 'unexpected'],
					['done-early', 'pane-done-early', 'done'],
					['blocked-late', 'pane-blocked-late', 'blocked'],
					['working', 'pane-working', 'working'],
					['done-late', 'pane-done-late', 'done'],
					['idle', 'pane-idle', 'idle'],
					['blocked-early', 'pane-blocked-early', 'blocked'],
				].map(([terminalId, paneId, status]) => ({
					terminal_id: terminalId,
					pane_id: paneId,
					workspace_id: 'stale-workspace-metadata',
					tab_id: 'stale-tab-metadata',
					display_agent: `Agent ${terminalId}`,
					agent_status: status,
					foreground_cwd: `/repo/${terminalId}`,
				})),
			},
		},
	};

	const snapshot = parseHerdrSnapshot(JSON.stringify(response));
	assert.deepEqual(
		snapshot.agents.map((agent) => agent.terminalId),
		[
			'blocked-early',
			'blocked-late',
			'done-early',
			'done-late',
			'working',
			'idle',
			'unknown',
		],
	);
	assert.deepEqual(
		groupHerdrAgents(snapshot.agents).map((group) => ({
			status: group.status,
			label: group.label,
			agents: group.agents.map((agent) => agent.terminalId),
		})),
		[
			{
				status: 'blocked',
				label: 'Needs attention',
				agents: ['blocked-early', 'blocked-late'],
			},
			{
				status: 'done',
				label: 'Ready',
				agents: ['done-early', 'done-late'],
			},
			{ status: 'working', label: 'Working', agents: ['working'] },
			{ status: 'idle', label: 'Idle', agents: ['idle'] },
			{ status: 'unknown', label: 'Unknown', agents: ['unknown'] },
		],
	);
	assert.deepEqual(
		snapshot.agents.map((agent) => agent.order),
		[1, 6, 0, 4, 3, 2, 5],
	);
});

void test('nextHerdrTerminalId wraps in both directions and rejects missing current IDs', () => {
	const snapshot = parseHerdrSnapshot(JSON.stringify(baseResponse()));
	const agents = [
		snapshot.agents[0]!,
		{
			...snapshot.agents[0]!,
			terminalId: 'terminal-second',
			paneId: 'pane-second',
		},
	];

	assert.equal(
		nextHerdrTerminalId(agents, 'terminal-stable', 'next'),
		'terminal-second',
	);
	assert.equal(
		nextHerdrTerminalId(agents, 'terminal-second', 'next'),
		'terminal-stable',
	);
	assert.equal(
		nextHerdrTerminalId(agents, 'terminal-stable', 'previous'),
		'terminal-second',
	);
	assert.equal(
		nextHerdrTerminalId(agents, 'terminal-second', 'previous'),
		'terminal-stable',
	);
	assert.equal(nextHerdrTerminalId(agents, 'pane-old', 'next'), null);
	assert.equal(nextHerdrTerminalId([], 'terminal-stable', 'next'), null);
});
