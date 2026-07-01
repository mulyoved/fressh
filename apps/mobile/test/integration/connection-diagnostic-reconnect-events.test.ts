import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
