import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from '../../src/lib/auto-connect-saved-entry';
import { type ConnectionDiagnosticEvent } from '../../src/lib/connection-diagnostics/events';
import { createSavedEntryTailscaleDiagnosticRecovery } from '../../src/lib/saved-entry-tailscale-diagnostic-recovery';
import {
	TAILSCALE_REACHABILITY_MESSAGE,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	TAILSCALE_UNAVAILABLE_MESSAGE,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from '../../src/lib/tailscale-recovery-core';

function connectedResult(
	connectionId = 'connection-1',
): SavedEntryConnectResult {
	return {
		status: 'connected',
		connectionId,
		channelId: 1,
	};
}

function tmuxAttachFailedResult(
	connectionId = 'connection-1',
): SavedEntryConnectResult {
	return {
		status: 'tmux_attach_failed',
		connectionId,
		tmuxAttachFailureReason: 'no session',
		tmuxSessionName: 'main',
		storedConnectionId: 'stored-1',
	};
}

function abortedResult(
	reason: unknown = 'caller-aborted',
): SavedEntryConnectResult {
	return {
		status: 'aborted',
		reason,
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
	connectSavedEntry?: (
		phase: SavedEntryConnectAttemptPhase,
	) => Promise<SavedEntryConnectResult>;
	platformOS?: string;
}) {
	const attention: string[] = [];
	let clearAttentionCount = 0;
	const tmuxFailures: SavedEntryConnectResult[] = [];
	const warnings: unknown[] = [];

	const attempt = async () => {
		const result = await attemptSavedEntryWithTailscaleRecovery({
			platformOS: opts?.platformOS ?? 'android',
			recovery: opts?.recovery ?? recoveryFixture(),
			connectSavedEntry:
				opts?.connectSavedEntry ?? (async () => connectedResult()),
		});
		switch (result.status) {
			case 'connected':
				clearAttentionCount += 1;
				return { connected: true };
			case 'tmuxAttachFailed':
				tmuxFailures.push(result.result);
				return { connected: false };
			case 'aborted':
				return {
					connected: false,
					aborted: true,
					reason: result.result.reason,
				};
			case 'blocked':
			case 'recoveryNotAttempted':
				if (result.attentionMessage !== null) {
					attention.push(result.attentionMessage);
				}
				return { connected: false };
			case 'retryFailed':
				if (result.attentionMessage !== null) {
					attention.push(result.attentionMessage);
				}
				warnings.push(result.error);
				return { connected: false };
			case 'threw':
				throw result.error;
		}
	};

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

void test('saved-entry recovery helper returns connected outcome', async () => {
	const args = {
		platformOS: 'android',
		recovery: recoveryFixture(),
		connectSavedEntry: async () => connectedResult(),
	};
	const result = await attemptSavedEntryWithTailscaleRecovery(args);

	assert.equal(result.status, 'connected');
	if (result.status !== 'connected') return;
	assert.deepEqual(result.result, connectedResult());
});

void test('saved-entry recovery helper returns aborted outcome without recovery', async () => {
	let connectCount = 0;
	let recoveryCount = 0;
	const abortReason = new Error('saved-entry connect aborted');
	const context = harness({
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => {
				recoveryCount += 1;
				return {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				};
			},
		},
		connectSavedEntry: async () => {
			connectCount += 1;
			return abortedResult(abortReason);
		},
	});

	const result = await context.attempt();

	assert.deepEqual(result, {
		connected: false,
		aborted: true,
		reason: abortReason,
	});
	assert.equal(connectCount, 1);
	assert.equal(recoveryCount, 0);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.attention, []);
});

void test('saved-entry recovery helper exposes aborted result directly', async () => {
	const abortReason = new Error('saved-entry direct abort');

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => {
				throw new Error('aborted result should not recover');
			},
		},
		connectSavedEntry: async () => abortedResult(abortReason),
	});

	assert.deepEqual(result, {
		status: 'aborted',
		result: {
			status: 'aborted',
			reason: abortReason,
		},
	});
});

void test('Tailscale diagnostic recovery ignores ensure-ready emit failures', async () => {
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: createSavedEntryTailscaleDiagnosticRecovery({
			platformOS: 'android',
			recovery: recoveryFixture(),
			emit: () => {
				throw new Error('trace failed');
			},
		}),
		connectSavedEntry: async () => connectedResult(),
	});

	assert.equal(result.status, 'connected');
	if (result.status !== 'connected') return;
	assert.deepEqual(result.result, connectedResult());
});

void test('Tailscale diagnostic recovery emits ensure-ready payload', async () => {
	const events: ConnectionDiagnosticEvent[] = [];
	const readiness = {
		kind: 'ready',
		attempted: true,
		available: true,
	} satisfies TailscaleReadyResult;
	const recovery = createSavedEntryTailscaleDiagnosticRecovery({
		platformOS: 'android',
		recovery: recoveryFixture({ ready: readiness }),
		emit: (event) => {
			events.push(event);
		},
	});

	assert.deepEqual(await recovery.ensureReady(), readiness);
	assert.deepEqual(events, [
		{
			kind: 'tailscale.ensure-ready.result',
			source: 'tailscale-recovery',
			message: undefined,
			platformOS: 'android',
			readiness,
		},
	]);
});

void test('trace payload mutation cannot bypass Tailscale readiness block', async () => {
	let connectCount = 0;
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: createSavedEntryTailscaleDiagnosticRecovery({
			platformOS: 'android',
			recovery: recoveryFixture({
				ready: {
					kind: 'unavailable',
					attempted: false,
					available: false,
				},
			}),
			emit: (event) => {
				if (event.kind !== 'tailscale.ensure-ready.result') return;
				Object.assign(event.readiness, {
					kind: 'ready',
					attempted: true,
					available: true,
				} satisfies TailscaleReadyResult);
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			return connectedResult();
		},
	});

	assert.equal(result.status, 'blocked');
	assert.equal(connectCount, 0);
});

void test('saved-entry retry policy returns blocked without UI callbacks', async () => {
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'failed',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => {
				throw new Error('recover should not run');
			},
		},
		connectSavedEntry: async () => {
			throw new Error('connect should not run');
		},
	});

	assert.equal(result.status, 'blocked');
	if (result.status !== 'blocked') return;
	assert.match(result.attentionMessage ?? '', /Tailscale/i);
});

void test('saved-entry retry policy returns retryFailed after recovery retry failure', async () => {
	const retryError = new Error('No route to host');
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => ({
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			}),
		},
		connectSavedEntry: async () => {
			throw retryError;
		},
	});

	assert.equal(result.status, 'retryFailed');
	if (result.status !== 'retryFailed') return;
	assert.equal(result.error, retryError);
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

void test('returns aborted outcome after recovered retry aborts', async () => {
	const phases: SavedEntryConnectAttemptPhase[] = [];
	const networkError = new Error('No route to host');
	const abortReason = new Error('saved-entry retry aborted');
	const context = harness({
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async (phase) => {
			phases.push(phase);
			if (phase === 'initial') {
				throw networkError;
			}
			return abortedResult(abortReason);
		},
	});

	assert.deepEqual(await context.attempt(), {
		connected: false,
		aborted: true,
		reason: abortReason,
	});
	assert.deepEqual(phases, ['initial', 'retry']);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.attention, []);
	assert.deepEqual(context.warnings, []);
});

void test('passes explicit connect attempt phases to saved-entry connector', async () => {
	const phases: unknown[] = [];
	let connectCalls = 0;

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: recoveryFixture({
			afterFailure: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		connectSavedEntry: async (phase) => {
			phases.push(phase);
			connectCalls += 1;
			if (connectCalls === 1) throw new Error('No route to host');
			return connectedResult();
		},
	});

	assert.equal(result.status, 'connected');
	assert.deepEqual(phases, ['initial', 'retry']);
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

void test('returns false for non-network failures without attention', async () => {
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

	assert.deepEqual(await context.attempt(), { connected: false });
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

void test('marks reachability attention when preflight retry fails without restarting Tailscale', async () => {
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
	assert.deepEqual(context.attention, [TAILSCALE_REACHABILITY_MESSAGE]);
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

void test('saved-entry recovery retry returns connected outcome', async () => {
	let connectCalls = 0;

	const args = {
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
			return connectedResult('conn-2');
		},
	};
	const result = await attemptSavedEntryWithTailscaleRecovery(args);

	assert.equal(result.status, 'connected');
	assert.equal(connectCalls, 2);
	if (result.status !== 'connected') return;
	assert.deepEqual(result.result, connectedResult('conn-2'));
});

void test('Tailscale diagnostic recovery ignores recovery emit failures', async () => {
	let connectCalls = 0;
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: createSavedEntryTailscaleDiagnosticRecovery({
			platformOS: 'android',
			recovery: recoveryFixture({
				afterFailure: {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				},
			}),
			emit: (event) => {
				if (event.kind === 'tailscale.recovery.result') {
					throw new Error('trace failed');
				}
			},
		}),
		connectSavedEntry: async (phase) => {
			connectCalls += 1;
			if (phase === 'initial') throw new Error('network unreachable');
			return connectedResult('conn-2');
		},
	});

	assert.equal(result.status, 'connected');
	assert.equal(connectCalls, 2);
	if (result.status !== 'connected') return;
	assert.deepEqual(result.result, connectedResult('conn-2'));
});

void test('Tailscale diagnostic recovery emits recovery payload', async () => {
	const events: ConnectionDiagnosticEvent[] = [];
	const recoveryResult = {
		kind: 'recovered',
		attempted: true,
		networkLikeFailure: true,
		available: true,
	} satisfies TailscaleRecoverAfterFailureResult;
	const recovery = createSavedEntryTailscaleDiagnosticRecovery({
		platformOS: 'android',
		recovery: recoveryFixture({ afterFailure: recoveryResult }),
		emit: (event) => {
			events.push(event);
		},
	});

	assert.deepEqual(
		await recovery.recoverAfterFailure(new Error('network unreachable')),
		recoveryResult,
	);
	assert.deepEqual(events, [
		{
			kind: 'tailscale.recovery.result',
			source: 'tailscale-recovery',
			message: undefined,
			recoveryResult,
		},
	]);
});

void test('trace payload mutation cannot force Tailscale retry', async () => {
	let connectCount = 0;
	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: createSavedEntryTailscaleDiagnosticRecovery({
			platformOS: 'android',
			recovery: recoveryFixture({
				afterFailure: {
					kind: 'nonNetworkFailure',
					attempted: false,
					networkLikeFailure: false,
					available: true,
				},
			}),
			emit: (event) => {
				if (event.kind !== 'tailscale.recovery.result') return;
				Object.assign(event.recoveryResult, {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				} satisfies TailscaleRecoverAfterFailureResult);
			},
		}),
		connectSavedEntry: async () => {
			connectCount += 1;
			throw new Error('permission denied');
		},
	});

	assert.equal(result.status, 'recoveryNotAttempted');
	assert.equal(connectCount, 1);
});
