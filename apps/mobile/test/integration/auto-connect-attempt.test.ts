import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptAutoConnectSource } from '../../src/lib/auto-connect-attempt';
import { type SavedConnectionEntry } from '../../src/lib/connection-utils';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep secrets-manager fully type-only so Node integration tests do not load React Native at runtime
import type { InputConnectionDetails } from '../../src/lib/secrets-manager';

type OpenSavedEntryShellArgs = {
	connectionDetails: InputConnectionDetails;
	resolvedSecurity: {
		type: 'key';
		privateKey: string;
	};
	navigate: (params: { connectionId: string; channelId: number }) => void;
};

const baseDetails: InputConnectionDetails = {
	username: 'muly',
	host: 'host.example',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key', keyId: 'key-1' },
};

function createLogger() {
	const calls: unknown[] = [];
	return {
		calls,
		logger: {
			info: (...args: unknown[]) => {
				calls.push(['info', ...args]);
			},
			warn: (...args: unknown[]) => {
				calls.push(['warn', ...args]);
			},
		},
	};
}

function createSavedEntry(
	value: SavedConnectionEntry['value'] = baseDetails,
): SavedConnectionEntry {
	return {
		id: 'saved-1',
		metadata: {
			createdAtMs: 1,
			modifiedAtMs: 2,
			priority: 0,
		},
		value,
	};
}

const unsupportedRecovery = {
	ensureReady: async () => ({
		kind: 'unsupported' as const,
		attempted: false as const,
		available: false as const,
	}),
	recoverAfterFailure: async () => ({
		kind: 'nonNetworkFailure' as const,
		attempted: false as const,
		networkLikeFailure: false as const,
		available: true,
	}),
};

const readyRecovery = {
	ensureReady: async () => ({
		kind: 'ready' as const,
		attempted: true as const,
		available: true as const,
	}),
	recoverAfterFailure: async () => ({
		kind: 'nonNetworkFailure' as const,
		attempted: false as const,
		networkLikeFailure: false as const,
		available: true,
	}),
};

void test('active shell navigates outside shell detail', async () => {
	const navigations: [string, number][] = [];
	let clearAttentionCount = 0;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: {
			connectionId: 'conn-1',
			channelId: 7,
			createdAtMs: 100,
		},
		connections: {},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => null,
		navigateToShell: (connectionId, channelId) => {
			navigations.push([connectionId, channelId]);
		},
		recovery: unsupportedRecovery,
		markTailscaleAttention: () => {
			throw new Error('attention should not be marked');
		},
		clearTailscaleAttention: () => {
			clearAttentionCount += 1;
		},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['conn-1', 7]]);
	assert.equal(clearAttentionCount, 1);
});

void test('active shell does not navigate when already on shell detail', async () => {
	const navigations: [string, number][] = [];
	let clearAttentionCount = 0;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: {
			connectionId: 'conn-1',
			channelId: 7,
			createdAtMs: 100,
		},
		connections: {},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => null,
		navigateToShell: (connectionId, channelId) => {
			navigations.push([connectionId, channelId]);
		},
		recovery: unsupportedRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {
			clearAttentionCount += 1;
		},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, []);
	assert.equal(clearAttentionCount, 1);
});

void test('latest active connection loads tmux settings, starts shell, and navigates', async () => {
	const navigations: [string, number][] = [];
	const shellStarts: unknown[] = [];
	let clearAttentionCount = 0;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {
			older: {
				connectionId: 'older',
				connectedAtMs: 10,
				connectionDetails: baseDetails,
				startShell: async () => {
					throw new Error('older connection should not be used');
				},
			},
			newer: {
				connectionId: 'newer',
				connectedAtMs: 20,
				connectionDetails: baseDetails,
				startShell: async (args) => {
					shellStarts.push(args);
					return { channelId: 44 };
				},
			},
		},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadTmuxSettings: async () => ({
			useTmux: false,
			tmuxSessionName: 'ops',
		}),
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => null,
		navigateToShell: (connectionId, channelId) => {
			navigations.push([connectionId, channelId]);
		},
		recovery: unsupportedRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {
			clearAttentionCount += 1;
		},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['newer', 44]]);
	assert.equal(clearAttentionCount, 1);
	assert.equal(shellStarts.length, 1);
	assert.deepEqual(
		{
			term: (shellStarts[0] as { term: string }).term,
			useTmux: (shellStarts[0] as { useTmux: boolean }).useTmux,
			tmuxSessionName: (shellStarts[0] as { tmuxSessionName: string })
				.tmuxSessionName,
		},
		{ term: 'Xterm', useTmux: false, tmuxSessionName: 'ops' },
	);
});

void test('saved-entry path delegates through Tailscale recovery and injected opener', async () => {
	const navigations: [string, number][] = [];
	const openerCalls: OpenSavedEntryShellArgs[] = [];
	const savedDetails = {
		username: baseDetails.username,
		host: baseDetails.host,
		port: baseDetails.port,
		useTmux: baseDetails.useTmux,
		tmuxSessionName: baseDetails.tmuxSessionName,
		security: baseDetails.security,
	};
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async (args) => {
			openerCalls.push(args);
			const { navigate } = args;
			navigate({ connectionId: 'conn-2', channelId: 3 });
			return {
				status: 'connected',
				connectionId: 'conn-2',
				channelId: 3,
			};
		},
		loadLatestSavedConnection: async () => createSavedEntry(savedDetails),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: (connectionId, channelId) => {
			navigations.push([connectionId, channelId]);
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['conn-2', 3]]);
	assert.equal(openerCalls.length, 1);
	const [capturedOpenerArgs] = openerCalls;
	if (!capturedOpenerArgs) {
		throw new Error('opener args should be captured');
	}
	assert.deepEqual(capturedOpenerArgs.connectionDetails, {
		...savedDetails,
		autoConnect: false,
	});
	assert.deepEqual(capturedOpenerArgs.resolvedSecurity, {
		type: 'key',
		privateKey: 'private-key',
	});
	navigations.length = 0;
	capturedOpenerArgs.navigate({ connectionId: 'conn-3', channelId: 4 });
	assert.deepEqual(navigations, [['conn-3', 4]]);
});

void test('records saved-entry selection through trace sink', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();

	await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => ({
			status: 'connected',
			connectionId: 'conn-2',
			channelId: 3,
		}),
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'auto-connect.source.missing-latest-shell',
			'auto-connect.source.missing-active-connection',
			'auto-connect.saved-entry.selected',
			'auto-connect.saved-entry.key-resolved',
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.connected',
		],
	);
	assert.deepEqual(
		(events[2] as { source: string; connection: unknown }).connection,
		{
			savedConnectionId: 'saved-1',
			username: 'muly',
			host: 'host.example',
			port: 22,
			keyId: 'key-1',
			useTmux: true,
			tmuxSessionName: 'main',
		},
	);
	assert.equal(
		(events[2] as { source: string; connection: unknown }).source,
		'saved-entry',
	);
	assert.deepEqual(
		(events[3] as { source: string; connection: unknown }).connection,
		(events[2] as { source: string; connection: unknown }).connection,
	);
});

void test('active shell failure falls through to saved-entry connection', async () => {
	const navigations: [string, number][] = [];
	const { calls, logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {
			active: {
				connectionId: 'active-1',
				connectedAtMs: 20,
				connectionDetails: baseDetails,
				startShell: async () => {
					throw new Error('active shell unavailable');
				},
			},
		},
		openSavedEntryShell: async ({ navigate }) => {
			navigate({ connectionId: 'saved-2', channelId: 9 });
			return {
				status: 'connected',
				connectionId: 'saved-2',
				channelId: 9,
			};
		},
		loadTmuxSettings: async () => ({
			useTmux: true,
			tmuxSessionName: 'main',
		}),
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: (connectionId, channelId) => {
			navigations.push([connectionId, channelId]);
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['saved-2', 9]]);
	assert.equal(
		calls.some(
			(call) =>
				Array.isArray(call) &&
				call[0] === 'warn' &&
				call[1] === 'Failed to reopen shell on active connection',
		),
		true,
	);
});

void test('saved-entry path returns false when no saved entry exists', async () => {
	let recoveryCalls = 0;
	let openerCalls = 0;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => {
			openerCalls += 1;
			throw new Error('connect should not run');
		},
		loadLatestSavedConnection: async () => null,
		resolveKeySecurity: async () => {
			throw new Error('security should not resolve');
		},
		navigateToShell: () => {
			throw new Error('navigation should not run');
		},
		recovery: {
			ensureReady: async () => {
				recoveryCalls += 1;
				return readyRecovery.ensureReady();
			},
			recoverAfterFailure: async () => {
				recoveryCalls += 1;
				return readyRecovery.recoverAfterFailure();
			},
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, false);
	assert.equal(recoveryCalls, 0);
	assert.equal(openerCalls, 0);
});

void test('saved-entry path returns false for invalid legacy tmux fields', async () => {
	for (const value of [
		{
			...baseDetails,
			useTmux: undefined,
		},
		{
			...baseDetails,
			tmuxSessionName: undefined,
		},
	]) {
		let recoveryCalls = 0;
		let openerCalls = 0;
		const { logger } = createLogger();

		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/(tabs)',
			latestShell: null,
			connections: {},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadLatestSavedConnection: async () => createSavedEntry(value),
			resolveKeySecurity: async () => {
				throw new Error('security should not resolve');
			},
			navigateToShell: () => {
				throw new Error('navigation should not run');
			},
			recovery: {
				ensureReady: async () => {
					recoveryCalls += 1;
					return readyRecovery.ensureReady();
				},
				recoverAfterFailure: async () => {
					recoveryCalls += 1;
					return readyRecovery.recoverAfterFailure();
				},
			},
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger,
		});

		assert.equal(connected, false);
		assert.equal(recoveryCalls, 0);
		assert.equal(openerCalls, 0);
	}
});

void test('saved-entry path skips when key security cannot resolve', async () => {
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => null,
		navigateToShell: () => {
			throw new Error('navigation should not run');
		},
		recovery: {
			ensureReady: async () => {
				throw new Error('recovery should not run');
			},
			recoverAfterFailure: readyRecovery.recoverAfterFailure,
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, false);
});

void test('records saved-entry failure trace events', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => {
			throw new Error('network unreachable');
		},
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'SECRET_PRIVATE_KEY',
		}),
		navigateToShell: () => {},
		recovery: {
			ensureReady: async () => ({
				kind: 'ready' as const,
				attempted: true as const,
				available: true as const,
			}),
			recoverAfterFailure: async () => ({
				kind: 'failed' as const,
				attempted: true as const,
				networkLikeFailure: true as const,
				available: true,
			}),
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(connected, false);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'auto-connect.source.missing-latest-shell',
			'auto-connect.source.missing-active-connection',
			'auto-connect.saved-entry.selected',
			'auto-connect.saved-entry.key-resolved',
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.threw',
			'tailscale.recovery.result',
			'auto-connect.saved-entry.connect.failed',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /SECRET_PRIVATE_KEY/);
});
