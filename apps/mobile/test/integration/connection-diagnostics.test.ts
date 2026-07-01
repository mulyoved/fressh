import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
	savedEntryEvents,
	type ActiveConnectionEvent,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTraceHandle,
	type SavedEntryConnectEvent,
} from '../../src/lib/connection-diagnostics';

type ExpectedBarrelTypeExports = [
	ConnectionDiagnosticRecorder,
	ConnectionDiagnosticTraceHandle,
	Extract<ActiveConnectionEvent, { kind: 'auto-connect.latest-shell.selected' }>,
	Extract<
		SavedEntryConnectEvent,
		{ kind: 'auto-connect.saved-entry.connect.started' }
	>,
];

const assertBarrelTypeExports: ExpectedBarrelTypeExports | null = null;

void assertBarrelTypeExports;

void test('connection diagnostics barrel exports public diagnostic helpers', () => {
	assert.equal(typeof createConnectionDiagnosticRecorder, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.startTrace, 'function');
	assert.equal(typeof savedEntryEvents.selected, 'function');
	assert.equal(typeof formatConnectionDiagnosticPrompt, 'function');
});
