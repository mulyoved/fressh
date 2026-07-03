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

void test('connectAndRememberConnection awaits in-flight abort disconnect before rejecting', async () => {
	const connectAbortController = new AbortController();
	const abortError = new Error('connect abandoned');
	let saveStarted!: () => void;
	let resolveSave!: () => void;
	let disconnectStarted!: () => void;
	let resolveDisconnect!: () => void;
	const saveStartedPromise = new Promise<void>((resolve) => {
		saveStarted = resolve;
	});
	const savePromise = new Promise<void>((resolve) => {
		resolveSave = resolve;
	});
	const disconnectStartedPromise = new Promise<void>((resolve) => {
		disconnectStarted = resolve;
	});
	const disconnectPromise = new Promise<void>((resolve) => {
		resolveDisconnect = resolve;
	});
	let settled = false;

	const resultPromise = connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 1,
		connectSignal: connectAbortController.signal,
		connect: async () => ({
			connectionId: 'conn-1',
			disconnect: async () => {
				disconnectStarted();
				await disconnectPromise;
			},
		}),
		saveConnection: async () => {
			saveStarted();
			await savePromise;
		},
	}).finally(() => {
		settled = true;
	});
	void resultPromise.catch(() => {});

	await saveStartedPromise;
	connectAbortController.abort(abortError);
	await disconnectStartedPromise;
	resolveSave();
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(settled, false);
	resolveDisconnect();
	await assert.rejects(resultPromise, (error) => error === abortError);
	assert.equal(settled, true);
});

void test('connectAndRememberConnection reports abort disconnect failure while save is pending', async () => {
	const connectAbortController = new AbortController();
	const disconnectError = new Error('disconnect failed');
	let saveStarted!: () => void;
	let reportedError: unknown;
	const saveStartedPromise = new Promise<void>((resolve) => {
		saveStarted = resolve;
	});
	const reportPromise = new Promise<void>((resolve) => {
		void connectAndRememberConnection({
			connectionDetails,
			resolvedSecurity: { type: 'key', privateKey: 'secret' },
			abortSignalTimeoutMs: 1,
			connectSignal: connectAbortController.signal,
			connect: async () => ({
				connectionId: 'conn-1',
				disconnect: async () => {
					throw disconnectError;
				},
			}),
			saveConnection: async () => {
				saveStarted();
				return new Promise(() => {});
			},
			onDisconnectAfterAbortFailure: (error) => {
				reportedError = error;
				resolve();
			},
		});
	});

	await saveStartedPromise;
	connectAbortController.abort();
	await reportPromise;

	assert.equal(reportedError, disconnectError);
});

void test('connectAndRememberConnection preserves abort reason after rejected in-flight disconnect', async () => {
	const connectAbortController = new AbortController();
	const abortError = new Error('connect abandoned');
	const disconnectError = new Error('disconnect failed');
	let saveStarted!: () => void;
	let resolveSave!: () => void;
	let disconnectCalls = 0;
	let reportCalls = 0;
	const saveStartedPromise = new Promise<void>((resolve) => {
		saveStarted = resolve;
	});
	const savePromise = new Promise<void>((resolve) => {
		resolveSave = resolve;
	});

	const resultPromise = connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 1,
		connectSignal: connectAbortController.signal,
		connect: async () => ({
			connectionId: 'conn-1',
			disconnect: async () => {
				disconnectCalls += 1;
				throw disconnectError;
			},
		}),
		saveConnection: async () => {
			saveStarted();
			await savePromise;
		},
		onDisconnectAfterAbortFailure: (error) => {
			assert.equal(error, disconnectError);
			reportCalls += 1;
		},
	});
	void resultPromise.catch(() => {});

	await saveStartedPromise;
	connectAbortController.abort(abortError);
	await new Promise((resolve) => setImmediate(resolve));
	resolveSave();

	await assert.rejects(resultPromise, (error) => error === abortError);
	assert.equal(disconnectCalls, 1);
	assert.equal(reportCalls, 1);
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

void test('connectAndRememberConnection handles aborted connect signal without reason', async () => {
	let saveStarted!: () => void;
	let resolveSave!: () => void;
	const saveStartedPromise = new Promise<void>((resolve) => {
		saveStarted = resolve;
	});
	const savePromise = new Promise<void>((resolve) => {
		resolveSave = resolve;
	});
	let disconnectCalls = 0;
	const listeners = new Set<() => void>();
	const connectSignal = {
		aborted: false,
		reason: undefined,
		addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
			listeners.add(listener as () => void);
		},
		removeEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			listeners.delete(listener as () => void);
		},
	} as AbortSignal;
	const abortWithoutReason = () => {
		Object.assign(connectSignal, { aborted: true });
		for (const listener of listeners) listener();
	};

	const resultPromise = connectAndRememberConnection({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignalTimeoutMs: 1,
		connectSignal,
		connect: async () => ({
			connectionId: 'conn-1',
			disconnect: async () => {
				disconnectCalls += 1;
			},
		}),
		saveConnection: async () => {
			saveStarted();
			await savePromise;
		},
	});
	void resultPromise.catch(() => {});

	await saveStartedPromise;
	abortWithoutReason();
	resolveSave();

	await assert.rejects(
		resultPromise,
		(error) =>
			error instanceof Error && error.message === 'SSH connect aborted',
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
