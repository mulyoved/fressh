import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectionDiagnosticRecorder,
	createConnectionDiagnosticRecorder,
	formatConnectionDiagnosticPrompt,
	savedEntryEvents,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticTraceHandle,
} from '../../src/lib/connection-diagnostics';

type ExpectedBarrelTypeExports = [
	ConnectionDiagnosticRecorder,
	ConnectionDiagnosticTraceHandle,
];

const assertBarrelTypeExports: ExpectedBarrelTypeExports | null = null;

void assertBarrelTypeExports;

void test('connection diagnostics barrel exports public diagnostic helpers', () => {
	assert.equal(typeof createConnectionDiagnosticRecorder, 'function');
	assert.equal(typeof connectionDiagnosticRecorder.startTrace, 'function');
	assert.equal(typeof savedEntryEvents.selected, 'function');
	assert.equal(typeof formatConnectionDiagnosticPrompt, 'function');
});
