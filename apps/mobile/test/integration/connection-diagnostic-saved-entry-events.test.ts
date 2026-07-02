import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticEventKinds,
	savedEntryEvents,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('saved-entry events copy identity and expose typed kinds', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} as never;
	const selected = savedEntryEvents.selected({
		source: 'saved-entry',
		connection,
	});
	const keyMissing = savedEntryEvents.keyMissing({
		source: 'manual-diagnostic',
		connection,
	});
	const missing = savedEntryEvents.missing({
		source: 'saved-entry',
		message: 'No saved entry',
	});

	const events: ConnectionDiagnosticEvent[] = [selected, keyMissing, missing];
	assert.deepEqual(
		events.map((event) => event.kind),
		['saved-entry.selected', 'key.missing', 'saved-entry.missing'],
	);
	assert.equal('privateKey' in selected.connection, false);
	assert.equal('password' in selected.connection, false);
	assert.ok(connectionDiagnosticEventKinds.includes('saved-entry.selected'));
});

void test('saved-entry key resolved and invalid tmux events copy safe payloads', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} as never;
	const keyResolved = savedEntryEvents.keyResolved({
		source: 'manual-diagnostic',
		connection,
	});
	const invalidTmuxSettings = savedEntryEvents.invalidTmuxSettings({
		source: 'saved-entry',
		connection,
		useTmuxType: 'string',
		tmuxSessionNameType: 'number',
	});

	assert.equal(keyResolved.kind, 'key.resolved');
	assert.equal(keyResolved.source, 'manual-diagnostic');
	assert.equal('privateKey' in keyResolved.connection, false);
	assert.equal('password' in keyResolved.connection, false);
	assert.deepEqual(keyResolved.connection, {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
	});

	assert.equal(invalidTmuxSettings.kind, 'saved-entry.invalid-tmux-settings');
	assert.equal(invalidTmuxSettings.source, 'saved-entry');
	assert.equal('privateKey' in invalidTmuxSettings.connection, false);
	assert.equal('password' in invalidTmuxSettings.connection, false);
	assert.deepEqual(invalidTmuxSettings.connection, {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.equal(invalidTmuxSettings.useTmuxType, 'string');
	assert.equal(invalidTmuxSettings.tmuxSessionNameType, 'number');
});
