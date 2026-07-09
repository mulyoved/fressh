import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	mapReconnectSavedEntryAttemptOutcome,
	resolveReconnectSavedEntry,
} from '../../src/lib/auto-connect-reconnect-saved-entry';
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
import {
	activeConnectionFixture,
	attemptAutoConnectSource,
	baseDetails,
	createLogger,
	createSavedEntry,
	createSavedEntryWithId,
	createTaggedError,
	eventKinds,
	readyRecovery,
} from './auto-connect-attempt-test-helpers';

function omitUndefinedFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => omitUndefinedFields(item));
	}
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, item]) => item !== undefined)
				.map(([key, item]) => [key, omitUndefinedFields(item)]),
		);
	}
	return value;
}

void test('reconnect saved-entry invalid legacy tmux fields return a classified result', async () => {
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
		const events: unknown[] = [];

		const result = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {},
			reconnectContext: {
				trigger: 'reconnect',
				droppedConnectionId: 'dropped-1',
				droppedChannelId: 9,
				droppedStoredConnectionId: 'muly-host_example-22',
				pathname: '/shell/detail',
			},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadSavedConnectionByStoredId: async () => createSavedEntry(value),
			loadLatestSavedConnection: async () => {
				throw new Error('latest reconnect fallback should not run');
			},
			resolveKeySecurity: async () => {
				throw new Error('security should not resolve');
			},
			trace: { event: (event) => events.push(event) },
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

		assert.deepEqual(result, {
			status: 'failedTmuxAttach',
			message: 'invalid-tmux-settings',
		});
		assert.equal(recoveryCalls, 0);
		assert.equal(openerCalls, 0);
		const failedEvent = events.find(
			(event) =>
				(event as { kind?: string }).kind ===
				'auto-connect.saved-entry.connect.failed',
		) as
			| {
					message?: string;
					storedConnectionId?: string;
					trigger?: string;
					failureClass?: string;
			  }
			| undefined;
		assert.equal(failedEvent?.message, 'invalid-tmux-settings');
		assert.equal(failedEvent?.storedConnectionId, 'saved-1');
		assert.equal(failedEvent?.trigger, 'reconnect');
		assert.equal(failedEvent?.failureClass, 'failedTmuxAttach');
	}
});

void test('reconnect saved-entry loader exception returns a classified result', async () => {
	const { logger } = createLogger();
	const events: unknown[] = [];

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'dropped-1',
			droppedChannelId: 9,
			droppedStoredConnectionId: 'muly-host_example-22',
			pathname: '/shell/detail',
		},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadSavedConnectionByStoredId: async () => {
			throw new Error('saved entry lookup failed');
		},
		loadLatestSavedConnection: async () => {
			throw new Error('latest reconnect fallback should not run');
		},
			resolveKeySecurity: async () => {
				throw new Error('security should not resolve');
			},
			trace: { event: (event) => events.push(event) },
			navigateToShell: () => {
				throw new Error('navigation should not run');
			},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.deepEqual(result, {
		status: 'cleanupFailed',
		message: 'saved entry lookup failed',
	});
	const failedEvent = events.find(
		(event) =>
			(event as { kind?: string }).kind ===
			'auto-connect.saved-entry.connect.failed',
	) as
		| {
				message?: string;
				storedConnectionId?: string;
				trigger?: string;
				failureClass?: string;
		  }
		| undefined;
	assert.equal(failedEvent?.message, 'saved entry lookup failed');
	assert.equal(failedEvent?.storedConnectionId, 'muly-host_example-22');
	assert.equal(failedEvent?.trigger, 'reconnect');
	assert.equal(failedEvent?.failureClass, 'cleanupFailed');
});

void test('reconnect saved-entry loader network-like exception returns failedNetwork', async () => {
	const { logger } = createLogger();

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'dropped-1',
			droppedChannelId: 9,
			droppedStoredConnectionId: 'muly-host_example-22',
			pathname: '/shell/detail',
		},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadSavedConnectionByStoredId: async () => {
			throw new Error('No route to host');
		},
		loadLatestSavedConnection: async () => {
			throw new Error('latest reconnect fallback should not run');
		},
		resolveKeySecurity: async () => {
			throw new Error('security should not resolve');
		},
		navigateToShell: () => {
			throw new Error('navigation should not run');
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.deepEqual(result, {
		status: 'failedNetwork',
		message: 'No route to host',
	});
});

void test('reconnect key resolver exception returns a classified result', async () => {
	const { logger } = createLogger();
	const events: unknown[] = [];

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'dropped-1',
			droppedChannelId: 9,
			droppedStoredConnectionId: 'muly-host_example-22',
			pathname: '/shell/detail',
		},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadSavedConnectionByStoredId: async () => createSavedEntry(),
		loadLatestSavedConnection: async () => {
			throw new Error('latest reconnect fallback should not run');
		},
			resolveKeySecurity: async () => {
				throw new Error('key resolver failed');
			},
			trace: { event: (event) => events.push(event) },
			navigateToShell: () => {
				throw new Error('navigation should not run');
			},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.deepEqual(result, {
		status: 'failedAuth',
		message: 'key resolver failed',
	});
	const failedEvent = events.find(
		(event) =>
			(event as { kind?: string }).kind ===
			'auto-connect.saved-entry.connect.failed',
	) as
		| {
				message?: string;
				connection?: { savedConnectionId?: string; host?: string };
				storedConnectionId?: string;
				trigger?: string;
				host?: string;
				tmuxSessionName?: string;
				failureClass?: string;
		  }
		| undefined;
	assert.equal(failedEvent?.message, 'key resolver failed');
	assert.equal(failedEvent?.connection?.savedConnectionId, 'saved-1');
	assert.equal(failedEvent?.connection?.host, 'host.example');
	assert.equal(failedEvent?.storedConnectionId, 'saved-1');
	assert.equal(failedEvent?.trigger, 'reconnect');
	assert.equal(failedEvent?.host, 'host.example');
	assert.equal(failedEvent?.tmuxSessionName, 'main');
	assert.equal(failedEvent?.failureClass, 'failedAuth');
});

void test('reconnect key resolver tmux-tagged exception returns failedTmuxAttach', async () => {
	const { logger } = createLogger();

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'dropped-1',
			droppedChannelId: 9,
			droppedStoredConnectionId: 'muly-host_example-22',
			pathname: '/shell/detail',
		},
		openSavedEntryShell: async () => {
			throw new Error('connect should not run');
		},
		loadSavedConnectionByStoredId: async () => createSavedEntry(),
		loadLatestSavedConnection: async () => {
			throw new Error('latest reconnect fallback should not run');
		},
		resolveKeySecurity: async () => {
			throw createTaggedError('tmux attach failed', 'TmuxAttachFailed');
		},
		navigateToShell: () => {
			throw new Error('navigation should not run');
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
	});

	assert.deepEqual(result, {
		status: 'failedTmuxAttach',
		message: 'tmux attach failed',
	});
});

void test('reconnect key-missing returns failedAuth without opening a shell', async () => {
	let openerCalls = 0;
	let navigationCalls = 0;
	let recoveryCalls = 0;
	const { logger } = createLogger();
	const events: unknown[] = [];

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'dropped-1',
			droppedChannelId: 9,
			droppedStoredConnectionId: 'muly-host_example-22',
			pathname: '/shell/detail',
		},
		openSavedEntryShell: async () => {
			openerCalls += 1;
			throw new Error('connect should not run');
		},
		loadSavedConnectionByStoredId: async () => createSavedEntry(),
		loadLatestSavedConnection: async () => {
			throw new Error('latest reconnect fallback should not run');
		},
		resolveKeySecurity: async () => null,
		trace: { event: (event) => events.push(event) },
		navigateToShell: () => {
			navigationCalls += 1;
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

	assert.deepEqual(result, {
		status: 'failedAuth',
		message: 'key-missing',
	});
	assert.equal(openerCalls, 0);
	assert.equal(navigationCalls, 0);
	assert.equal(recoveryCalls, 0);
	const failedEvent = events.find(
		(event) =>
			(event as { kind?: string }).kind ===
			'auto-connect.saved-entry.connect.failed',
	) as
		| {
				message?: string;
				connection?: { savedConnectionId?: string; host?: string };
				storedConnectionId?: string;
				trigger?: string;
				host?: string;
				tmuxSessionName?: string;
				failureClass?: string;
		  }
		| undefined;
	assert.equal(failedEvent?.message, 'key-missing');
	assert.equal(failedEvent?.connection?.savedConnectionId, 'saved-1');
	assert.equal(failedEvent?.connection?.host, 'host.example');
	assert.equal(failedEvent?.storedConnectionId, 'saved-1');
	assert.equal(failedEvent?.trigger, 'reconnect');
	assert.equal(failedEvent?.host, 'host.example');
	assert.equal(failedEvent?.tmuxSessionName, 'main');
	assert.equal(failedEvent?.failureClass, 'failedAuth');
});

void test('reconnect saved-entry lookup timeout returns retry without key resolution or shell open', async () => {
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 5,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	let keyResolutionCalls = 0;
	let openerCalls = 0;
	let navigationCalls = 0;
	const { logger } = createLogger();

	try {
		const result = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {},
			reconnectContext: {
				trigger: 'reconnect',
				droppedConnectionId: 'dropped-1',
				droppedChannelId: 9,
				droppedStoredConnectionId: 'muly-host_example-22',
				pathname: '/shell/detail',
			},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadSavedConnectionByStoredId: async () => await new Promise(() => {}),
			loadLatestSavedConnection: async () => {
				throw new Error('latest reconnect fallback should not run');
			},
			resolveKeySecurity: async () => {
				keyResolutionCalls += 1;
				throw new Error('security should not resolve');
			},
			navigateToShell: () => {
				navigationCalls += 1;
			},
			recovery: readyRecovery,
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger,
			runContext,
		});

		assert.deepEqual(result, { status: 'retry' });
		assert.equal(keyResolutionCalls, 0);
		assert.equal(openerCalls, 0);
		assert.equal(navigationCalls, 0);
	} finally {
		runContext.finish();
	}
});

void test('reconnect key-resolution timeout returns retry without shell open or failure diagnostic', async () => {
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 5,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	let openerCalls = 0;
	let navigationCalls = 0;
	const events: unknown[] = [];
	const { logger } = createLogger();

	try {
		const result = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {},
			reconnectContext: {
				trigger: 'reconnect',
				droppedConnectionId: 'dropped-1',
				droppedChannelId: 9,
				droppedStoredConnectionId: 'muly-host_example-22',
				pathname: '/shell/detail',
			},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadSavedConnectionByStoredId: async () => createSavedEntry(),
			loadLatestSavedConnection: async () => {
				throw new Error('latest reconnect fallback should not run');
			},
			resolveKeySecurity: async () => await new Promise(() => {}),
			trace: { event: (event) => events.push(event) },
			navigateToShell: () => {
				navigationCalls += 1;
			},
			recovery: readyRecovery,
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger,
			runContext,
		});

		assert.deepEqual(result, { status: 'retry' });
		assert.equal(openerCalls, 0);
		assert.equal(navigationCalls, 0);
		assert.equal(
			events.some(
				(event) =>
					(event as { kind?: string }).kind ===
					'auto-connect.saved-entry.connect.failed',
			),
			false,
		);
	} finally {
		runContext.finish();
	}
});

void test('reconnect key-resolution caller abort returns retry without shell open or failure diagnostic', async () => {
	const abortController = new AbortController();
	const runContext = createConnectionRunContext({
		callerSignal: abortController.signal,
		timeouts: {
			operationTimeoutMs: 60_000,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	let openerCalls = 0;
	let navigationCalls = 0;
	const events: unknown[] = [];
	const { logger } = createLogger();

	try {
		const result = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {},
			reconnectContext: {
				trigger: 'reconnect',
				droppedConnectionId: 'dropped-1',
				droppedChannelId: 9,
				droppedStoredConnectionId: 'muly-host_example-22',
				pathname: '/shell/detail',
			},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadSavedConnectionByStoredId: async () => createSavedEntry(),
			loadLatestSavedConnection: async () => {
				throw new Error('latest reconnect fallback should not run');
			},
			resolveKeySecurity: async () => {
				abortController.abort();
				return await new Promise(() => {});
			},
			trace: { event: (event) => events.push(event) },
			navigateToShell: () => {
				navigationCalls += 1;
			},
			recovery: readyRecovery,
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger,
			runContext,
		});

		assert.deepEqual(result, { status: 'retry' });
		assert.equal(openerCalls, 0);
		assert.equal(navigationCalls, 0);
		assert.equal(
			events.some(
				(event) =>
					(event as { kind?: string }).kind ===
					'auto-connect.saved-entry.connect.failed',
			),
			false,
		);
	} finally {
		runContext.finish();
	}
});

void test('tmux reconnect prefers the dropped stored connection when the dropped session is already gone', async () => {
	const startShellCalls: unknown[] = [];
	const events: unknown[] = [];
	const navigations: { connectionId: string; channelId: number }[] = [];
	const loadedIds: string[] = [];
	const savedEntry = createSavedEntryWithId('muly-100_64_0_10-22', {
		...baseDetails,
		host: '100.64.0.10',
		autoConnect: false,
		useTmux: true,
		tmuxSessionName: 'main',
	});

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {
			'other-conn-1': activeConnectionFixture({
				connectionId: 'other-conn-1',
				host: '203.0.113.99',
				connectedAtMs: 50,
				startShell: async () => {
					startShellCalls.push({});
					throw new Error('must not be called');
				},
			}),
		},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'active-conn-1',
			droppedChannelId: 4,
			droppedStoredConnectionId: 'muly-100_64_0_10-22',
			pathname: '/shell/detail',
		},
		loadTmuxSettings: async () => ({
			useTmux: true,
			tmuxSessionName: 'main',
		}),
		loadSavedConnectionByStoredId: async (storedId) => {
			loadedIds.push(storedId);
			return savedEntry;
		},
		loadLatestSavedConnection: async () => {
			throw new Error('latest fallback should not be used');
		},
		openSavedEntryShell: async () => ({
			status: 'connected',
			connectionId: 'fresh-conn-1',
			channelId: 9,
			cleanup: async () => undefined,
		}),
		trace: { event: (event) => events.push(event) },
		navigateToShell: (connectionId, channelId) => {
			navigations.push({ connectionId, channelId });
		},
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger: createLogger().logger,
	});

	assert.deepEqual(startShellCalls, []);
	assert.deepEqual(loadedIds, ['muly-100_64_0_10-22']);
	assert.deepEqual(navigations, [
		{ connectionId: 'fresh-conn-1', channelId: 9 },
	]);
	assert.deepEqual(result, { status: 'connected' });
	assert.equal(
		events.some(
			(event) =>
				(event as { kind?: string }).kind ===
				'auto-connect.active-connection.shell-started',
		),
		false,
	);
	assert.deepEqual(
		events.find(
			(event) =>
				(event as { kind?: string }).kind ===
				'reconnect.transport.invalidated',
		),
		{
			kind: 'reconnect.transport.invalidated',
			source: 'reconnect',
			connectionId: 'active-conn-1',
			channelId: 4,
			hadShell: true,
			bridgeDisposed: false,
			bridgeRequestInFlight: false,
			message: 'stale transport marked for replacement',
		},
	);
});

void test('reconnect uses the dropped saved entry when launch selection is filtered', async () => {
	const events: unknown[] = [];
	const navigations: { connectionId: string; channelId: number }[] = [];
	const autoConnectLatestEntry = createSavedEntryWithId('auto-connect-only', {
		...baseDetails,
		host: '203.0.113.20',
		autoConnect: true,
		useTmux: true,
		tmuxSessionName: 'main',
	});
	const reconnectEntry = createSavedEntryWithId('muly-100_64_0_10-22', {
		...baseDetails,
		host: '100.64.0.10',
		autoConnect: false,
		useTmux: true,
		tmuxSessionName: 'main',
	});
	let openSavedEntryCalls = 0;

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'active-conn-1',
			droppedChannelId: 4,
			droppedStoredConnectionId: reconnectEntry.id,
			pathname: '/shell/detail',
		},
		loadLatestSavedConnection: async () => autoConnectLatestEntry,
		loadSavedConnectionByStoredId: async () => reconnectEntry,
		openSavedEntryShell: async ({ connectionDetails }) => {
			openSavedEntryCalls += 1;
			assert.equal(connectionDetails.host, '100.64.0.10');
			return {
				status: 'connected',
				connectionId: 'fresh-conn-1',
				channelId: 9,
			};
		},
		trace: { event: (event) => events.push(event) },
		navigateToShell: (connectionId, channelId) => {
			navigations.push({ connectionId, channelId });
		},
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger: createLogger().logger,
	});

	assert.deepEqual(result, { status: 'connected' });
	assert.equal(openSavedEntryCalls, 1);
	assert.deepEqual(navigations, [
		{ connectionId: 'fresh-conn-1', channelId: 9 },
	]);
	assert.deepEqual(
		events.find(
			(event) =>
				(event as { kind?: string }).kind === 'saved-entry.selected',
		),
		{
					kind: 'saved-entry.selected',
					source: 'saved-entry',
					connection: {
					savedConnectionId: reconnectEntry.id,
					username: 'muly',
					host: '100.64.0.10',
				port: 22,
				keyId: 'key-1',
				useTmux: true,
				tmuxSessionName: 'main',
			},
		},
	);
});

void test('reconnect resolver falls back to unfiltered saved-entry store when dropped lookup misses', async () => {
	const reconnectLatestEntry = {
		...createSavedEntryWithId('muly-100_64_0_10-22', {
			...baseDetails,
			host: '100.64.0.10',
			autoConnect: false,
			useTmux: true,
			tmuxSessionName: 'main',
		}),
		metadata: {
			createdAtMs: 2,
			modifiedAtMs: 20,
			priority: 0,
		},
	};
	const loadedIds: string[] = [];

	const result = await resolveReconnectSavedEntry({
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'active-conn-1',
			droppedChannelId: 4,
			droppedStoredConnectionId: reconnectLatestEntry.id,
			pathname: '/shell/detail',
		},
		loadSavedConnectionByStoredId: async (storedConnectionId) => {
			loadedIds.push(storedConnectionId);
			return null;
		},
		loadLatestStoredSavedConnection: async () => reconnectLatestEntry,
	});

	assert.deepEqual(loadedIds, [reconnectLatestEntry.id]);
	assert.equal(result?.id, reconnectLatestEntry.id);
	assert.equal(result?.value.autoConnect, false);
	assert.equal(result?.value.host, '100.64.0.10');
});

void test('reconnect resolver returns null when dropped lookup and store fallback both miss', async () => {
	const loadedIds: string[] = [];

	const result = await resolveReconnectSavedEntry({
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'active-conn-1',
			droppedChannelId: 4,
			droppedStoredConnectionId: 'muly-100_64_0_10-22',
			pathname: '/shell/detail',
		},
		loadSavedConnectionByStoredId: async (storedConnectionId) => {
			loadedIds.push(storedConnectionId);
			return null;
		},
		loadLatestStoredSavedConnection: async () => null,
	});

	assert.deepEqual(loadedIds, ['muly-100_64_0_10-22']);
	assert.equal(result, null);
});

void test('android tmux reconnect traces Tailscale readiness before saved-entry reconnect', async () => {
	const events: unknown[] = [];
	const callOrder: string[] = [];

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
			reconnectContext: {
				trigger: 'reconnect',
				droppedConnectionId: 'active-conn-1',
				droppedStoredConnectionId: 'saved-1',
				pathname: '/shell/detail',
			},
			loadSavedConnectionByStoredId: async () =>
				createSavedEntry({
					...baseDetails,
					autoConnect: false,
				useTmux: true,
				tmuxSessionName: 'main',
			}),
		recovery: {
			ensureReady: async () => {
				callOrder.push('ensure-ready');
				return { kind: 'ready', attempted: true, available: true };
			},
			recoverAfterFailure: async () => {
				callOrder.push('recover-after-failure');
				return {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				};
			},
		},
		openSavedEntryShell: async () => {
			callOrder.push('connect');
			return { status: 'connected', connectionId: 'fresh', channelId: 3 };
		},
		trace: { event: (event) => events.push(event) },
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger: createLogger().logger,
	});

	assert.deepEqual(result, { status: 'connected' });
	assert.deepEqual(callOrder, ['ensure-ready', 'connect']);
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.missing',
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.started',
		'auto-connect.saved-entry.connect.connected',
	]);
});

void test('reconnect successful saved-entry opener navigate callback only navigates once', async () => {
	const navigations: { connectionId: string; channelId: number }[] = [];
	const savedEntry = createSavedEntryWithId('muly-100_64_0_10-22', {
		...baseDetails,
		host: '100.64.0.10',
		autoConnect: false,
		useTmux: true,
		tmuxSessionName: 'main',
	});

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'active-conn-1',
			droppedChannelId: 4,
			droppedStoredConnectionId: 'muly-100_64_0_10-22',
			pathname: '/shell/detail',
		},
		loadSavedConnectionByStoredId: async () => savedEntry,
		loadLatestSavedConnection: async () => {
			throw new Error('latest fallback should not be used');
		},
		openSavedEntryShell: async ({ navigate }) => {
			navigate({ connectionId: 'fresh-conn-1', channelId: 9 });
			return {
				status: 'connected',
				connectionId: 'fresh-conn-1',
				channelId: 9,
			};
		},
		trace: { event: () => {} },
		navigateToShell: (connectionId, channelId) => {
			navigations.push({ connectionId, channelId });
		},
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger: createLogger().logger,
	});

	assert.deepEqual(result, { status: 'connected' });
	assert.deepEqual(navigations, [
		{ connectionId: 'fresh-conn-1', channelId: 9 },
	]);
});

void test('reconnect derives dropped stored id from active connections before latest fallback', async () => {
	const loadedIds: string[] = [];
	const savedEntry = createSavedEntryWithId('muly-100_64_0_10-22', {
		...baseDetails,
		host: '100.64.0.10',
		autoConnect: false,
		useTmux: true,
		tmuxSessionName: 'main',
	});

	const result = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/shell/detail',
		latestShell: null,
		connections: {
			'active-conn-1': activeConnectionFixture({
				connectionId: 'active-conn-1',
				host: '100.64.0.10',
				connectedAtMs: 50,
				startShell: async () => {
					throw new Error('stale active shell must not reopen');
				},
			}),
		},
		reconnectContext: {
			trigger: 'reconnect',
			droppedConnectionId: 'active-conn-1',
			droppedChannelId: 4,
			pathname: '/shell/detail',
		},
		loadSavedConnectionByStoredId: async (storedId) => {
			loadedIds.push(storedId);
			return savedEntry;
		},
		loadLatestSavedConnection: async () => {
			throw new Error('latest fallback should not be used');
		},
		openSavedEntryShell: async () => ({
			status: 'connected',
			connectionId: 'fresh-conn-1',
			channelId: 9,
		}),
		navigateToShell: () => {},
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger: createLogger().logger,
	});

	assert.deepEqual(result, { status: 'connected' });
	assert.deepEqual(loadedIds, ['muly-100_64_0_10-22']);
});

void test('reconnect maps saved-entry lifecycle outcomes into reconnect result statuses', async () => {
	let sawAttention = false;
	let sawClearAttention = false;
	const { logger } = createLogger();
	const connectionIdentity = {
		savedConnectionId: 'saved-1',
		username: 'muly',
		host: '100.64.0.10',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	};
	const prepared = {
		latestEntryConnection: connectionIdentity,
		normalizedDetails: {
			...baseDetails,
			host: '100.64.0.10',
			autoConnect: false,
		},
		details: {
			...baseDetails,
			host: '100.64.0.10',
			autoConnect: false,
		},
	};
	type ReconnectOutcomeCase = {
		name: string;
		result: Parameters<typeof mapReconnectSavedEntryAttemptOutcome>[0]['result'];
		expected:
			| { status: 'failedTmuxAttach' }
			| { status: 'needsAttention'; message: string }
			| { status: 'failedNetwork'; message: string }
			| { status: 'failedAuth'; message: string }
			| { status: 'cleanupFailed' }
			| { status: 'retry' }
			| { status: 'connected' };
		expectedTraceEvents: unknown[];
	};
	const cases: ReconnectOutcomeCase[] = [
		{
			name: 'tmux attach failure',
			result: {
				status: 'tmuxAttachFailed' as const,
				connectionId: 'fresh-conn-1',
				tmuxAttachFailureReason: 'missing session',
				tmuxSessionName: 'main',
				storedConnectionId: 'muly-100_64_0_10-22',
			},
			expected: { status: 'failedTmuxAttach' as const },
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.tmux-attach-failed',
					source: 'saved-entry',
					connection: {
						...connectionIdentity,
						connectionId: 'fresh-conn-1',
						tmuxSessionName: 'main',
					},
					connectionId: 'fresh-conn-1',
					tmuxAttachFailureReason: 'missing session',
					tmuxSessionName: 'main',
					storedConnectionId: 'muly-100_64_0_10-22',
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					failureClass: 'failedTmuxAttach',
				},
				{
					kind: 'auto-connect.saved-entry.connect.failed',
					source: 'saved-entry',
					connection: connectionIdentity,
					connectionId: 'fresh-conn-1',
					storedConnectionId: 'muly-100_64_0_10-22',
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
					failureClass: 'failedTmuxAttach',
				},
			],
		},
		{
			name: 'blocked readiness',
			result: {
				status: 'blocked' as const,
				attentionMessage:
					'Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.',
			},
			expected: {
				status: 'needsAttention' as const,
				message:
					'Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.',
			},
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.failed',
					source: 'saved-entry',
					connection: connectionIdentity,
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
					failureClass: 'needsAttention',
				},
			],
		},
		{
			name: 'network failure',
			result: {
				status: 'failed' as const,
				error: new Error('No route to host'),
				recoverable: false,
				attentionMessage: null,
			},
			expected: {
				status: 'failedNetwork' as const,
				message: 'No route to host',
			},
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.failed',
					source: 'saved-entry',
					connection: connectionIdentity,
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
					failureClass: 'failedNetwork',
				},
			],
		},
		{
			name: 'auth failure',
			result: {
				status: 'failed' as const,
				error: createTaggedError('auth failed', 'Auth'),
				recoverable: false,
				attentionMessage: null,
			},
			expected: {
				status: 'failedAuth' as const,
				message: 'auth failed',
			},
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.failed',
					source: 'saved-entry',
					connection: connectionIdentity,
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
					failureClass: 'failedAuth',
				},
			],
		},
		{
			name: 'unknown failure',
			result: {
				status: 'failed' as const,
				error: new Error('boom'),
				recoverable: false,
				attentionMessage: null,
			},
			expected: {
				status: 'needsAttention' as const,
				message: 'boom',
			},
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.failed',
					source: 'saved-entry',
					connection: connectionIdentity,
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
					failureClass: 'needsAttention',
				},
			],
		},
		{
			name: 'cleanup failure',
			result: {
				status: 'cleanupFailed' as const,
				error: new Error('cleanup failed'),
				priorOutcome: {
					status: 'connected' as const,
					connectionId: 'fresh-conn-1',
					channelId: 9,
				},
			},
			expected: { status: 'cleanupFailed' as const },
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.failed',
					source: 'saved-entry',
					message: 'cleanup-failed: cleanup failed',
					connection: connectionIdentity,
					connectionId: 'fresh-conn-1',
					storedConnectionId: 'muly-100_64_0_10-22',
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
					failureClass: 'cleanupFailed',
				},
			],
		},
		{
			name: 'timeout retry',
			result: {
				status: 'timedOut' as const,
				timeoutKind: 'operation' as const,
			},
			expected: { status: 'retry' as const },
			expectedTraceEvents: [],
		},
		{
			name: 'abort retry',
			result: {
				status: 'aborted' as const,
				reason: 'caller-aborted' as const,
			},
			expected: { status: 'retry' as const },
			expectedTraceEvents: [],
		},
		{
			name: 'connected',
			result: {
				status: 'connected' as const,
				connectionId: 'fresh-conn-1',
				channelId: 9,
			},
			expected: { status: 'connected' as const },
			expectedTraceEvents: [
				{
					kind: 'auto-connect.saved-entry.connect.connected',
					source: 'saved-entry',
					connection: {
						...connectionIdentity,
						connectionId: 'fresh-conn-1',
					},
					connectionId: 'fresh-conn-1',
					channelId: 9,
					storedConnectionId: 'muly-100_64_0_10-22',
					trigger: 'reconnect',
					host: '100.64.0.10',
					port: 22,
					tmuxSessionName: 'main',
				},
			],
		},
	];

	for (const testCase of cases) {
		const traceEvents: unknown[] = [];
		const result = mapReconnectSavedEntryAttemptOutcome({
			result: testCase.result,
			prepared,
			latestEntryId: 'muly-100_64_0_10-22',
			traceEvent: (event) => {
				traceEvents.push(event);
			},
			markTailscaleAttention: () => {
				sawAttention = true;
			},
			clearTailscaleAttention: () => {
				sawClearAttention = true;
			},
			logger,
		});

		assert.deepEqual(result, testCase.expected, testCase.name);
		assert.deepEqual(
			omitUndefinedFields(traceEvents),
			omitUndefinedFields(testCase.expectedTraceEvents),
			testCase.name,
		);
	}

	assert.equal(sawAttention, true);
	assert.equal(sawClearAttention, true);
});

void test('reconnect maps timeout and caller abort into retry', async () => {
	const savedEntry = createSavedEntryWithId('muly-100_64_0_10-22', {
		...baseDetails,
		host: '100.64.0.10',
		autoConnect: false,
		useTmux: true,
		tmuxSessionName: 'main',
	});

	for (const testCase of [{ name: 'timeout' }, { name: 'caller abort' }]) {
		const controller =
			testCase.name === 'caller abort' ? new AbortController() : null;
		const runContext =
			testCase.name === 'timeout'
				? createConnectionRunContext({
					timeouts: {
						operationTimeoutMs: 5,
						recoveryTimeoutMs: 60_000,
						cleanupTimeoutMs: 5_000,
					},
				})
				: undefined;

		try {
			const result = await attemptAutoConnectSource({
				platformOS: 'android',
				pathname: '/shell/detail',
				latestShell: null,
				connections: {},
				reconnectContext: {
					trigger: 'reconnect',
					droppedConnectionId: 'active-conn-1',
					droppedChannelId: 4,
					droppedStoredConnectionId: 'muly-100_64_0_10-22',
					pathname: '/shell/detail',
				},
				loadSavedConnectionByStoredId: async () => savedEntry,
				loadLatestSavedConnection: async () => {
					throw new Error('latest fallback should not be used');
				},
				openSavedEntryShell: async ({ abortSignal }) =>
					await new Promise((_resolve, reject) => {
						if (testCase.name === 'caller abort') {
							controller?.abort();
						}
						abortSignal?.addEventListener(
							'abort',
							() => {
								reject(new Error(`${testCase.name} aborted`));
							},
							{ once: true },
						);
					}),
				navigateToShell: () => {},
				resolveKeySecurity: async () => ({
					type: 'key',
					privateKey: 'private-key',
				}),
				recovery: readyRecovery,
				markTailscaleAttention: () => {},
				clearTailscaleAttention: () => {},
				logger: createLogger().logger,
				runContext,
				abortSignal: controller?.signal,
			});

			assert.deepEqual(result, { status: 'retry' }, testCase.name);
		} finally {
			runContext?.finish();
		}
	}
});
