import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	sshEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('ssh events snapshot connection and error fields', () => {
	const failed = sshEvents.connectFailed({
		source: 'saved-entry',
		connection: {
			connectionId: 'conn-1',
			host: 'dev.tailnet.ts.net',
			privateKey: 'must-not-copy',
		} as never,
		error: { name: 'Error', message: 'connect failed', secret: 'no' } as never,
	});
	const connected = sshEvents.shellConnected({
		source: 'active-connection',
		connection: { connectionId: 'conn-1' },
		channelId: 7,
		storedConnectionId: 'stored-1',
	});
	const events: ConnectionDiagnosticEvent[] = [failed, connected];

	assert.deepEqual(
		events.map((event) => event.kind),
		['ssh.connect.failed', 'ssh.shell.connected'],
	);
	assert.equal('privateKey' in failed.connection, false);
	assert.equal('secret' in failed.error, false);
	assert.ok(connectionDiagnosticEventKinds.includes('ssh.shell.connected'));
});
