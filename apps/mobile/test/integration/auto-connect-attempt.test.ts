import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	attemptAutoConnectSource as attemptAutoConnectSourceBase,
	type AutoConnectAttemptSourceArgs,
} from '../../src/lib/auto-connect-attempt';
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
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

function createSavedEntryWithId(
	id: string,
	value: SavedConnectionEntry['value'],
): SavedConnectionEntry {
	return {
		...createSavedEntry(value),
		id,
	};
}

function activeConnectionFixture(overrides: {
	connectionId: string;
	host: string;
	connectedAtMs?: number;
	startShell: AutoConnectAttemptSourceArgs['connections'][string]['startShell'];
}): AutoConnectAttemptSourceArgs['connections'][string] {
	return {
		connectionId: overrides.connectionId,
		connectionDetails: {
			...baseDetails,
			host: overrides.host,
		},
		connectedAtMs: overrides.connectedAtMs ?? 10,
		startShell: overrides.startShell,
	};
}

function createAutoConnectRunContext(callerSignal?: AbortSignal) {
	return createConnectionRunContext({
		callerSignal,
		timeouts: {
			operationTimeoutMs: 60_000,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
}

async function attemptAutoConnectSource(
	args: Omit<AutoConnectAttemptSourceArgs, 'runContext'> & {
		runContext?: AutoConnectAttemptSourceArgs['runContext'];
		abortSignal?: AbortSignal;
	},
) {
	const runContext =
		args.runContext ?? createAutoConnectRunContext(args.abortSignal);
	try {
		const { abortSignal: _abortSignal, ...sourceArgs } = args;
		return await attemptAutoConnectSourceBase({ ...sourceArgs, runContext });
	} finally {
		if (!args.runContext) {
			runContext.finish();
		}
	}
}

function eventKinds(events: unknown[]) {
	return events.map((event) => (event as { kind: string }).kind);
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
	const events: unknown[] = [];
	let clearAttentionCount = 0;
	const { logger } = createLogger();
	const runContext = createAutoConnectRunContext();

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
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
		runContext,
	});
	runContext.finish();

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['newer', 44]]);
	assert.equal(clearAttentionCount, 1);
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.selected',
		'auto-connect.active-connection.shell-started',
		'auto-connect.active-connection.shell-connected',
	]);
	assert.deepEqual(
		(events[1] as { source: string; connection: unknown }).connection,
		{
			connectionId: 'newer',
			username: 'muly',
			host: 'host.example',
			port: 22,
		},
	);
	assert.equal(
		(events[1] as { source: string; connection: unknown }).source,
		'active-connection',
	);
	assert.deepEqual((events[2] as { connection: unknown }).connection, {
		connectionId: 'newer',
		username: 'muly',
		host: 'host.example',
		port: 22,
		useTmux: false,
		tmuxSessionName: 'ops',
	});
	assert.deepEqual(
		{
			channelId: (events[3] as { channelId: number }).channelId,
			pathname: (events[3] as { pathname: string }).pathname,
			connection: (events[3] as { connection: unknown }).connection,
		},
		{
			channelId: 44,
			pathname: '/(tabs)',
			connection: {
				connectionId: 'newer',
				username: 'muly',
				host: 'host.example',
				port: 22,
			},
		},
	);
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

void test('aborted active connection auto-connect suppresses late navigation', async () => {
	const abortController = new AbortController();
	const navigations: [string, number][] = [];
	let receivedSignal: AbortSignal | undefined;
	let clearAttentionCount = 0;
	let closeCalls = 0;
	const { logger } = createLogger();
	const runContext = createConnectionRunContext({
		callerSignal: abortController.signal,
		timeouts: {
			operationTimeoutMs: 5_000,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});

	try {
		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/(tabs)',
			latestShell: null,
			connections: {
				active: {
					connectionId: 'active-1',
					connectedAtMs: 20,
					connectionDetails: baseDetails,
					startShell: async ({ abortSignal }) => {
						receivedSignal = abortSignal;
						abortController.abort();
						return {
							channelId: 7,
							close: async () => {
								closeCalls += 1;
							},
						};
					},
				},
			},
			openSavedEntryShell: async () => {
				throw new Error('saved-entry fallback should not run');
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
			clearTailscaleAttention: () => {
				clearAttentionCount += 1;
			},
			logger,
			abortSignal: abortController.signal,
			runContext,
		});

		assert.equal(connected, false);
		assert.equal(receivedSignal?.aborted, true);
		assert.deepEqual(navigations, []);
		assert.equal(clearAttentionCount, 0);
		assert.equal(closeCalls, 1);
	} finally {
		runContext.finish();
	}
});

void test('aborted active shell failure skips saved-entry fallback', async () => {
	const abortController = new AbortController();
	let loadLatestSavedConnectionCalls = 0;
	const { logger } = createLogger();

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
					abortController.abort();
					throw new Error('operation aborted');
				},
			},
		},
		openSavedEntryShell: async () => {
			throw new Error('saved-entry fallback should not run');
		},
		loadTmuxSettings: async () => ({
			useTmux: true,
			tmuxSessionName: 'main',
		}),
		loadLatestSavedConnection: async () => {
			loadLatestSavedConnectionCalls += 1;
			return createSavedEntry();
		},
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {
			throw new Error('aborted active shell should not navigate');
		},
		recovery: readyRecovery,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logger,
		abortSignal: abortController.signal,
	});

	assert.equal(connected, false);
	assert.equal(loadLatestSavedConnectionCalls, 0);
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
	const runContext = createAutoConnectRunContext();

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
		runContext,
	});
	runContext.finish();

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
		events.map((event) => (event as { kind: string }).kind),
		[
			'auto-connect.latest-shell.missing',
			'auto-connect.active-connection.missing',
			'saved-entry.selected',
			'key.resolved',
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
	const events: unknown[] = [];
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
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(connected, true);
	assert.deepEqual(navigations, [['saved-2', 9]]);
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.selected',
		'auto-connect.active-connection.shell-started',
		'auto-connect.active-connection.shell-failed',
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.started',
		'auto-connect.saved-entry.connect.connected',
	]);
	const failureEvent = events[3] as {
		connection: unknown;
		error: { message: string };
		tmuxSessionName: string;
	};
	assert.deepEqual(failureEvent.connection, {
		connectionId: 'active-1',
		username: 'muly',
		host: 'host.example',
		port: 22,
	});
	assert.equal(failureEvent.error.message, 'active shell unavailable');
	assert.equal(failureEvent.tmuxSessionName, 'main');
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

void test('auto-connect run context active shell timeout falls through to saved-entry connection', async () => {
	const navigations: [string, number][] = [];
	const events: unknown[] = [];
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 1_000,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	const { logger } = createLogger();

	try {
		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/(tabs)',
			latestShell: null,
			connections: {
				active: {
					connectionId: 'active-1',
					connectedAtMs: 20,
					connectionDetails: baseDetails,
					startShell: async ({ abortSignal }) =>
						await new Promise((_resolve, reject) => {
							abortSignal.addEventListener(
								'abort',
								() => {
									reject(new Error('active shell timed out'));
								},
								{ once: true },
							);
						}),
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
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
			runContext,
			timeouts: {
				operationTimeoutMs: 5,
				recoveryTimeoutMs: 60_000,
				cleanupTimeoutMs: 5_000,
			},
		});

		assert.equal(connected, true);
		assert.deepEqual(navigations, [['saved-2', 9]]);
		assert.deepEqual(eventKinds(events), [
			'auto-connect.latest-shell.missing',
			'auto-connect.active-connection.selected',
			'auto-connect.active-connection.shell-started',
			'auto-connect.active-connection.shell-failed',
			'saved-entry.selected',
			'key.resolved',
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.connected',
		]);
	} finally {
		runContext.finish();
	}
});

void test('aborted saved-entry auto-connect suppresses late navigation', async () => {
	const abortController = new AbortController();
	const navigations: [string, number][] = [];
	let receivedSignal: AbortSignal | undefined;
	const { logger } = createLogger();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async ({ navigate, abortSignal }) => {
			receivedSignal = abortSignal;
			abortController.abort();
			navigate({ connectionId: 'saved-late', channelId: 44 });
			return {
				status: 'connected',
				connectionId: 'saved-late',
				channelId: 44,
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
		abortSignal: abortController.signal,
	});

	assert.equal(connected, false);
	assert.equal(receivedSignal?.aborted, true);
	assert.deepEqual(navigations, []);
});

void test('auto-connect run context suppresses stale saved-entry late success navigation', async () => {
	const abortController = new AbortController();
	const runContext = createConnectionRunContext({
		callerSignal: abortController.signal,
		timeouts: {
			operationTimeoutMs: 5_000,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	const navigations: unknown[] = [];
	let openerCalls = 0;
	let cleanupCalls = 0;
	let cleanupSignal: AbortSignal | undefined;
	const { logger } = createLogger();

	try {
		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/shell',
			latestShell: null,
			connections: {},
			openSavedEntryShell: async ({ abortSignal, navigate }) => {
				abortController.abort();
				assert.equal(abortSignal?.aborted, true);
				openerCalls += 1;
				navigate({ connectionId: 'conn-1', channelId: 7 });
				return {
					status: 'connected',
					connectionId: 'conn-1',
					channelId: 7,
					cleanup: async (opts) => {
						cleanupCalls += 1;
						cleanupSignal = opts?.signal;
					},
				};
			},
			loadLatestSavedConnection: async () => createSavedEntry(),
			resolveKeySecurity: async () => ({
				type: 'key',
				privateKey: 'secret',
			}),
			navigateToShell: (connectionId, channelId) => {
				navigations.push({ connectionId, channelId });
			},
			recovery: readyRecovery,
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger,
			runContext,
		});

		assert.equal(connected, false);
		assert.deepEqual(navigations, []);
		assert.equal(openerCalls, 1);
		assert.equal(cleanupCalls, 1);
		assert.equal(cleanupSignal instanceof AbortSignal, true);
	} finally {
		runContext.finish();
	}
});

void test('active shell tmux attach failure records active-connection tmux trace', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();
	const runContext = createAutoConnectRunContext();

	try {
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
						throw {
							tag: 'TmuxAttachFailed',
							inner: ['missing session'],
						};
					},
				},
			},
			openSavedEntryShell: async () => ({
				status: 'connected',
				connectionId: 'saved-2',
				channelId: 9,
			}),
			loadTmuxSettings: async () => ({
				useTmux: true,
				tmuxSessionName: 'ops',
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
			runContext,
		});

		assert.equal(connected, true);
	} finally {
		runContext.finish();
	}
	assert.deepEqual(eventKinds(events).slice(0, 4), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.selected',
		'auto-connect.active-connection.shell-started',
		'auto-connect.active-connection.tmux-attach-failed',
	]);
	const tmuxEvent = events[3] as {
		connection: unknown;
		tmuxAttachFailureReason: string;
		tmuxSessionName: string;
	};
	assert.deepEqual(tmuxEvent.connection, {
		connectionId: 'active-1',
		username: 'muly',
		host: 'host.example',
		port: 22,
	});
	assert.equal(tmuxEvent.tmuxAttachFailureReason, 'missing session');
	assert.equal(tmuxEvent.tmuxSessionName, 'ops');
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

void test('saved-entry lookup timeout returns false without opening shell', async () => {
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 5,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	let openerCalls = 0;
	const { logger } = createLogger();

	try {
		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/(tabs)',
			latestShell: null,
			connections: {},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadLatestSavedConnection: async () => new Promise(() => {}),
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
			runContext,
		});

		assert.equal(connected, false);
		assert.equal(openerCalls, 0);
	} finally {
		runContext.finish();
	}
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

void test('saved-entry key resolution timeout returns false without opening shell', async () => {
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 5,
			recoveryTimeoutMs: 60_000,
			cleanupTimeoutMs: 5_000,
		},
	});
	let openerCalls = 0;
	const { logger } = createLogger();

	try {
		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/(tabs)',
			latestShell: null,
			connections: {},
			openSavedEntryShell: async () => {
				openerCalls += 1;
				throw new Error('connect should not run');
			},
			loadLatestSavedConnection: async () => createSavedEntry(),
			resolveKeySecurity: async () => new Promise(() => {}),
			navigateToShell: () => {
				throw new Error('navigation should not run');
			},
			recovery: readyRecovery,
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger,
			runContext,
		});

		assert.equal(connected, false);
		assert.equal(openerCalls, 0);
	} finally {
		runContext.finish();
	}
});

void test('saved-entry Tailscale readiness block marks attention and fails trace', async () => {
	const events: unknown[] = [];
	const attentionMessages: string[] = [];
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
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {},
		recovery: {
			ensureReady: async () => ({
				kind: 'unavailable' as const,
				attempted: false as const,
				available: false as const,
			}),
			recoverAfterFailure: readyRecovery.recoverAfterFailure,
		},
		markTailscaleAttention: (message) => {
			attentionMessages.push(message);
		},
		clearTailscaleAttention: () => {},
		logger,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(connected, false);
	assert.equal(attentionMessages.length, 1);
	assert.match(attentionMessages[0] ?? '', /Tailscale is required/);
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.missing',
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.failed',
	]);
});

void test('records saved-entry failure trace events', async () => {
	const events: unknown[] = [];
	const attentionMessages: string[] = [];
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
		markTailscaleAttention: (message) => {
			attentionMessages.push(message);
		},
		clearTailscaleAttention: () => {},
		logger,
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(connected, false);
	assert.equal(attentionMessages.length, 1);
	assert.match(attentionMessages[0] ?? '', /restarting Tailscale/);
	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		[
			'auto-connect.latest-shell.missing',
			'auto-connect.active-connection.missing',
			'saved-entry.selected',
			'key.resolved',
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.threw',
			'tailscale.recovery.result',
			'auto-connect.saved-entry.connect.failed',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /SECRET_PRIVATE_KEY/);
});

void test('records saved-entry recovery retry success trace events from caller', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();
	const runContext = createAutoConnectRunContext();
	let connectCalls = 0;

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => {
			connectCalls += 1;
			if (connectCalls === 1) {
				throw new Error('network unreachable');
			}
			return {
				status: 'connected',
				connectionId: 'conn-retry',
				channelId: 7,
			};
		},
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {},
		recovery: {
			ensureReady: readyRecovery.ensureReady,
			recoverAfterFailure: async () => ({
				kind: 'recovered' as const,
				attempted: true as const,
				networkLikeFailure: true as const,
				available: true as const,
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
		runContext,
	});
	runContext.finish();

	assert.equal(connected, true);
	assert.equal(connectCalls, 2);
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.missing',
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.started',
		'auto-connect.saved-entry.connect.threw',
		'tailscale.recovery.result',
		'auto-connect.saved-entry.retry.started',
		'auto-connect.saved-entry.connect.connected',
	]);
});

void test('records saved-entry recovery retry failure before connect failure', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();
	const runContext = createAutoConnectRunContext();

	const connected = await attemptAutoConnectSource({
		platformOS: 'android',
		pathname: '/(tabs)',
		latestShell: null,
		connections: {},
		openSavedEntryShell: async () => {
			throw new Error('No route to host');
		},
		loadLatestSavedConnection: async () => createSavedEntry(),
		resolveKeySecurity: async () => ({
			type: 'key',
			privateKey: 'private-key',
		}),
		navigateToShell: () => {},
		recovery: {
			ensureReady: readyRecovery.ensureReady,
			recoverAfterFailure: async () => ({
				kind: 'recovered' as const,
				attempted: true as const,
				networkLikeFailure: true as const,
				available: true as const,
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
		runContext,
	});
	runContext.finish();

	assert.equal(connected, false);
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.missing',
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.started',
		'auto-connect.saved-entry.connect.threw',
		'tailscale.recovery.result',
		'auto-connect.saved-entry.retry.started',
		'auto-connect.saved-entry.retry.threw',
		'auto-connect.saved-entry.connect.failed',
	]);
});

void test('records saved-entry tmux attach failure and connect failure payloads', async () => {
	const events: unknown[] = [];
	const { logger } = createLogger();
	const runContext = createAutoConnectRunContext();

	try {
		const connected = await attemptAutoConnectSource({
			platformOS: 'android',
			pathname: '/(tabs)',
			latestShell: null,
			connections: {},
			openSavedEntryShell: async () => ({
				status: 'tmux_attach_failed',
				connectionId: 'conn-tmux',
				tmuxAttachFailureReason: 'missing session',
				tmuxSessionName: 'ops',
				storedConnectionId: 'stored-tmux',
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
			runContext,
		});

		assert.equal(connected, false);
	} finally {
		runContext.finish();
	}
	assert.deepEqual(eventKinds(events), [
		'auto-connect.latest-shell.missing',
		'auto-connect.active-connection.missing',
		'saved-entry.selected',
		'key.resolved',
		'tailscale.ensure-ready.result',
		'auto-connect.saved-entry.connect.started',
		'auto-connect.saved-entry.connect.tmux-attach-failed',
		'auto-connect.saved-entry.connect.failed',
	]);
	const tmuxEvent = events.find(
		(event) =>
			(event as { kind: string }).kind ===
			'auto-connect.saved-entry.connect.tmux-attach-failed',
	) as {
		connection: unknown;
		connectionId: string;
		tmuxAttachFailureReason: string | null;
		tmuxSessionName: string;
		storedConnectionId: string;
	};
	assert.deepEqual(tmuxEvent.connection, {
		connectionId: 'conn-tmux',
		tmuxSessionName: 'ops',
	});
	assert.equal(tmuxEvent.connectionId, 'conn-tmux');
	assert.equal(tmuxEvent.tmuxAttachFailureReason, 'missing session');
	assert.equal(tmuxEvent.tmuxSessionName, 'ops');
	assert.equal(tmuxEvent.storedConnectionId, 'stored-tmux');

	const failureEvent = events.find(
		(event) =>
			(event as { kind: string }).kind ===
			'auto-connect.saved-entry.connect.failed',
	) as {
		connection: unknown;
		connectionId: string;
		storedConnectionId: string;
	};
	assert.deepEqual(failureEvent.connection, {
		savedConnectionId: 'saved-1',
		username: 'muly',
		host: 'host.example',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	});
	assert.equal(failureEvent.connectionId, 'conn-tmux');
	assert.equal(failureEvent.storedConnectionId, 'stored-tmux');
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
			pathname: '/shell/detail',
		},
		loadLatestSavedConnection: async () =>
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
	assert.equal(
		events.some(
			(event) =>
				(event as { kind?: string }).kind === 'tailscale.ensure-ready.result',
		),
		true,
	);
});
