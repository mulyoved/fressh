import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryTailscaleRecovery,
} from '../../src/lib/auto-connect-saved-entry';
// eslint-disable-next-line import/consistent-type-specifier-style -- keep query-fns type-only so Node integration tests do not load React Native at runtime
import type { ConnectAndOpenShellResult } from '../../src/lib/query-fns';
import {
	TAILSCALE_REACHABILITY_MESSAGE,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	TAILSCALE_UNAVAILABLE_MESSAGE,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from '../../src/lib/tailscale-recovery-core';

type ConnectedResult = Extract<
	ConnectAndOpenShellResult,
	{ status: 'connected' }
>;

function connectedResult(
	connectionId = 'connection-1',
): ConnectAndOpenShellResult {
	return {
		status: 'connected',
		connectionId,
		channelId: 1,
		sshConnection: {} as ConnectedResult['sshConnection'],
		shellHandle: {} as ConnectedResult['shellHandle'],
	};
}

function tmuxAttachFailedResult(
	connectionId = 'connection-1',
): ConnectAndOpenShellResult {
	return {
		status: 'tmux_attach_failed',
		connectionId,
		tmuxAttachFailureReason: 'no session',
		tmuxSessionName: 'main',
		storedConnectionId: 'stored-1',
	};
}

function recoveryFixture(opts?: {
	ready?: TailscaleReadyResult;
	afterFailure?: TailscaleRecoverAfterFailureResult;
}): SavedEntryTailscaleRecovery {
	return {
		ensureReady: async () =>
			opts?.ready ?? { kind: 'ready', attempted: true, available: true },
		recoverAfterFailure: async () =>
			opts?.afterFailure ?? {
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			},
	};
}

function harness(opts?: {
	recovery?: SavedEntryTailscaleRecovery;
	connectSavedEntry?: () => Promise<ConnectAndOpenShellResult>;
	platformOS?: string;
}) {
	const attention: string[] = [];
	let clearAttentionCount = 0;
	const tmuxFailures: ConnectAndOpenShellResult[] = [];
	const warnings: unknown[] = [];

	const attempt = () =>
		attemptSavedEntryWithTailscaleRecovery({
			platformOS: opts?.platformOS ?? 'android',
			recovery: opts?.recovery ?? recoveryFixture(),
			connectSavedEntry:
				opts?.connectSavedEntry ?? (async () => connectedResult()),
			markTailscaleAttention: (message) => {
				attention.push(message);
			},
			clearTailscaleAttention: () => {
				clearAttentionCount += 1;
			},
			logTmuxAttachFailure: (result) => {
				tmuxFailures.push(result);
			},
			logWarning: (_message, error) => {
				warnings.push(error);
			},
		});

	return {
		attempt,
		attention,
		get clearAttentionCount() {
			return clearAttentionCount;
		},
		tmuxFailures,
		warnings,
	};
}

void test('connects once when Tailscale is ready', async () => {
	let connectCount = 0;
	const context = harness({
		connectSavedEntry: async () => {
			connectCount += 1;
			return connectedResult();
		},
	});

	assert.deepEqual(await context.attempt(), { connected: true });
	assert.equal(connectCount, 1);
	assert.equal(context.clearAttentionCount, 1);
	assert.deepEqual(context.attention, []);
});

void test('connects once when Tailscale readiness is unsupported', async () => {
	let connectCount = 0;
	const context = harness({
		platformOS: 'ios',
		recovery: recoveryFixture({
			ready: {
				kind: 'unsupported',
				attempted: false,
				available: false,
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			return connectedResult();
		},
	});

	assert.deepEqual(await context.attempt(), { connected: true });
	assert.equal(connectCount, 1);
	assert.equal(context.clearAttentionCount, 1);
	assert.deepEqual(context.attention, []);
});

void test('marks unavailable before SSH connect', async () => {
	let connectCount = 0;
	const context = harness({
		recovery: recoveryFixture({
			ready: {
				kind: 'unavailable',
				attempted: false,
				available: false,
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			return connectedResult();
		},
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.equal(connectCount, 0);
	assert.deepEqual(context.attention, [TAILSCALE_UNAVAILABLE_MESSAGE]);
	assert.equal(context.clearAttentionCount, 0);
});

void test('marks failed readiness before SSH connect', async () => {
	let connectCount = 0;
	const context = harness({
		recovery: recoveryFixture({
			ready: {
				kind: 'failed',
				attempted: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			return connectedResult();
		},
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.equal(connectCount, 0);
	assert.deepEqual(context.attention, [TAILSCALE_RESTART_FAILED_MESSAGE]);
	assert.equal(context.clearAttentionCount, 0);
});

void test('retries once after recovered network-like failure', async () => {
	const calls: string[] = [];
	const networkError = new Error('No route to host');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			calls.push('connect');
			if (calls.length === 1) {
				throw networkError;
			}
			return connectedResult();
		},
	});

	assert.deepEqual(await context.attempt(), { connected: true });
	assert.deepEqual(calls, ['connect', 'connect']);
	assert.equal(context.clearAttentionCount, 1);
	assert.deepEqual(context.attention, []);
});

void test('retries once when readiness preflight already nudged Tailscale', async () => {
	const calls: string[] = [];
	const networkError = new Error('No route to host');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'preflightReady',
				attempted: false,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			calls.push('connect');
			if (calls.length === 1) {
				throw networkError;
			}
			return connectedResult();
		},
	});

	assert.deepEqual(await context.attempt(), { connected: true });
	assert.deepEqual(calls, ['connect', 'connect']);
	assert.equal(context.clearAttentionCount, 1);
	assert.deepEqual(context.attention, []);
});

void test('marks attention without retry when network recovery fails', async () => {
	let connectCount = 0;
	const networkError = new Error('No route to host');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'failed',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			throw networkError;
		},
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.equal(connectCount, 1);
	assert.deepEqual(context.attention, [TAILSCALE_RESTART_FAILED_MESSAGE]);
	assert.equal(context.clearAttentionCount, 0);
});

void test('marks reachability attention without retry when recovery is cooldown or notStarted', async () => {
	for (const kind of ['cooldown', 'notStarted'] as const) {
		let connectCount = 0;
		const networkError = new Error('No route to host');
		const context = harness({
			recovery: recoveryFixture({
				afterFailure: {
					kind,
					attempted: false,
					networkLikeFailure: true,
					available: true,
				},
			}),
			connectSavedEntry: async () => {
				connectCount += 1;
				throw networkError;
			},
		});

		assert.deepEqual(await context.attempt(), { connected: false });
		assert.equal(connectCount, 1);
		assert.deepEqual(context.attention, [TAILSCALE_REACHABILITY_MESSAGE]);
		assert.equal(context.clearAttentionCount, 0);
	}
});

void test('rethrows non-network failures', async () => {
	const authError = new Error('Permission denied');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'nonNetworkFailure',
				attempted: false,
				networkLikeFailure: false,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			throw authError;
		},
	});

	await assert.rejects(context.attempt, authError);
	assert.deepEqual(context.attention, []);
	assert.equal(context.clearAttentionCount, 0);
});

void test('marks restart-failed attention when retry fails', async () => {
	const retryError = new Error('No route to host');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			throw retryError;
		},
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.deepEqual(context.attention, [TAILSCALE_RESTART_FAILED_MESSAGE]);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.warnings, [retryError]);
});

void test('rethrows non-network failure from recovery retry', async () => {
	let connectCount = 0;
	const retryError = new Error('Permission denied');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			if (connectCount === 1) {
				throw new Error('No route to host');
			}
			throw retryError;
		},
	});

	await assert.rejects(context.attempt, retryError);
	assert.equal(connectCount, 2);
	assert.deepEqual(context.attention, []);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.warnings, []);
});

void test('marks restart-failed attention when preflight retry fails', async () => {
	const retryError = new Error('No route to host');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'preflightReady',
				attempted: false,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			throw retryError;
		},
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.deepEqual(context.attention, [TAILSCALE_RESTART_FAILED_MESSAGE]);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.warnings, [retryError]);
});

void test('handles tmux_attach_failed before recovery without clearing attention', async () => {
	const tmuxResult = tmuxAttachFailedResult();
	const context = harness({
		connectSavedEntry: async () => tmuxResult,
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.deepEqual(context.tmuxFailures, [tmuxResult]);
	assert.equal(context.clearAttentionCount, 0);
});

void test('handles tmux_attach_failed after recovery without clearing attention', async () => {
	let connectCount = 0;
	const networkError = new Error('No route to host');
	const tmuxResult = tmuxAttachFailedResult();
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			if (connectCount === 1) {
				throw networkError;
			}
			return tmuxResult;
		},
	});

	assert.deepEqual(await context.attempt(), { connected: false });
	assert.deepEqual(context.tmuxFailures, [tmuxResult]);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.attention, []);
});

void test('readiness cooldown and notStarted still allow SSH probe', async () => {
	for (const ready of [
		{ kind: 'cooldown', attempted: false, available: true },
		{ kind: 'notStarted', attempted: false, available: true },
	] as const) {
		let connectCount = 0;
		const context = harness({
			recovery: recoveryFixture({ ready }),
			connectSavedEntry: async () => {
				connectCount += 1;
				return connectedResult();
			},
		});

		assert.deepEqual(await context.attempt(), { connected: true });
		assert.equal(connectCount, 1);
		assert.deepEqual(context.attention, []);
		assert.equal(context.clearAttentionCount, 1);
	}
});

void test('readiness cooldown and notStarted mark reachability after failed SSH probe', async () => {
	for (const kind of ['cooldown', 'notStarted'] as const) {
		let connectCount = 0;
		const networkError = new Error('No route to host');
		const context = harness({
			recovery: recoveryFixture({
				ready: { kind, attempted: false, available: true },
				afterFailure: {
					kind,
					attempted: false,
					networkLikeFailure: true,
					available: true,
				},
			}),
			connectSavedEntry: async () => {
				connectCount += 1;
				throw networkError;
			},
		});

		assert.deepEqual(await context.attempt(), { connected: false });
		assert.equal(connectCount, 1);
		assert.deepEqual(context.attention, [TAILSCALE_REACHABILITY_MESSAGE]);
		assert.equal(context.clearAttentionCount, 0);
	}
});

void test('records Tailscale recovery retry trace events', async () => {
	const events: unknown[] = [];
	let connectCalls = 0;

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'ready' as const,
				attempted: true as const,
				available: true as const,
			}),
			recoverAfterFailure: async () => ({
				kind: 'recovered' as const,
				attempted: true as const,
				networkLikeFailure: true as const,
				available: true as const,
			}),
		},
		connectSavedEntry: async () => {
			connectCalls += 1;
			if (connectCalls === 1) throw new Error('network unreachable');
			return {
				status: 'connected',
				sshConnection: {} as never,
				shellHandle: {} as never,
				connectionId: 'conn-2',
				channelId: 3,
			};
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logTmuxAttachFailure: () => {},
		logWarning: () => {},
		trace: {
			event: (event) => {
				events.push(event);
			},
		},
	});

	assert.deepEqual(result, { connected: true });
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		[
			'tailscale.ensure-ready.result',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.threw',
			'tailscale.recovery.result',
			'auto-connect.saved-entry.retry.started',
			'auto-connect.saved-entry.connect.connected',
		],
	);
});

void test('trace payload mutation cannot bypass Tailscale readiness block', async () => {
	let connectCalls = 0;
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: recoveryFixture({
			ready: {
				kind: 'unavailable',
				attempted: false,
				available: false,
			},
		}),
		connectSavedEntry: async () => {
			connectCalls += 1;
			return connectedResult();
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logTmuxAttachFailure: () => {},
		logWarning: () => {},
		trace: {
			event: (event) => {
				if (event.type !== 'tailscale.ensure-ready.result') return;
				const details = event.details as {
					readiness?: { kind?: string; available?: boolean };
				};
				if (details.readiness) {
					details.readiness.kind = 'ready';
					details.readiness.available = true;
				}
			},
		},
	});

	assert.deepEqual(result, { connected: false });
	assert.equal(connectCalls, 0);
});

void test('trace payload mutation cannot force Tailscale retry', async () => {
	let connectCalls = 0;
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'failed',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async () => {
			connectCalls += 1;
			throw new Error('No route to host');
		},
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logTmuxAttachFailure: () => {},
		logWarning: () => {},
		trace: {
			event: (event) => {
				if (event.type !== 'tailscale.recovery.result') return;
				const details = event.details as {
					recoveryResult?: {
						kind?: string;
						networkLikeFailure?: boolean;
					};
				};
				if (details.recoveryResult) {
					details.recoveryResult.kind = 'recovered';
					details.recoveryResult.networkLikeFailure = false;
				}
			},
		},
	});

	assert.deepEqual(result, { connected: false });
	assert.equal(connectCalls, 1);
});

void test('trace payload mutation cannot convert tmux attach failure to success', async () => {
	const tmuxResult = tmuxAttachFailedResult();
	const tmuxFailures: ConnectAndOpenShellResult[] = [];

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: recoveryFixture(),
		connectSavedEntry: async () => tmuxResult,
		markTailscaleAttention: () => {},
		clearTailscaleAttention: () => {},
		logTmuxAttachFailure: (result) => {
			tmuxFailures.push(result);
		},
		logWarning: () => {},
		trace: {
			event: (event) => {
				if (
					event.type !== 'auto-connect.saved-entry.connect.tmux-attach-failed'
				) {
					return;
				}
				const details = event.details as { status?: string };
				details.status = 'connected';
			},
		},
	});

	assert.deepEqual(result, { connected: false });
	assert.deepEqual(tmuxFailures, [tmuxResult]);
});
