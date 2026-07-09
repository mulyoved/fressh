import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatConnectionDiagnosticEventFields,
	networkDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('network preflight diagnostic event copies and formats snapshot fields', () => {
	const event = networkDiagnosticEvents.preflightChecked({
		source: 'network-preflight',
		snapshot: {
			connected: false,
			internetCapable: false,
			validated: false,
			wifiConnected: false,
			transports: [],
		},
		usable: false,
		message: 'No network connection. Connect Wi-Fi, then retry.',
	});
	const events: ConnectionDiagnosticEvent[] = [event];

	assert.deepEqual(
		events.map((item) => item.kind),
		['network.preflight.checked'],
	);
	assert.deepEqual(formatConnectionDiagnosticEventFields(event), [
		'connected=false',
		'internetCapable=false',
		'validated=false',
		'wifiConnected=false',
		'transports=none',
		'usable=false',
	]);
});
