import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
	diagnosticEvents,
	formatConnectionDiagnosticPrompt,
} from '../../src/lib/connection-diagnostics';

void test('connection diagnostics barrel exports public diagnostic helpers', () => {
	assert.equal(typeof createConnectionDiagnosticRecorder, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.startTrace, 'function');
	assert.equal(typeof diagnosticEvents.savedEntrySelected, 'function');
	assert.equal(typeof formatConnectionDiagnosticPrompt, 'function');
});
