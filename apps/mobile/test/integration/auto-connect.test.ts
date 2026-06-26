import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getAutoConnectLaunchActionForUrl,
	shouldSkipInitialAutoConnectForUrl,
} from '../../src/lib/auto-connect-launch';
import { shouldMarkTailscaleRecoveryAttention } from '../../src/lib/auto-connect-recovery';

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
