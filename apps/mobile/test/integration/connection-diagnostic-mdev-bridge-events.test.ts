import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	formatConnectionDiagnosticEventFields,
	formatMdevBridgeEventFields,
	isMdevBridgeCloseClass,
	mdevBridgeCloseClasses,
	mdevBridgeDiagnosticEvents,
} from '../../src/lib/connection-diagnostics/events';

void test('mdev bridge lifecycle event records classified stream closure', () => {
	const event = mdevBridgeDiagnosticEvents.lifecycle({
		source: 'mdev-bridge',
		stage: 'stream-closed',
		operation: 'workmux.nav',
		requestId: 'mdev-bridge-4',
		helloComplete: true,
		bridgeRequestInFlight: true,
		closeClass: 'disposedByReconnect',
		message: 'bridge disposed during reconnect',
	});

	assert.deepEqual(event, {
		kind: 'mdev-bridge.lifecycle',
		source: 'mdev-bridge',
		message: 'bridge disposed during reconnect',
		stage: 'stream-closed',
		operation: 'workmux.nav',
		requestId: 'mdev-bridge-4',
		helloComplete: true,
		bridgeRequestInFlight: true,
		closeClass: 'disposedByReconnect',
	});
	assert.deepEqual(formatMdevBridgeEventFields(event), [
		'stage=stream-closed',
		'operation=workmux.nav',
		'requestId=mdev-bridge-4',
		'helloComplete=true',
		'bridgeRequestInFlight=true',
		'closeClass=disposedByReconnect',
	]);
	assert.ok(connectionDiagnosticEventKinds.includes('mdev-bridge.lifecycle'));
	assert.deepEqual(formatConnectionDiagnosticEventFields(event), [
		'stage=stream-closed',
		'operation=workmux.nav',
		'requestId=mdev-bridge-4',
		'helloComplete=true',
		'bridgeRequestInFlight=true',
		'closeClass=disposedByReconnect',
	]);
});

void test('mdev bridge close class guard accepts only known lifecycle classes', () => {
	assert.deepEqual(
		mdevBridgeCloseClasses.map((closeClass) =>
			isMdevBridgeCloseClass(closeClass),
		),
		mdevBridgeCloseClasses.map(() => true),
	);
	assert.equal(isMdevBridgeCloseClass('bogus'), false);
	assert.equal(isMdevBridgeCloseClass(''), false);
	assert.equal(isMdevBridgeCloseClass(null), false);
});
