import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	type HerdrAgent,
	type HerdrHostState,
	type HerdrSnapshot,
} from '../../src/lib/herdr/contracts';
import { useHerdrProviderStore } from '../../src/lib/herdr/provider-store';
import { findHerdrAgent } from '../../src/lib/herdr/snapshot';

function agent(overrides: Partial<HerdrAgent> = {}): HerdrAgent {
	return {
		terminalId: 'terminal-stable',
		paneId: 'pane-old',
		workspaceId: 'workspace-old',
		workspaceLabel: 'Old workspace',
		tabId: 'tab-old',
		tabLabel: 'Old tab',
		label: 'Codex',
		status: 'working',
		cwdBasename: 'fressh',
		order: 0,
		...overrides,
	};
}

function snapshot(agents: readonly HerdrAgent[]): HerdrSnapshot {
	return { version: '0.7.2', protocol: 1, agents };
}

function host(overrides: Partial<HerdrHostState> = {}): HerdrHostState {
	return {
		storedConnectionId: 'muly-host-22',
		connectionId: 'connection-1',
		snapshot: snapshot([agent()]),
		...overrides,
	};
}

void test('provider store atomically replaces its one active host', () => {
	useHerdrProviderStore.getState().clearHost();
	const first = host();
	const replacement = host({
		storedConnectionId: 'root-other-2222',
		connectionId: 'connection-2',
		snapshot: snapshot([
			agent({ terminalId: 'terminal-other', paneId: 'pane-other' }),
		]),
	});
	const observedHosts: (HerdrHostState | null)[] = [];
	const unsubscribe = useHerdrProviderStore.subscribe((state) => {
		observedHosts.push(state.host);
	});

	try {
		useHerdrProviderStore.getState().setHost(first);
		useHerdrProviderStore.getState().setHost(replacement);
	} finally {
		unsubscribe();
	}

	assert.equal(useHerdrProviderStore.getState().host, replacement);
	assert.deepEqual(observedHosts, [first, replacement]);
	assert.deepEqual(Object.keys(useHerdrProviderStore.getState()).sort(), [
		'clearHost',
		'host',
		'setHost',
	]);
});

void test('route-local terminal identity reconciles until the terminal disappears', () => {
	useHerdrProviderStore.getState().clearHost();
	const terminalId = 'terminal-stable';
	useHerdrProviderStore.getState().setHost(host());

	const movedAgent = agent({
		paneId: 'pane-new',
		workspaceId: 'workspace-new',
		workspaceLabel: 'New workspace',
		tabId: 'tab-new',
		tabLabel: 'New tab',
	});
	useHerdrProviderStore
		.getState()
		.setHost(host({ snapshot: snapshot([movedAgent]) }));

	const movedHost = useHerdrProviderStore.getState().host;
	assert.ok(movedHost);
	assert.equal(findHerdrAgent(movedHost.snapshot, terminalId), movedAgent);
	assert.equal(findHerdrAgent(movedHost.snapshot, 'pane-new'), null);

	useHerdrProviderStore.getState().setHost(host({ snapshot: snapshot([]) }));
	const emptyHost = useHerdrProviderStore.getState().host;
	assert.ok(emptyHost);
	assert.equal(findHerdrAgent(emptyHost.snapshot, terminalId), null);
	assert.equal('selectedTerminalId' in useHerdrProviderStore.getState(), false);
});

void test('provider store has no persistence or serialization boundary', async () => {
	const source = await readFile(
		new URL('../../src/lib/herdr/provider-store.ts', import.meta.url),
		'utf8',
	);

	assert.doesNotMatch(source, /\bpersist\s*\(/);
	assert.doesNotMatch(source, /\b(?:serialize|deserialize|storage)\b/i);
	assert.doesNotMatch(source, /selectedTerminal/i);
});
