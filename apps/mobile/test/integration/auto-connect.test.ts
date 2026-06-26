import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getAutoConnectLaunchActionForUrl,
	shouldSkipInitialAutoConnectForUrl,
} from '../../src/lib/auto-connect-launch';
import {
	canStartReplacementReconnect,
	canUpdateTailscaleAttention,
	getTailscaleManualResetDecision,
	isCurrentReconnectLoop,
	shouldMarkTailscaleRecoveryAttention,
	TAILSCALE_RESET_FAILED_MESSAGE,
	TAILSCALE_RESET_NOT_STARTED_MESSAGE,
} from '../../src/lib/auto-connect-recovery';

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

void test('Tailscale attention appears when initial ensure consumed recovery', () => {
	assert.equal(
		shouldMarkTailscaleRecoveryAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: false,
			retrySucceeded: false,
			available: true,
			ensureAttemptedBeforeFailure: true,
		}),
		true,
	);
});

void test('Tailscale attention appears after attempted recovery retry failure', () => {
	assert.equal(
		shouldMarkTailscaleRecoveryAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: false,
		}),
		true,
	);
});

void test('Tailscale attention stays hidden for skipped non-network recovery', () => {
	assert.equal(
		shouldMarkTailscaleRecoveryAttention({
			platformOS: 'android',
			networkLikeFailure: false,
			recoveryAttempted: false,
			retrySucceeded: false,
			available: true,
			ensureAttemptedBeforeFailure: true,
		}),
		false,
	);
});

void test('Tailscale attention stays hidden on unsupported platforms', () => {
	assert.equal(
		shouldMarkTailscaleRecoveryAttention({
			platformOS: 'ios',
			networkLikeFailure: true,
			recoveryAttempted: false,
			retrySucceeded: false,
			available: false,
			failed: true,
			ensureAttemptedBeforeFailure: true,
		}),
		false,
	);
});

void test('Tailscale attention appears for unavailable or failed recovery', () => {
	assert.equal(
		shouldMarkTailscaleRecoveryAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: false,
			retrySucceeded: false,
			available: false,
			ensureAttemptedBeforeFailure: false,
		}),
		true,
	);
	assert.equal(
		shouldMarkTailscaleRecoveryAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: false,
			retrySucceeded: false,
			available: true,
			failed: true,
			ensureAttemptedBeforeFailure: false,
		}),
		true,
	);
});

void test('Tailscale manual reset decision preserves attention on failed or skipped reset', () => {
	assert.deepEqual(
		getTailscaleManualResetDecision({ attempted: false, failed: true }),
		{
			kind: 'attention',
			message: TAILSCALE_RESET_FAILED_MESSAGE,
		},
	);
	assert.deepEqual(getTailscaleManualResetDecision({ attempted: false }), {
		kind: 'attention',
		message: TAILSCALE_RESET_NOT_STARTED_MESSAGE,
	});
	assert.deepEqual(getTailscaleManualResetDecision({ attempted: true }), {
		kind: 'reconnect',
	});
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
