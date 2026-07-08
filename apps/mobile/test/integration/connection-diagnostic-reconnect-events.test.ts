import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatReconnectEventFields,
	reconnectEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('reconnect events keep reconnect-specific timing fields', () => {
	const started = reconnectEvents.started({
		source: 'reconnect-controller',
		reason: 'network-lost',
		windowMs: 30_000,
	});
	const timeout = reconnectEvents.timeout({
		source: 'reconnect-controller',
		reconnectElapsedMs: 30_000,
		windowMs: 30_000,
	});
	const events: ConnectionDiagnosticEvent[] = [started, timeout];

	assert.deepEqual(
		events.map((event) => event.kind),
		['reconnect.started', 'reconnect.timeout'],
	);
	assert.equal(timeout.reconnectElapsedMs, 30_000);
	assert.equal(timeout.windowMs, 30_000);
});

void test('reconnect diagnostic events include shell drop, transport invalidation, completion, stale input, and UI transition', () => {
	const shellDropped = reconnectEvents.shellDropped({
		source: 'reconnect',
		connectionId: 'conn-1',
		channelId: 7,
		networkDisappeared: true,
		message: 'shell dropped',
	});
	const invalidated = reconnectEvents.transportInvalidated({
		source: 'reconnect',
		connectionId: 'conn-1',
		channelId: 7,
		hadShell: true,
		bridgeDisposed: true,
		bridgeRequestInFlight: true,
		message: 'disposed stale transport',
	});
	const completed = reconnectEvents.completed({
		source: 'reconnect-controller',
		outcome: 'needsAttention',
		destination: 'hostPage',
		message: 'Tailscale recovery failed',
	});
	const staleInput = reconnectEvents.staleInput({
		source: 'reconnect',
		connectionId: 'conn-1',
		channelId: 7,
		message: 'input arrived without shell',
	});
	const uiTransition = reconnectEvents.uiTransition({
		source: 'reconnect',
		from: 'terminalOverlay',
		to: 'hostPage',
		message: 'routing to host page',
	});

	assert.equal(shellDropped.kind, 'reconnect.shell-dropped');
	assert.equal(invalidated.kind, 'reconnect.transport.invalidated');
	assert.equal(completed.destination, 'hostPage');
	assert.equal(staleInput.kind, 'reconnect.stale-input');
	assert.deepEqual(formatReconnectEventFields(shellDropped), [
		'connectionId=conn-1',
		'channelId=7',
		'networkDisappeared=true',
	]);
	assert.deepEqual(formatReconnectEventFields(invalidated), [
		'connectionId=conn-1',
		'channelId=7',
		'hadShell=true',
		'bridgeDisposed=true',
		'bridgeRequestInFlight=true',
	]);
	assert.deepEqual(formatReconnectEventFields(completed), [
		'outcome=needsAttention',
		'destination=hostPage',
	]);
	assert.deepEqual(formatReconnectEventFields(staleInput), [
		'connectionId=conn-1',
		'channelId=7',
	]);
	assert.deepEqual(formatReconnectEventFields(uiTransition), [
		'from=terminalOverlay',
		'to=hostPage',
	]);
});
