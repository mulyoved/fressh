import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
	shouldShowTailscaleAttention,
} from '../../src/lib/tailscale-recovery-core';

void test('Tailscale recovery is Android-only', () => {
	assert.equal(isTailscaleRecoverySupported('android'), true);
	assert.equal(isTailscaleRecoverySupported('ios'), false);
	assert.equal(isTailscaleRecoverySupported('web'), false);
});

void test('network-like SSH errors trigger Tailscale recovery', () => {
	for (const message of [
		'Network is unreachable',
		'No route to host',
		'Connection timed out',
		'Operation timed out',
		'Unable to resolve host dev-remote-machine-1',
		'Connection reset by peer',
		'Broken pipe',
	]) {
		assert.equal(isNetworkLikeSshError(new Error(message)), true, message);
	}

	assert.equal(isNetworkLikeSshError('No route to host'), true);

	assert.equal(
		isNetworkLikeSshError({ tag: 'Russh', inner: ['Network is unreachable'] }),
		true,
	);
	assert.equal(
		isNetworkLikeSshError({
			tag: 'Russh',
			inner: [
				'failed to lookup address information: Name or service not known',
			],
		}),
		true,
	);
	assert.equal(
		isNetworkLikeSshError({
			tag: 'Russh',
			inner: ['No address associated with hostname'],
		}),
		true,
	);
	assert.equal(
		isNetworkLikeSshError({ tag: 'RusshKeys', inner: ['No route to host'] }),
		true,
	);

	const error = Object.assign(new Error('SshError.Russh'), {
		tag: 'Russh',
		inner: ['Connection timed out'],
	});
	assert.equal(isNetworkLikeSshError(error), true);
});

void test('non-network SSH errors do not trigger Tailscale recovery', () => {
	for (const error of [
		{ tag: 'Auth', inner: ['Network is unreachable'] },
		{ tag: 'TmuxAttachFailed', inner: ['session missing'] },
		{ tag: 'TmuxAttachFailed', inner: ['Network is unreachable'] },
		new Error('Permission denied (publickey)'),
		new Error('Host key verification failed'),
		new Error('Key missing'),
		new Error('Authentication failed'),
	]) {
		assert.equal(isNetworkLikeSshError(error), false, JSON.stringify(error));
	}
});

void test('Tailscale recovery cooldown allows first attempt and throttles the next', () => {
	const cooldown = createTailscaleRecoveryCooldown({ cooldownMs: 20_000 });

	assert.equal(cooldown.canAttempt(1_000), true);
	cooldown.recordAttempt(1_000);
	assert.equal(cooldown.canAttempt(5_000), false);
	cooldown.reset();
	assert.equal(cooldown.canAttempt(5_000), true);
	assert.equal(cooldown.canAttempt(21_000), true);
});

void test('attention state appears after failed automatic recovery', () => {
	assert.equal(
		shouldShowTailscaleAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: false,
		}),
		true,
	);
	assert.equal(
		shouldShowTailscaleAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: true,
		}),
		false,
	);
	assert.equal(
		shouldShowTailscaleAttention({
			platformOS: 'ios',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: false,
		}),
		false,
	);
});
