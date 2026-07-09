import assert from 'node:assert/strict';
import test from 'node:test';
import {
	tailscaleDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';
import {
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from '../../src/lib/tailscale-recovery-core';

const withExtra = <T extends object>(value: T): T & { extra: string } => ({
	...value,
	extra: 'must-not-copy',
});

void test('tailscale events copy readiness and recovery result shapes', () => {
	const readiness = withExtra({
		kind: 'ready',
		attempted: true,
		available: true,
	} satisfies TailscaleReadyResult);
	const recoveryResult = withExtra({
		kind: 'recovered',
		attempted: true,
		networkLikeFailure: true,
		available: true,
	} satisfies TailscaleRecoverAfterFailureResult);
	const ready = tailscaleDiagnosticEvents.ensureReadyResult({
		source: 'tailscale-recovery',
		platformOS: 'android',
		readiness,
	});
	const recovery = tailscaleDiagnosticEvents.recoveryResult({
		source: 'tailscale-recovery',
		recoveryResult,
	});
	const events: ConnectionDiagnosticEvent[] = [ready, recovery];

	assert.deepEqual(
		events.map((event) => event.kind),
		['tailscale.ensure-ready.result', 'tailscale.recovery.result'],
	);
	assert.equal('extra' in ready.readiness, false);
	assert.equal('extra' in recovery.recoveryResult, false);
});

void test('tailscale ensure-ready copies every readiness variant explicitly', () => {
	const readinessVariants = [
		{ kind: 'unsupported', attempted: false, available: false },
		{ kind: 'unavailable', attempted: false, available: false },
		{
			kind: 'networkUnavailable',
			attempted: false,
			available: false,
			network: {
				connected: false,
				internetCapable: false,
				validated: false,
				wifiConnected: false,
				transports: [],
			},
		},
		{ kind: 'ready', attempted: true, available: true },
		{ kind: 'cooldown', attempted: false, available: true },
		{ kind: 'notStarted', attempted: false, available: true },
		{ kind: 'failed', attempted: true, available: true },
	] as const satisfies readonly TailscaleReadyResult[];

	for (const expected of readinessVariants) {
		const event = tailscaleDiagnosticEvents.ensureReadyResult({
			source: 'tailscale-recovery',
			platformOS: 'android',
			readiness: withExtra(expected),
		});

		assert.deepEqual(event.readiness, expected);
		assert.equal('extra' in event.readiness, false);
	}
});

void test('tailscale recovery copies every recovery variant explicitly', () => {
	const recoveryVariants = [
		{
			kind: 'nonNetworkFailure',
			attempted: false,
			networkLikeFailure: false,
			available: true,
		},
		{
			kind: 'unsupported',
			attempted: false,
			networkLikeFailure: true,
			available: false,
		},
		{
			kind: 'unavailable',
			attempted: false,
			networkLikeFailure: true,
			available: false,
		},
		{
			kind: 'networkUnavailable',
			attempted: false,
			networkLikeFailure: true,
			available: false,
			network: {
				connected: false,
				internetCapable: false,
				validated: false,
				wifiConnected: false,
				transports: [],
			},
		},
		{
			kind: 'cooldown',
			attempted: false,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'notStarted',
			attempted: false,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'preflightReady',
			attempted: false,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'recovered',
			attempted: true,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'failed',
			attempted: true,
			networkLikeFailure: true,
			available: true,
		},
	] as const satisfies readonly TailscaleRecoverAfterFailureResult[];

	for (const expected of recoveryVariants) {
		const event = tailscaleDiagnosticEvents.recoveryResult({
			source: 'tailscale-recovery',
			recoveryResult: withExtra(expected),
		});

		assert.deepEqual(event.recoveryResult, expected);
		assert.equal('extra' in event.recoveryResult, false);
	}
});
