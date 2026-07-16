import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const detailPath = join(process.cwd(), 'src/app/shell/detail.tsx');
const source = readFileSync(detailPath, 'utf8');
const viewPath = join(process.cwd(), 'src/app/shell/ShellScreenView.tsx');
const viewSource = readFileSync(viewPath, 'utf8');
const sourceFile = ts.createSourceFile(
	detailPath,
	source,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.TSX,
);
const viewSourceFile = ts.createSourceFile(
	viewPath,
	viewSource,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.TSX,
);

function variableInitializer(name: string): string {
	let initializer: ts.Expression | undefined;
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name
		) {
			initializer = node.initializer;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	assert.ok(initializer, `${name} initializer was not found`);
	return initializer.getText(sourceFile);
}

function xtermElement(): string {
	let element: ts.JsxSelfClosingElement | undefined;
	const visit = (node: ts.Node): void => {
		if (
			ts.isJsxSelfClosingElement(node) &&
			node.tagName.getText(viewSourceFile) === 'XtermJsWebView'
		) {
			element = node;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(viewSourceFile);
	assert.ok(element, 'XtermJsWebView element was not found');
	return element.getText(viewSourceFile);
}

void test('shell detail composes scrollback from semantic controller ports', () => {
	const call = variableInitializer('scrollback');
	for (const mapping of [
		/useShellScrollbackController\(\{/,
		/context:\s*\{/,
		/^\s*activity:\s*activityPort,\s*$/m,
		/^\s*targetKey,\s*$/m,
		/targetName:\s*normalizedTmuxTarget/,
		/connectionAvailable:\s*Boolean\(connection\)/,
		/shellAvailable:\s*terminalSource\.isAvailable\(\)/,
		/^\s*tmuxEnabled,\s*$/m,
		/terminalTransport:\s*terminal\.transport/,
		/runtimeInstanceId:\s*terminal\.runtimeInstanceId/,
		/terminalView:\s*terminal\.view/,
		/workmux:\s*ports\.workmux/,
		/^\s*trace:\s*terminalViewPolicy\.trace,\s*$/m,
		/^\s*getErrorMessage,\s*$/m,
		/^\s*logger,\s*$/m,
	]) {
		assert.match(call, mapping);
	}
});

void test('terminal publication and WebView delegate raw scrollback events', () => {
	assert.doesNotMatch(source, /scrollbackRuntimeChangedRef|onRuntimeChanged/);
	assert.doesNotMatch(source, /keyboardSelectionModeRef/);
	const xterm = xtermElement();
	assert.match(xterm, /\{\.\.\.terminal\.scrollback\.xtermProps\}/);
	assert.doesNotMatch(
		xterm,
		/onScrollbackModeChange=|onScrollbackEnterRequested=|onScrollbackBatch=/,
	);
	assert.match(viewSource, /terminal\.scrollback\.visible \? \(/);
	assert.match(viewSource, /onPress=\{terminal\.scrollback\.jumpToLive\}/);
});

void test('all shell input adapters use the scrollback input port', () => {
	const keyboardCall = variableInitializer('keyboard');
	assert.match(keyboardCall, /scrollbackInput:\s*scrollback\.input/);
	assert.match(keyboardCall, /terminalView:\s*terminal\.view/);
	const xterm = xtermElement();
	assert.match(xterm, /onInput=\{keyboard\.onWebViewInput\}/);
	assert.match(xterm, /onSelection=\{keyboard\.onSelectionChanged\}/);
	assert.match(
		xterm,
		/onSelectionModeChange=\{keyboard\.onSelectionModeChange\}/,
	);
	assert.doesNotMatch(
		`${source}\n${viewSource}`,
		/createShellTerminalLiveInputRequest|runWorkmuxScrollbackLiveInputSendPlan|terminal\.transport\.send|shell\.sendData|new OrderedWriter/,
	);
});

void test('keyboard core owns payload construction while detail owns no input policy', () => {
	const inputCore = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/keyboard-input-core.ts'),
		'utf8',
	);
	for (const delegated of [
		'buildClipboardPasteSegments',
		'buildCommanderExecuteSegments',
		'buildTextEntryPastePayload',
		'runCommandSteps',
	]) {
		assert.doesNotMatch(source, new RegExp(`\\b${delegated}\\b`));
		assert.match(inputCore, new RegExp(`\\b${delegated}\\b`));
	}
	assert.doesNotMatch(source, /\brunMacro\b/);
	assert.match(inputCore, /\brunMacroWithToken\b/);
	assert.doesNotMatch(source, /\bmodifierKeysActive\b/);
	assert.match(
		readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/keyboard.tsx'),
			'utf8',
		),
		/\bmodifierKeysActive\b/,
	);
	for (const legacy of [
		'workmuxScrollbackCommandExecutorRef',
		'scrollbackActiveRef',
		'scrollbackPhaseRef',
		'nextLocalScrollbackExitRequestIdRef',
		'scrollbackEnterRequestGenerationRef',
		'nextScrollTraceIdRef',
		'activeScrollTraceIdRef',
		'localScrollbackExitRequestIdsRef',
		'scrollbackCleanupBarrierRef',
		'tmuxRemoteScrollbackCopyModeActiveRef',
		'tmuxRemoteScrollbackCopyModeGenerationRef',
		'tmuxScrollbackLineAccumulatorRef',
		'currentInstanceIdRef',
		'liveInputGenerationRef',
		'workmuxScrollbackCommandExecutor',
		'handleScrollbackModeChange',
		'handleScrollbackEnterRequested',
		'handleScrollbackBatch',
		'clearScrollbackState',
		'resetTmuxScrollbackForUiReset',
	]) {
		assert.doesNotMatch(source, new RegExp(`\\b${legacy}\\b`));
	}
});

void test('terminal identity stays transport-only while scrollback receives target identity', () => {
	const terminalCall = variableInitializer('terminal');
	const scrollbackCall = variableInitializer('scrollback');
	assert.match(terminalCall, /useShellTerminalController\(\{/);
	assert.match(terminalCall, /source:\s*terminalSource/);
	assert.doesNotMatch(terminalCall, /targetKey|tmuxTarget/);
	assert.match(scrollbackCall, /^\s*targetKey,\s*$/m);
	assert.match(scrollbackCall, /targetName:\s*normalizedTmuxTarget/);
});
