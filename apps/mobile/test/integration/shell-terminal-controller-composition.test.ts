import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
	join(process.cwd(), 'src/app/shell/detail.tsx'),
	'utf8',
);

function extractBalancedCall(callee: string, from = 0): string {
	const callStart = source.indexOf(`${callee}(`, from);
	assert.notEqual(callStart, -1);
	const open = source.indexOf('(', callStart);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === '(') depth += 1;
		if (source[index] === ')') {
			depth -= 1;
			if (depth === 0) return source.slice(callStart, index + 1);
		}
	}
	assert.fail(`${callee} call was not closed`);
}

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
	const terminalCall = extractBalancedCall(
		'useShellTerminalController',
		terminalHookStart,
	);

	for (const property of [
		/\bshell,/,
		/\btransportKey,/,
		/platformOS: Platform\.OS/,
		/systemKeyboardEnabled: Platform\.OS === 'android'/,
		/selectionModeEnabled: false/,
		/\blogger,/,
		/\brouter,/,
		/onRuntimeChanged: handleTerminalRuntimeChanged/,
	]) {
		assert.match(terminalCall, property);
	}
	assert.match(
		runtimeCallback,
		/\(runtimeKey: TerminalRuntimeKey \| null, instanceId: string \| null\)/,
	);
	assert.match(
		runtimeCallback,
		/scrollbackRuntimeChangedRef\.current\(instanceId\)/,
	);
	assert.doesNotMatch(runtimeCallback, /commandTimeoutsRef/);
	assert.doesNotMatch(runtimeCallback, /JSON\.parse|\.split\(/);
	assert.doesNotMatch(terminalCall, /targetKey|tmuxTarget/);
});

void test('shell detail consumes terminal size, view, and transport ports', () => {
	const manualFitStart = source.indexOf('const manualTerminalFitRunner');
	const manualFitEnd = source.indexOf(
		'const featureRequest = useFeatureRequestController',
		manualFitStart,
	);
	assert.notEqual(manualFitStart, -1);
	assert.notEqual(manualFitEnd, -1);
	const manualFit = source.slice(manualFitStart, manualFitEnd);
	assert.match(source, /terminalSizeSnapshotRef\.current = terminal\.lastSize/);
	assert.match(
		manualFit,
		/getTerminalSize: \(\) => terminalSizeSnapshotRef\.current/,
	);
	assert.match(source, /getXterm: \(\) => terminal\.view/);
	assert.match(
		source,
		/waitForTerminalSizeAfterFit: terminal\.waitForSizeAfterFit/,
	);
	assert.match(source, /terminal\.view\.fit\(\)/);
	const scrollbackAdapter = extractBalancedCall('useShellScrollbackController');
	assert.match(scrollbackAdapter, /terminalTransport: terminal\.transport/);
	assert.match(scrollbackAdapter, /terminalView: terminal\.view/);
	const keyboardCall = extractBalancedCall(
		'createShellDetailKeyboardControllerInput',
	);
	assert.match(keyboardCall, /scrollbackInput: scrollback\.input/);
	assert.match(keyboardCall, /terminalView: terminal\.view/);
	assert.doesNotMatch(
		source,
		/createShellTerminalLiveInputRequest|runWorkmuxScrollbackLiveInputSendPlan/,
	);
	assert.match(
		manualFit,
		/terminal\.view,[\s\S]*terminal\.waitForSizeAfterFit/,
	);
	assert.doesNotMatch(manualFit, /^\s*terminal,\s*$/m);
	assert.doesNotMatch(source, /new OrderedWriter/);
	assert.doesNotMatch(source, /xtermRef\.current/);
});

void test('shell detail retains terminal rendering through the controller snapshot', () => {
	assert.match(
		source,
		/terminal\.hasRendered \|\| Boolean\(shell && connection\)/,
	);
	assert.doesNotMatch(source, /terminalReady|hasRenderedTerminal/);
});
