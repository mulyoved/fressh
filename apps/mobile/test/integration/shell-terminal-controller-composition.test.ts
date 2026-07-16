import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const readSource = (path: string) =>
	readFileSync(join(process.cwd(), path), 'utf8');

const detail = readSource('src/app/shell/detail.tsx');
const view = readSource('src/app/shell/ShellScreenView.tsx');
const terminal = readSource('src/lib/shell-controllers/terminal.tsx');

void test('shell detail delegates terminal refs and lifecycle', () => {
	assert.match(detail, /useShellTerminalController\(\{/);
	assert.match(detail, /xtermRef: terminal\.xtermRef/);
	assert.match(detail, /onLoadStart: terminal\.onLoadStart/);
	assert.match(view, /ref=\{terminal\.xtermRef\}/);
	assert.match(view, /onLoadStart: terminal\.onLoadStart/);
	assert.match(view, /onResize=\{terminal\.onResize\}/);
	assert.match(view, /onInitialized=\{terminal\.onInitialized\}/);
	assert.match(view, /onRetry=\{terminal\.retry\}/);
	assert.doesNotMatch(
		detail,
		/listenerIdRef|listenerOwnerRef|attachedShellKeyRef|hasAttachedOnceRef|writerRef/,
	);
});

void test('shell detail supplies only the typed terminal source and runtime dependencies', () => {
	assert.match(detail, /const terminalSource = ports\.terminalSource/);
	assert.match(
		detail,
		/useShellTerminalController\(\{\s*source: terminalSource,\s*platformOS: Platform\.OS,\s*systemKeyboardEnabled: Platform\.OS === 'android',\s*logger,\s*router,\s*\}\)/,
	);
	assert.doesNotMatch(detail, /useShellTerminalController\(\{[\s\S]*?\bshell,/);
	assert.match(terminal, /source: ShellTerminalSourcePort/);
	assert.match(terminal, /runtime\.updateSource\(source\)/);
});

void test('scrollback, keyboard, and manual fit consume terminal ports', () => {
	assert.match(
		detail,
		/useShellScrollbackController\(\{[\s\S]*?terminalTransport: terminal\.transport,[\s\S]*?terminalView: terminal\.view,/,
	);
	assert.match(
		detail,
		/useShellKeyboardController\(\{[\s\S]*?scrollbackInput: scrollback\.input,[\s\S]*?terminalView: terminal\.view,/,
	);
	assert.match(
		detail,
		/useManualTerminalFit\(\{[\s\S]*?terminalSource,[\s\S]*?terminal,/,
	);
	assert.doesNotMatch(detail, /new OrderedWriter|xtermRef\.current/);
});

void test('waiting rendering is retained through the terminal controller snapshot', () => {
	assert.match(
		detail,
		/buildShellSessionView\(\s*snapshot,\s*terminal\.hasRendered,/,
	);
	assert.match(
		view,
		/session\.status === 'waiting' && !session\.terminalHasRendered/,
	);
	assert.doesNotMatch(detail, /terminalReady|hasRenderedTerminal/);
});
