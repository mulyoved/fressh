import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getAutoConnectLaunchActionForUrl,
	shouldSkipInitialAutoConnectForUrl,
} from '../../src/lib/auto-connect-launch';
import { getTailscaleRecoveryAttentionDecision } from '../../src/lib/auto-connect-recovery';
import {
	TAILSCALE_REACHABILITY_MESSAGE,
	TAILSCALE_RESTART_FAILED_MESSAGE,
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
