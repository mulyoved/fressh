import assert from 'node:assert/strict';
import test from 'node:test';
import { connectAndOpenShell } from '../../src/lib/connect-and-open-shell';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('connectAndOpenShell records connect and shell success events', async () => {
	const events: unknown[] = [];
	const navigations: unknown[] = [];
	const connectParams: unknown[] = [];
	const saveCalls: unknown[] = [];
	const startShellOptions: unknown[] = [];
	const progressEvents: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async (params) => {
			connectParams.push(params);
			params.onConnectionProgress?.({ phase: 'auth' } as never);
			assert.equal(await params.onServerKey({} as never), true);
			assert.equal(params.host, 'dev.tailnet.ts.net');
			assert.equal(params.port, 22);
			assert.equal(params.username, 'muly');
			assert.deepEqual(params.security, { type: 'key', privateKey: 'secret' });
			assert.ok(params.abortSignal);
			assert.equal(params.abortSignal.aborted, false);
			return {
				connectionId: 'conn-1',
				startShell: async (options: unknown) => {
					startShellOptions.push(options);
					return { channelId: 7 };
				},
			} as never;
		},
		onConnectionProgress: (event) => {
			progressEvents.push(event);
		},
		saveConnection: async (params) => {
			saveCalls.push(params);
		},
		navigate: (params) => {
			navigations.push(params);
		},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.equal(result.status, 'connected');
	assert.equal(connectParams.length, 1);
	assert.deepEqual(progressEvents, [{ phase: 'auth' }]);
	assert.deepEqual(saveCalls, [
		{
			label: 'muly@dev.tailnet.ts.net:22',
			details: connectionDetails,
			priority: 0,
		},
	]);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		undefined,
	);
	assert.deepEqual(navigations, [{ connectionId: 'conn-1', channelId: 7 }]);
	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		[
			'ssh.connect.started',
			'ssh.connect.progress',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.connected',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});

void test('connectAndOpenShell propagates caller abort to connect and shell start', async () => {
	const abortController = new AbortController();
	let connectSignal: AbortSignal | undefined;
	let shellSignal: AbortSignal | undefined;

	await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignal: abortController.signal,
		connect: async (params) => {
			assert.ok(params.abortSignal);
			connectSignal = params.abortSignal;
			assert.equal(params.abortSignal.aborted, false);
			return {
				connectionId: 'conn-1',
				startShell: async (options: { abortSignal: AbortSignal }) => {
					shellSignal = options.abortSignal;
					assert.equal(options.abortSignal.aborted, false);
					abortController.abort();
					return { channelId: 7 };
				},
			} as never;
		},
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('aborted connect should not navigate');
		},
	});

	assert.equal(connectSignal?.aborted, true);
	assert.equal(shellSignal?.aborted, true);
});

void test('connectAndOpenShell accepts lifecycle operation signals', async () => {
	const connectAbortController = new AbortController();
	const shellAbortController = new AbortController();
	let connectSignal: AbortSignal | undefined;
	let shellSignal: AbortSignal | undefined;

	await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			connect: connectAbortController.signal,
			shell: shellAbortController.signal,
		},
		connect: async (params) => {
			connectSignal = params.abortSignal;
			return {
				connectionId: 'conn-1',
				startShell: async (options: { abortSignal: AbortSignal }) => {
					shellSignal = options.abortSignal;
					return { channelId: 7 };
				},
			} as never;
		},
		saveConnection: async () => {},
		navigate: () => {},
	});

	assert.equal(connectSignal, connectAbortController.signal);
	assert.equal(shellSignal, shellAbortController.signal);
});

void test('connectAndOpenShell disconnects after shell operation abort failure', async () => {
	const shellAbortController = new AbortController();
	let disconnectCalls = 0;
	let navigated = false;
	const abortError = new Error('shell operation aborted');
	abortError.name = 'AbortError';

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			operationSignals: {
				shell: shellAbortController.signal,
			},
			connect: async () =>
				({
					connectionId: 'conn-1',
					disconnect: async () => {
						disconnectCalls += 1;
					},
					startShell: async () => {
						shellAbortController.abort();
						throw abortError;
					},
				}) as never,
			saveConnection: async () => {},
			navigate: () => {
				navigated = true;
			},
		}),
		(error) => error === abortError,
	);

	assert.equal(navigated, false);
	assert.equal(disconnectCalls, 1);
});

void test('connectAndOpenShell cleans up shell operation abort after late shell success', async () => {
	const shellAbortController = new AbortController();
	let closeCalls = 0;
	let disconnectCalls = 0;
	let navigated = false;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			shell: shellAbortController.signal,
		},
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					shellAbortController.abort();
					return {
						channelId: 7,
						close: async () => {
							closeCalls += 1;
						},
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			navigated = true;
		},
	});

	assert.equal(result.status, 'connected');
	assert.equal(navigated, false);
	assert.equal(closeCalls, 1);
	assert.equal(disconnectCalls, 1);
});

void test('connectAndOpenShell follows explicit shell signal when parent aborts after shell success', async () => {
	const abortController = new AbortController();
	const shellAbortController = new AbortController();
	const navigations: unknown[] = [];
	let closeCalls = 0;
	let disconnectCalls = 0;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignal: abortController.signal,
		operationSignals: {
			shell: shellAbortController.signal,
		},
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					abortController.abort();
					return {
						channelId: 7,
						close: async () => {
							closeCalls += 1;
						},
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: (params) => {
			navigations.push(params);
		},
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(navigations, [{ connectionId: 'conn-1', channelId: 7 }]);
	assert.equal(closeCalls, 0);
	assert.equal(disconnectCalls, 0);
});

void test('connectAndOpenShell cleans up an aborted late success', async () => {
	const abortController = new AbortController();
	let closeCalls = 0;
	let disconnectCalls = 0;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignal: abortController.signal,
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					abortController.abort();
					return {
						channelId: 7,
						close: async () => {
							closeCalls += 1;
						},
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('aborted connect should not navigate');
		},
	});

	assert.equal(result.status, 'connected');
	assert.equal(closeCalls, 1);
	assert.equal(disconnectCalls, 1);
});

void test('connectAndOpenShell navigates with tmux attach failure metadata', async () => {
	const navigatedWithError: unknown[] = [];
	const saveCalls: unknown[] = [];
	const startShellOptions: unknown[] = [];

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		connect: async () =>
			({
				connectionId: 'conn-1',
				startShell: async (options: unknown) => {
					startShellOptions.push(options);
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async (params) => {
			saveCalls.push(params);
		},
		navigate: () => {
			throw new Error('success navigation should not run');
		},
		navigateWithError: (params) => {
			navigatedWithError.push(params);
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(saveCalls.length, 1);
	assert.equal(
		(startShellOptions[0] as { registerInStore?: boolean }).registerInStore,
		undefined,
	);
	assert.deepEqual(navigatedWithError, [
		{
			connectionId: 'conn-1',
			tmuxAttachFailureReason: 'missing session',
			tmuxSessionName: 'main',
			storedConnectionId: 'muly-dev_tailnet_ts_net-22',
		},
	]);
});

void test('connectAndOpenShell suppresses aborted tmux error navigation and disconnects', async () => {
	const abortController = new AbortController();
	let disconnectCalls = 0;
	let navigatedWithError = false;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignal: abortController.signal,
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					abortController.abort();
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('success navigation should not run');
		},
		navigateWithError: () => {
			navigatedWithError = true;
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(disconnectCalls, 1);
	assert.equal(navigatedWithError, false);
});

void test('connectAndOpenShell suppresses shell operation aborted tmux error navigation and disconnects', async () => {
	const shellAbortController = new AbortController();
	let disconnectCalls = 0;
	let navigatedWithError = false;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			shell: shellAbortController.signal,
		},
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					shellAbortController.abort();
					throw {
						tag: 'TmuxAttachFailed',
						inner: ['missing session'],
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			throw new Error('success navigation should not run');
		},
		navigateWithError: () => {
			navigatedWithError = true;
		},
	});

	assert.equal(result.status, 'tmux_attach_failed');
	assert.equal(disconnectCalls, 1);
	assert.equal(navigatedWithError, false);
});

void test('connectAndOpenShell disconnects after connect operation abort before shell startup', async () => {
	const connectAbortController = new AbortController();
	const abortError = new Error('connect operation aborted');
	let disconnectCalls = 0;
	let startShellCalls = 0;
	let navigated = false;

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			operationSignals: {
				connect: connectAbortController.signal,
			},
			connect: async () => {
				connectAbortController.abort(abortError);
				return {
					connectionId: 'conn-1',
					disconnect: async () => {
						disconnectCalls += 1;
					},
					startShell: async () => {
						startShellCalls += 1;
						return { channelId: 7 };
					},
				} as never;
			},
			saveConnection: async () => {},
			navigate: () => {
				navigated = true;
			},
		}),
		(error) => error === abortError,
	);

	assert.equal(startShellCalls, 0);
	assert.equal(disconnectCalls, 1);
	assert.equal(navigated, false);
});

void test('connectAndOpenShell records connect failure', async () => {
	const events: unknown[] = [];
	let saveCalls = 0;
	let navigations = 0;

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () => {
				throw new Error('network unreachable');
			},
			saveConnection: async () => {
				saveCalls += 1;
			},
			navigate: () => {
				navigations += 1;
			},
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/network unreachable/,
	);

	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		['ssh.connect.started', 'ssh.connect.failed'],
	);
	assert.equal(saveCalls, 0);
	assert.equal(navigations, 0);
});

void test('connectAndOpenShell records shell failure without navigation', async () => {
	const events: unknown[] = [];
	const saveCalls: unknown[] = [];
	let navigations = 0;

	await assert.rejects(
		connectAndOpenShell({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			connect: async () =>
				({
					connectionId: 'conn-1',
					startShell: async () => {
						throw new Error('shell failed');
					},
				}) as never,
			saveConnection: async (params) => {
				saveCalls.push(params);
			},
			navigate: () => {
				navigations += 1;
			},
			trace: {
				event: (event) => {
					events.push(event);
				},
			},
		}),
		/shell failed/,
	);

	assert.equal(saveCalls.length, 1);
	assert.equal(navigations, 0);
	assert.deepEqual(
		events.map((event) => (event as { kind: string }).kind),
		[
			'ssh.connect.started',
			'ssh.connect.connected',
			'ssh.shell.started',
			'ssh.shell.failed',
		],
	);
	assert.doesNotMatch(JSON.stringify(events), /secret/);
});
