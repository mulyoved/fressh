import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const appRoot = process.cwd();
const autoConnectSourcePath = join(appRoot, 'src/lib/auto-connect.tsx');
const shellDetailSourcePath = join(appRoot, 'src/app/shell/detail.tsx');

void test('auto-connect manager records passive connection diagnostic traces', () => {
	const source = readFileSync(autoConnectSourcePath, 'utf8');

	assert.match(source, /connectionDiagnosticRecorder/);
	assert.match(source, /activeDiagnosticTraceRef/);
	assert.match(source, /createAutoConnectReconnectController\(/);
	assert.match(source, /attemptAutoConnectSource\(/);
	assert.match(source, /trace,\s*\n/);
	assert.match(source, /const ownsTrace = existingTrace === null/);
	assert.match(source, /reconnect\.start\.blocked/);
	assert.match(source, /reconnect\.stopped/);
});

void test('shell detail wires debug connection action to manual diagnostic runner', () => {
	const source = readFileSync(shellDetailSourcePath, 'utf8');

	assert.match(source, /runManualConnectionDiagnostic/);
	assert.match(source, /deliverConnectionDiagnosticPrompt/);
	assert.match(source, /connect:\s*RnRussh\.connect/);
	assert.match(
		source,
		/debugConnectionInCodex:\s*handleDebugConnectionInCodex/,
	);
	assert.match(source, /diagnosticMode:\s*true/);
});
