import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectAndRememberConnection,
	connectWithoutRemembering,
} from '../../src/lib/ssh-connect-flow';

const connectionDetails = {
	username: 'muly',
	host: 'dev.tailnet.ts.net',
	port: 22,
	useTmux: true,
	tmuxSessionName: 'main',
	autoConnect: true,
	security: { type: 'key' as const, keyId: 'key-1' },
};

void test('connectWithoutRemembering forwards SSH connect parameters', async () => {
	const progressEvents: unknown[] = [];

	const result = await connectWithoutRemembering({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 5_000,
		onConnectionProgress: (event) => {
			progressEvents.push(event);
		},
		connect: async (params) => {
			assert.equal(params.host, 'dev.tailnet.ts.net');
			assert.equal(params.port, 22);
			assert.equal(params.username, 'muly');
			assert.deepEqual(params.security, {
				type: 'key',
				privateKey: 'secret',
			});
			assert.equal(params.abortSignal.aborted, false);
			assert.equal(await params.onServerKey({ fingerprint: 'abc' }), true);
			params.onConnectionProgress?.({ phase: 'auth' });
			return { connectionId: 'conn-1' };
		},
	});

	assert.deepEqual(result, { connectionId: 'conn-1' });
	assert.deepEqual(progressEvents, [{ phase: 'auth' }]);
});

void test('connectWithoutRemembering uses explicit connect signal when provided', async () => {
	const connectAbortController = new AbortController();

	await connectWithoutRemembering({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 5_000,
		connectSignal: connectAbortController.signal,
		connect: async (params) => {
			assert.equal(params.abortSignal, connectAbortController.signal);
			return { connectionId: 'conn-1' };
		},
	});
});

void test('connectAndRememberConnection saves after connecting', async () => {
	const calls: string[] = [];
	const saveCalls: unknown[] = [];

	const result = await connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 5_000,
		connect: async () => {
			calls.push('connect');
			return { connectionId: 'conn-1' };
		},
		saveConnection: async (params) => {
			calls.push('save');
			saveCalls.push(params);
		},
	});

	assert.deepEqual(calls, ['connect', 'save']);
	assert.deepEqual(result, {
		sshConnection: { connectionId: 'conn-1' },
		storedConnectionId: 'muly-dev_tailnet_ts_net-22',
	});
	assert.deepEqual(saveCalls, [
		{
			label: 'muly@dev.tailnet.ts.net:22',
			details: connectionDetails,
			priority: 0,
		},
	]);
});

void test('connectAndRememberConnection forwards explicit connect signal', async () => {
	const connectAbortController = new AbortController();

	await connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 5_000,
		connectSignal: connectAbortController.signal,
		connect: async (params) => {
			assert.equal(params.abortSignal, connectAbortController.signal);
			return { connectionId: 'conn-1' };
		},
		saveConnection: async () => {},
	});
});

void test('connectAndRememberConnection disconnects if save is abandoned after connect', async () => {
	const connectAbortController = new AbortController();
	let saveStarted!: () => void;
	const saveStartedPromise = new Promise<void>((resolve) => {
		saveStarted = resolve;
	});
	let disconnectCalls = 0;
	let disconnectSignal: AbortSignal | undefined;

	void connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 1,
		connectSignal: connectAbortController.signal,
		connect: async () => ({
			connectionId: 'conn-1',
			disconnect: async (opts?: { signal?: AbortSignal }) => {
				disconnectCalls += 1;
				disconnectSignal = opts?.signal;
			},
		}),
		saveConnection: async () => {
			saveStarted();
			return new Promise(() => {});
		},
	});

	await saveStartedPromise;
	connectAbortController.abort();
	await Promise.resolve();

	assert.equal(disconnectCalls, 1);
	assert.equal(disconnectSignal instanceof AbortSignal, true);
});

void test('connectAndRememberConnection rejects if save resolves after abort', async () => {
	const connectAbortController = new AbortController();
	const abortError = new Error('connect abandoned');
	let disconnectCalls = 0;

	await assert.rejects(
		connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 1,
			connectSignal: connectAbortController.signal,
			connect: async () => ({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
			}),
			saveConnection: async () => {
				connectAbortController.abort(abortError);
			},
		}),
		(error) => error === abortError,
	);

	assert.equal(disconnectCalls, 1);
});

void test('connectAndRememberConnection disconnects if signal aborted before late connect resolves', async () => {
	const connectAbortController = new AbortController();
	const abortError = new Error('connect abandoned');
	let disconnectCalls = 0;
	let saveCalls = 0;

	await assert.rejects(
		connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 1,
			connectSignal: connectAbortController.signal,
			connect: async () => {
				connectAbortController.abort(abortError);
				return {
					connectionId: 'conn-1',
					disconnect: async () => {
						disconnectCalls += 1;
					},
				};
			},
			saveConnection: async () => {
				saveCalls += 1;
			},
		}),
		(error) => error === abortError,
	);

	assert.equal(disconnectCalls, 1);
	assert.equal(saveCalls, 0);
});

void test('connectAndRememberConnection disconnects late connect after internal timeout', async () => {
	let disconnectCalls = 0;
	let saveCalls = 0;

	await assert.rejects(
		connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 1,
			connect: async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {
					connectionId: 'conn-1',
					disconnect: async () => {
						disconnectCalls += 1;
					},
				};
			},
			saveConnection: async () => {
				saveCalls += 1;
			},
		}),
		(error) => error instanceof Error && error.name === 'AbortError',
	);

	assert.equal(disconnectCalls, 1);
	assert.equal(saveCalls, 0);
});

void test('connectAndRememberConnection disconnects after save failure', async () => {
	const saveError = new Error('save failed');
	let disconnectCalls = 0;

	await assert.rejects(
		connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 1,
			connect: async () => ({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
			}),
			saveConnection: async () => {
				throw saveError;
			},
		}),
		(error) => error === saveError,
	);

	assert.equal(disconnectCalls, 1);
});

void test('connectAndRememberConnection does not save after connect failure', async () => {
	let saveCalls = 0;

	await assert.rejects(
		connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 5_000,
			connect: async () => {
				throw new Error('network unreachable');
			},
			saveConnection: async () => {
				saveCalls += 1;
			},
		}),
		/network unreachable/,
	);

	assert.equal(saveCalls, 0);
});
