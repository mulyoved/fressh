import assert from 'node:assert/strict';
import test from 'node:test';
import {
	attemptAutoConnectFromManager,
	buildPendingReconnectContext,
	createReconnectContextCycleState,
	installPendingReconnectContext,
	pickLatestSavedReconnectConnection,
	preserveShellReferencedConnections,
} from '../../src/lib/auto-connect-manager-helpers';
import { type AutoConnectAttemptSourceArgs } from '../../src/lib/auto-connect-attempt';
import { createAutoConnectReconnectController } from '../../src/lib/auto-connect-reconnect-controller';
import { createConnectionRunContext } from '../../src/lib/connection-run-context';
import {
	getAutoConnectLaunchActionForUrl,
	shouldSkipInitialAutoConnectForUrl,
} from '../../src/lib/auto-connect-launch';

function flushPromises() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function createSavedEntry({
	metadata,
	value,
}: {
	metadata: {
		createdAtMs: number;
		modifiedAtMs: number;
		priority: number;
	};
	value: {
		username: string;
		host: string;
		port: number;
		useTmux: boolean;
		tmuxSessionName: string;
		autoConnect: boolean;
		security: { type: 'key'; keyId: string };
	};
}) {
	return {
		id: `${value.username}-${value.host}-${value.port}`.replaceAll('.', '_'),
		metadata,
		value,
	};
}

void test('e2e launch URL can suppress the initial auto-connect attempt', () => {
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=1',
		),
		true,
	);
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=true',
		),
		true,
	);
});

void test('normal launch URLs do not suppress initial auto-connect', () => {
	assert.equal(shouldSkipInitialAutoConnectForUrl(null), false);
	assert.equal(shouldSkipInitialAutoConnectForUrl('fressh:///'), false);
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=0',
		),
		false,
	);
	assert.equal(shouldSkipInitialAutoConnectForUrl('not a url'), false);
});

void test('e2e launch URL routes warm launches back to the connection form', () => {
	assert.deepEqual(
		getAutoConnectLaunchActionForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=1',
		),
		{
			routeToConnectionForm: true,
			skipAutoConnect: true,
		},
	);
});

void test('shell-drop reconnect context preserves dropped shell identity for reconnect attempts', () => {
	const context = buildPendingReconnectContext({
		pathname: '/shell/detail',
		shells: [
			{
				connectionId: 'conn-older',
				channelId: 2,
				createdAtMs: 10,
			},
			{
				connectionId: 'conn-dropped',
				channelId: 7,
				createdAtMs: 20,
			},
		],
		connections: {
			'conn-dropped': {
				connectionDetails: {
					username: 'muly',
					host: '100.64.0.10',
					port: 22,
				},
			},
		},
	});

	assert.ok(context);
	assert.deepEqual(context, {
		trigger: 'reconnect',
		pathname: '/shell/detail',
		droppedConnectionId: 'conn-dropped',
		droppedChannelId: 7,
		droppedStoredConnectionId: 'muly-100_64_0_10-22',
	});
});

void test('manager reconnect preserves dropped stored id when native disconnect removes a connection before shell close', async () => {
	const shellSnapshot = {
		connectionId: 'conn-dropped',
		channelId: 7,
		createdAtMs: 20,
	};
	const initialConnections = {
		'conn-dropped': {
			connectionDetails: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
			},
		},
	};
	const preservedConnections = preserveShellReferencedConnections({
		shells: [shellSnapshot],
		connections: {},
		previousConnections: initialConnections,
	});
	assert.deepEqual(preservedConnections, initialConnections);
	assert.deepEqual(
		preserveShellReferencedConnections({
			shells: [],
			connections: {},
			previousConnections: preservedConnections,
		}),
		{},
	);
	const reconnectContextState = createReconnectContextCycleState();
	const savedEntries = [
		createSavedEntry({
			metadata: {
				createdAtMs: 1,
				modifiedAtMs: 10,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '203.0.113.99',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: true,
				security: { type: 'key', keyId: 'key-other' },
			},
		}),
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-dropped' },
			},
		}),
	];

	installPendingReconnectContext({
		reconnectContextState,
		pathname: '/shell/detail',
		shells: [shellSnapshot],
		connections: preservedConnections,
	});

	const reconnectContext =
		reconnectContextState.getReconnectContextForReconnectAttempt();
	const loadedIds: string[] = [];
	const openedHosts: string[] = [];
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 1_000,
			recoveryTimeoutMs: 1_000,
			cleanupTimeoutMs: 1_000,
		},
	});

	try {
		const result = await attemptAutoConnectFromManager({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {
				'other-conn-1': {
					connectionId: 'other-conn-1',
					connectionDetails: {
						username: 'muly',
						host: '198.51.100.20',
						port: 22,
					},
					connectedAtMs: 50,
					startShell: async () => {
						throw new Error('stale active shell must not reopen');
					},
				},
			},
			reconnectContext,
			openSavedEntryShell: async ({ connectionDetails }) => {
				openedHosts.push(connectionDetails.host);
				return {
					status: 'connected',
					connectionId: 'fresh-conn-1',
					channelId: 9,
					cleanup: async () => undefined,
				};
			},
			loadSavedConnections: async () => savedEntries,
			loadSavedConnectionByStoredId: async (storedConnectionId) => {
				loadedIds.push(storedConnectionId);
				return savedEntries[1] ?? null;
			},
			resolveKeySecurity: async () => ({
				type: 'key',
				privateKey: 'private-key',
			}),
			navigateToShell: () => {},
			recovery: {
				ensureReady: async () => ({
					kind: 'ready' as const,
					attempted: true as const,
					available: true as const,
				}),
				recoverAfterFailure: async () => ({
					kind: 'nonNetworkFailure' as const,
					attempted: false as const,
					networkLikeFailure: false as const,
					available: true as const,
				}),
			},
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger: {
				info: () => {},
				warn: () => {},
			},
			runContext,
		});

		assert.deepEqual(result, { status: 'connected' });
	} finally {
		runContext.finish();
	}

	assert.deepEqual(loadedIds, ['muly-100_64_0_10-22']);
	assert.deepEqual(openedHosts, ['100.64.0.10']);
});

void test('reconnect fallback can choose the latest saved entry even when auto-connect is disabled', () => {
	const selected = pickLatestSavedReconnectConnection([
		createSavedEntry({
			metadata: {
				createdAtMs: 1,
				modifiedAtMs: 10,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.11',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: true,
				security: { type: 'key', keyId: 'key-1' },
			},
		}),
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-2' },
			},
		}),
	]);

	assert.equal(selected?.value.autoConnect, false);
	assert.equal(selected?.value.host, '100.64.0.10');
});

void test('manager reconnect wiring passes dropped identity and unfiltered reconnect fallback into attempt source', async () => {
	const reconnectContext = buildPendingReconnectContext({
		pathname: '/shell/detail',
		shells: [
			{
				connectionId: 'conn-dropped',
				channelId: 7,
				createdAtMs: 20,
			},
		],
		connections: {
			'conn-dropped': {
				connectionDetails: {
					username: 'muly',
					host: '100.64.0.10',
					port: 22,
				},
			},
		},
	});
	assert.ok(reconnectContext);
	const savedEntries = [
		createSavedEntry({
			metadata: {
				createdAtMs: 1,
				modifiedAtMs: 10,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.11',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: true,
				security: { type: 'key', keyId: 'key-1' },
			},
		}),
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-2' },
			},
		}),
	];
	let capturedArgs: AutoConnectAttemptSourceArgs | null = null;
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 1_000,
			recoveryTimeoutMs: 1_000,
			cleanupTimeoutMs: 1_000,
		},
	});

	try {
		await attemptAutoConnectFromManager({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {},
			reconnectContext,
			openSavedEntryShell: async () => {
				throw new Error('saved-entry connect should not run');
			},
			loadSavedConnections: async () => savedEntries,
			loadSavedConnectionByStoredId: async () => null,
			resolveKeySecurity: async () => null,
			navigateToShell: () => {},
			recovery: {
				ensureReady: async () => ({
					kind: 'ready' as const,
					attempted: true as const,
					available: true as const,
				}),
				recoverAfterFailure: async () => ({
					kind: 'nonNetworkFailure' as const,
					attempted: false as const,
					networkLikeFailure: false as const,
					available: true as const,
				}),
			},
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger: {
				info: () => {},
				warn: () => {},
			},
			runContext,
			attemptAutoConnectSourceImpl: async (args) => {
				capturedArgs = args;
				return false;
			},
		});
	} finally {
		runContext.finish();
	}

	if (capturedArgs === null) {
		throw new Error('manager args should be captured');
	}
	const receivedArgs: AutoConnectAttemptSourceArgs = capturedArgs;
	assert.deepEqual(receivedArgs.reconnectContext, {
		trigger: 'reconnect',
		pathname: '/shell/detail',
		droppedConnectionId: 'conn-dropped',
		droppedChannelId: 7,
		droppedStoredConnectionId: 'muly-100_64_0_10-22',
	});
	assert.equal(
		(await receivedArgs.loadLatestSavedConnection())?.value.host,
		'100.64.0.10',
	);
	assert.equal(
		(await receivedArgs.loadLatestSavedAutoConnectConnection?.())?.value.host,
		'100.64.0.11',
	);
});

void test('app-resume-no-shell without a dropped shell keeps normal auto-connect filtering', async () => {
	let capturedArgs: AutoConnectAttemptSourceArgs | null = null;
	const reconnectContextState = createReconnectContextCycleState();
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 1_000,
			recoveryTimeoutMs: 1_000,
			cleanupTimeoutMs: 1_000,
		},
	});
	const savedEntries = [
		createSavedEntry({
			metadata: {
				createdAtMs: 1,
				modifiedAtMs: 10,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.11',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: true,
				security: { type: 'key', keyId: 'key-1' },
			},
		}),
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-2' },
			},
		}),
	];

	installPendingReconnectContext({
		reconnectContextState,
		pathname: '/shell/detail',
		shells: [],
		connections: {},
	});

	try {
		await attemptAutoConnectFromManager({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {},
			reconnectContext:
				reconnectContextState.getReconnectContextForReconnectAttempt(),
			openSavedEntryShell: async () => {
				throw new Error('saved-entry connect should not run');
			},
			loadSavedConnections: async () => savedEntries,
			loadSavedConnectionByStoredId: async () => null,
			resolveKeySecurity: async () => null,
			navigateToShell: () => {},
			recovery: {
				ensureReady: async () => ({
					kind: 'ready' as const,
					attempted: true as const,
					available: true as const,
				}),
				recoverAfterFailure: async () => ({
					kind: 'nonNetworkFailure' as const,
					attempted: false as const,
					networkLikeFailure: false as const,
					available: true as const,
				}),
			},
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger: {
				info: () => {},
				warn: () => {},
			},
			runContext,
			attemptAutoConnectSourceImpl: async (args) => {
				capturedArgs = args;
				return false;
			},
		});
	} finally {
		runContext.finish();
	}

	if (capturedArgs === null) {
		throw new Error('manager args should be captured');
	}
	const receivedArgs: AutoConnectAttemptSourceArgs = capturedArgs;
	assert.equal(receivedArgs.reconnectContext, undefined);
	assert.equal(
		(await receivedArgs.loadLatestSavedConnection())?.value.host,
		'100.64.0.10',
	);
	assert.equal(
		(await receivedArgs.loadLatestSavedAutoConnectConnection?.())?.value.host,
		'100.64.0.11',
	);
});

void test('app-resume-no-shell reconnect installs dropped context so stale active transport reconnects through tmux saved-entry fallback', async () => {
	const reconnectContextState = createReconnectContextCycleState();
	installPendingReconnectContext({
		reconnectContextState,
		pathname: '/shell/detail',
		shells: [
			{
				connectionId: 'active-conn-1',
				channelId: 4,
				createdAtMs: 20,
			},
		],
		connections: {
			'active-conn-1': {
				connectionDetails: {
					username: 'muly',
					host: '100.64.0.10',
					port: 22,
				},
			},
		},
	});

	const reconnectContext =
		reconnectContextState.getReconnectContextForReconnectAttempt();
	const savedEntries = [
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-2' },
			},
		}),
	];
	const loadedIds: string[] = [];
	const startShellCalls: unknown[] = [];
	const navigations: Array<{ connectionId: string; channelId: number }> = [];
	const runContext = createConnectionRunContext({
		timeouts: {
			operationTimeoutMs: 1_000,
			recoveryTimeoutMs: 1_000,
			cleanupTimeoutMs: 1_000,
		},
	});

	try {
		const result = await attemptAutoConnectFromManager({
			platformOS: 'android',
			pathname: '/shell/detail',
			latestShell: null,
			connections: {
				'active-conn-1': {
					connectionId: 'active-conn-1',
					connectionDetails: {
						username: 'muly',
						host: '100.64.0.10',
						port: 22,
					},
					connectedAtMs: 50,
					startShell: async () => {
						startShellCalls.push({});
						throw new Error('stale active shell must not reopen');
					},
				},
			},
			reconnectContext,
			openSavedEntryShell: async ({ connectionDetails }) => {
				assert.equal(connectionDetails.useTmux, true);
				assert.equal(connectionDetails.tmuxSessionName, 'main');
				return {
					status: 'connected',
					connectionId: 'fresh-conn-1',
					channelId: 9,
					cleanup: async () => undefined,
				};
			},
			loadSavedConnections: async () => savedEntries,
			loadSavedConnectionByStoredId: async (storedConnectionId) => {
				loadedIds.push(storedConnectionId);
				return null;
			},
			resolveKeySecurity: async () => ({
				type: 'key',
				privateKey: 'private-key',
			}),
			navigateToShell: (connectionId, channelId) => {
				navigations.push({ connectionId, channelId });
			},
			recovery: {
				ensureReady: async () => ({
					kind: 'ready' as const,
					attempted: true as const,
					available: true as const,
				}),
				recoverAfterFailure: async () => ({
					kind: 'nonNetworkFailure' as const,
					attempted: false as const,
					networkLikeFailure: false as const,
					available: true as const,
				}),
			},
			markTailscaleAttention: () => {},
			clearTailscaleAttention: () => {},
			logger: {
				info: () => {},
				warn: () => {},
			},
			runContext,
		});

		assert.deepEqual(result, { status: 'connected' });
	} finally {
		runContext.finish();
	}

	assert.deepEqual(loadedIds, ['muly-100_64_0_10-22']);
	assert.deepEqual(startShellCalls, []);
	assert.deepEqual(navigations, [
		{ connectionId: 'fresh-conn-1', channelId: 9 },
	]);
});

void test('reconnect retry loop preserves dropped reconnect context for every production adapter call', async () => {
	const reconnectContextState = createReconnectContextCycleState();
	const reconnectContext = buildPendingReconnectContext({
		pathname: '/shell/detail',
		shells: [
			{
				connectionId: 'conn-dropped',
				channelId: 7,
				createdAtMs: 20,
			},
		],
		connections: {
			'conn-dropped': {
				connectionDetails: {
					username: 'muly',
					host: '100.64.0.10',
					port: 22,
				},
			},
		},
	});
	assert.ok(reconnectContext);
	reconnectContextState.replacePendingReconnectContext(reconnectContext);
	const savedEntries = [
		createSavedEntry({
			metadata: {
				createdAtMs: 1,
				modifiedAtMs: 10,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.11',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: true,
				security: { type: 'key', keyId: 'key-1' },
			},
		}),
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-2' },
			},
		}),
	];
	let nowMs = 0;
	const timers: Array<{
		delayMs: number;
		callback: () => void;
		cleared: boolean;
	}> = [];
	const capturedAttempts: Array<{
		reconnectContext: AutoConnectAttemptSourceArgs['reconnectContext'];
		latestHost: string | undefined;
		autoConnectHost: string | undefined;
	}> = [];
	const controller = createAutoConnectReconnectController({
		delaysMs: [10],
		windowMs: 100,
		now: () => nowMs,
		setTimeout: (callback, delayMs) => {
			const timer = { delayMs, callback, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			(timer as { cleared: boolean }).cleared = true;
		},
		getSnapshot: () => ({
			isAutoConnecting: false,
			isReconnecting: false,
			resetInFlight: false,
			platformOS: 'android',
			appActive: true,
			backgroundWorkAllowed: true,
			foregroundServiceRequired: false,
		}),
		setReconnecting: () => {},
		attemptAutoConnect: async () => {
			const reconnectContext =
				reconnectContextState.getReconnectContextForReconnectAttempt();
			const runContext = createConnectionRunContext({
				timeouts: {
					operationTimeoutMs: 1_000,
					recoveryTimeoutMs: 1_000,
					cleanupTimeoutMs: 1_000,
				},
			});

			try {
				const result = await attemptAutoConnectFromManager({
					platformOS: 'android',
					pathname: '/shell/detail',
					latestShell: null,
					connections: {},
					reconnectContext,
					openSavedEntryShell: async () => {
						throw new Error('saved-entry connect should not run');
					},
					loadSavedConnections: async () => savedEntries,
					loadSavedConnectionByStoredId: async () => null,
					resolveKeySecurity: async () => null,
					navigateToShell: () => {},
					recovery: {
						ensureReady: async () => ({
							kind: 'ready' as const,
							attempted: true as const,
							available: true as const,
						}),
						recoverAfterFailure: async () => ({
							kind: 'nonNetworkFailure' as const,
							attempted: false as const,
							networkLikeFailure: false as const,
							available: true as const,
						}),
					},
					markTailscaleAttention: () => {},
					clearTailscaleAttention: () => {},
					logger: {
						info: () => {},
						warn: () => {},
					},
					runContext,
					attemptAutoConnectSourceImpl: async (args) => {
						capturedAttempts.push({
							reconnectContext: args.reconnectContext,
							latestHost: (
								await args.loadLatestSavedConnection()
							)?.value.host,
							autoConnectHost: (
								await args.loadLatestSavedAutoConnectConnection?.()
							)?.value.host,
						});
						return capturedAttempts.length === 1
							? { status: 'retry', message: 'retry-once' }
							: { status: 'connected' };
					},
				});
				reconnectContextState.settleReconnectAttempt(result);
				return result;
			} finally {
				runContext.finish();
			}
		},
		logger: {
			info: () => {},
			warn: () => {},
		},
	});

	assert.equal(controller.start('shell-drop'), true);
	await flushPromises();

	const retryTimer = timers.find(
		(timer) => timer.delayMs === 10 && timer.cleared === false,
	);
	assert.ok(retryTimer);
	nowMs = 10;
	retryTimer.callback();
	await flushPromises();

	assert.deepEqual(capturedAttempts, [
		{
			reconnectContext: {
				trigger: 'reconnect',
				pathname: '/shell/detail',
				droppedConnectionId: 'conn-dropped',
				droppedChannelId: 7,
				droppedStoredConnectionId: 'muly-100_64_0_10-22',
			},
			latestHost: '100.64.0.10',
			autoConnectHost: '100.64.0.11',
		},
		{
			reconnectContext: {
				trigger: 'reconnect',
				pathname: '/shell/detail',
				droppedConnectionId: 'conn-dropped',
				droppedChannelId: 7,
				droppedStoredConnectionId: 'muly-100_64_0_10-22',
			},
			latestHost: '100.64.0.10',
			autoConnectHost: '100.64.0.11',
		},
	]);
	assert.equal(controller.isRunning(), false);
});
