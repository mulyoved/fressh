import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
	join(process.cwd(), 'src/app/shell/detail.tsx'),
	'utf8',
);

void test('shell detail delegates terminal refs and lifecycle', () => {
	assert.match(source, /useShellTerminalController\(\{/);
	assert.match(source, /ref=\{terminal\.xtermRef\}/);
	assert.match(source, /onLoadStart: terminal\.onLoadStart/);
	assert.match(source, /onResize=\{terminal\.onResize\}/);
	assert.match(source, /onInitialized=\{terminal\.onInitialized\}/);
	assert.match(source, /onRetry=\{terminal\.retry\}/);
	for (const legacy of [
		'listenerIdRef',
		'listenerOwnerRef',
		'attachedShellKeyRef',
		'hasAttachedOnceRef',
		'resizeTimeoutRef',
		'lastSizeRef',
		'terminalFitSizeWaitersRef',
		'writerRef',
	]) {
		assert.doesNotMatch(source, new RegExp(legacy));
	}
});

void test('shell detail composes the terminal with transport identity and raw runtime instance', () => {
	const runtimeCallbackStart = source.indexOf(
		'const handleTerminalRuntimeChanged = useCallback',
	);
	const terminalHookStart = source.indexOf(
		'const terminal = useShellTerminalController',
		runtimeCallbackStart,
	);
	assert.notEqual(runtimeCallbackStart, -1);
	assert.notEqual(terminalHookStart, -1);
	const runtimeCallback = source.slice(runtimeCallbackStart, terminalHookStart);
	const terminalHookEnd = source.indexOf(
		'const exitSelectionMode',
		terminalHookStart,
	);
	assert.notEqual(terminalHookEnd, -1);
	const terminalHook = source.slice(terminalHookStart, terminalHookEnd);

	assert.match(
		terminalHook,
		/useShellTerminalController\(\{[\s\S]*?shell,[\s\S]*?transportKey,[\s\S]*?platformOS: Platform\.OS,[\s\S]*?systemKeyboardEnabled,[\s\S]*?selectionModeEnabled,[\s\S]*?logger,[\s\S]*?router,[\s\S]*?onRuntimeChanged: handleTerminalRuntimeChanged,[\s\S]*?\}\)/,
	);
	assert.match(
		runtimeCallback,
		/\(_runtimeKey: TerminalRuntimeKey \| null, instanceId: string \| null\)/,
	);
	assert.match(runtimeCallback, /currentInstanceIdRef\.current = instanceId/);
	assert.match(runtimeCallback, /resetTmuxScrollbackLocalExitRequests\(/);
	assert.match(runtimeCallback, /void resetTmuxScrollbackForUiReset\(\)/);
	assert.doesNotMatch(runtimeCallback, /JSON\.parse|\.split\(/);
	assert.doesNotMatch(terminalHook, /targetKey|tmuxTarget/);
});

void test('shell detail consumes terminal size, view, and transport ports', () => {
	assert.match(source, /getTerminalSize: \(\) => terminal\.lastSize/);
	assert.match(source, /getXterm: \(\) => terminal\.view/);
	assert.match(
		source,
		/waitForTerminalSizeAfterFit: terminal\.waitForSizeAfterFit/,
	);
	assert.match(source, /terminal\.view\.fit\(\)/);
	assert.match(source, /terminal\.transport\.captureLease\(\)/);
	assert.match(
		source,
		/terminal\.transport\.sendBatch\([\s\S]*?interSegmentDelayMs/,
	);
	assert.match(source, /terminal\.transport\.isLeaseCurrent\(/);
	assert.doesNotMatch(source, /new OrderedWriter/);
	assert.doesNotMatch(source, /xtermRef\.current/);
});
