import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptAutoConnectSource } from '../../src/lib/auto-connect-attempt';
import type { SavedConnectionEntry } from '../../src/lib/connection-utils';
import type { InputConnectionDetails } from '../../src/lib/secrets-manager';

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

function createSavedEntry(value = baseDetails): SavedConnectionEntry {
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
	const navigations: Array<[string, number]> = [];
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
			throw new Error('attention should not be cleared');
		},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['conn-1', 7]]);
});

void test('active shell does not navigate when already on shell detail', async () => {
	const navigations: Array<[string, number]> = [];
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
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, []);
});

void test('latest active connection loads tmux settings, starts shell, and navigates', async () => {
	const navigations: Array<[string, number]> = [];
	const shellStarts: unknown[] = [];
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
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['newer', 44]]);
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
	const navigations: Array<[string, number]> = [];
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async ({ navigate }) => {
			navigate({ connectionId: 'conn-2', channelId: 3 });
			return {
				status: 'connected',
				sshConnection: {} as never,
				shellHandle: {} as never,
				connectionId: 'conn-2',
				channelId: 3,
			};
		},
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
	assert.deepEqual(navigations, [['conn-2', 3]]);
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
