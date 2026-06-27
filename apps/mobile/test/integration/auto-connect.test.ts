import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getAutoConnectLaunchActionForUrl,
	shouldSkipInitialAutoConnectForUrl,
} from '../../src/lib/auto-connect-launch';
import {
	canStartReplacementReconnect,
	canUpdateTailscaleAttention,
	getTailscaleRecoveryAttentionDecision,
	getTailscaleManualResetDecision,
	isCurrentReconnectLoop,
} from '../../src/lib/auto-connect-recovery';
import {
	TAILSCALE_REACHABILITY_MESSAGE,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	TAILSCALE_RESET_FAILED_MESSAGE,
	TAILSCALE_RESET_NOT_STARTED_MESSAGE,
} from '../../src/lib/tailscale-recovery-core';

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

void test('Tailscale recovery attention decision uses restart failed copy for failed automatic recovery', () => {
	assert.deepEqual(
		getTailscaleRecoveryAttentionDecision({
			platformOS: 'android',
			result: {
				kind: 'failed',
				attempted: false,
				networkLikeFailure: true,
				available: true,
			},
			retrySucceeded: false,
		}),
		{
			kind: 'attention',
			message: TAILSCALE_RESTART_FAILED_MESSAGE,
		},
	);
});

void test('Tailscale recovery attention decision uses reachability copy for cooldown and notStarted recovery', () => {
	for (const kind of ['cooldown', 'notStarted'] as const) {
		assert.deepEqual(
			getTailscaleRecoveryAttentionDecision({
				platformOS: 'android',
				result: {
					kind,
					attempted: false,
					networkLikeFailure: true,
					available: true,
				},
				retrySucceeded: false,
			}),
			{
				kind: 'attention',
				message: TAILSCALE_REACHABILITY_MESSAGE,
			},
		);
	}
});

void test('Tailscale recovery attention decision handles recovered retry outcome', () => {
	assert.deepEqual(
		getTailscaleRecoveryAttentionDecision({
			platformOS: 'android',
			result: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
			retrySucceeded: false,
		}),
		{
			kind: 'attention',
			message: TAILSCALE_RESTART_FAILED_MESSAGE,
		},
	);
	assert.deepEqual(
		getTailscaleRecoveryAttentionDecision({
			platformOS: 'android',
			result: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
			retrySucceeded: true,
		}),
		{
			kind: 'none',
		},
	);
});

void test('Tailscale manual reset decision preserves attention on failed or skipped reset', () => {
	assert.deepEqual(
		getTailscaleManualResetDecision({ kind: 'failed', attempted: false }),
		{
			kind: 'attention',
			message: TAILSCALE_RESET_FAILED_MESSAGE,
		},
	);
	assert.deepEqual(
		getTailscaleManualResetDecision({ kind: 'failed', attempted: true }),
		{
			kind: 'attention',
			message: TAILSCALE_RESET_FAILED_MESSAGE,
		},
	);
	assert.deepEqual(
		getTailscaleManualResetDecision({ kind: 'notStarted', attempted: false }),
		{
			kind: 'attention',
			message: TAILSCALE_RESET_NOT_STARTED_MESSAGE,
		},
	);
	assert.deepEqual(
		getTailscaleManualResetDecision({ kind: 'unsupported', attempted: false }),
		{
			kind: 'none',
		},
	);
	assert.deepEqual(
		getTailscaleManualResetDecision({ kind: 'reset', attempted: true }),
		{
			kind: 'reconnect',
		},
	);
});

void test('Tailscale reset reconnect starts only after reset is no longer in flight', () => {
	assert.equal(
		canStartReplacementReconnect({
			resetInFlight: true,
			reconnectLoopRunning: false,
			isReconnecting: false,
			isAutoConnecting: false,
		}),
		false,
	);
	assert.equal(
		canStartReplacementReconnect({
			resetInFlight: false,
			reconnectLoopRunning: false,
			isReconnecting: false,
			isAutoConnecting: false,
		}),
		true,
	);
	assert.equal(
		canStartReplacementReconnect({
			resetInFlight: false,
			reconnectLoopRunning: true,
			isReconnecting: false,
			isAutoConnecting: false,
		}),
		false,
	);
	assert.equal(
		canStartReplacementReconnect({
			resetInFlight: false,
			reconnectLoopRunning: false,
			isReconnecting: true,
			isAutoConnecting: false,
		}),
		false,
	);
	assert.equal(
		canStartReplacementReconnect({
			resetInFlight: false,
			reconnectLoopRunning: false,
			isReconnecting: false,
			isAutoConnecting: true,
		}),
		false,
	);
});

void test('Tailscale attention updates are suppressed during manual reset unless forced', () => {
	assert.equal(canUpdateTailscaleAttention({ resetInFlight: true }), false);
	assert.equal(
		canUpdateTailscaleAttention({ resetInFlight: true, force: true }),
		true,
	);
	assert.equal(canUpdateTailscaleAttention({ resetInFlight: false }), true);
});

void test('stale reconnect loops cannot update reconnect state', () => {
	assert.equal(
		isCurrentReconnectLoop({
			currentGeneration: 2,
			loopGeneration: 2,
			reconnectLoopRunning: true,
		}),
		true,
	);
	assert.equal(
		isCurrentReconnectLoop({
			currentGeneration: 3,
			loopGeneration: 2,
			reconnectLoopRunning: true,
		}),
		false,
	);
	assert.equal(
		isCurrentReconnectLoop({
			currentGeneration: 2,
			loopGeneration: 2,
			reconnectLoopRunning: false,
		}),
		false,
	);
});
