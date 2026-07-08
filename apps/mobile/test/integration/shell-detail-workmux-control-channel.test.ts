import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const detailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');

function extractCreateWorkmuxControlChannelBlock(source: string): string {
	const callStart = source.indexOf('createWorkmuxControlChannel({');
	assert.notEqual(callStart, -1);

	let depth = 0;
	for (let index = callStart; index < source.length; index += 1) {
		const char = source[index];
		if (char === '(' || char === '{') depth += 1;
		if (char === ')' || char === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(callStart, index + 1);
		}
	}

	assert.fail('createWorkmuxControlChannel block was not closed');
}

function extractWorkmuxControlChannelMemoBlock(source: string): string {
	const memoStart = source.indexOf('const workmuxControlChannel = useMemo');
	assert.notEqual(memoStart, -1);
	const memoEnd = source.indexOf('const workmuxControlChannelRef', memoStart);
	assert.notEqual(memoEnd, -1);
	return source.slice(memoStart, memoEnd);
}

function extractAgentNotificationRouteEffectBlock(source: string): string {
	const effectStart = source.indexOf('void handleAgentNotificationRoute({');
	assert.notEqual(effectStart, -1);
	const effectEnd = source.indexOf(
		'const acknowledgeVisibleAgentNotification',
		effectStart,
	);
	assert.notEqual(effectEnd, -1);
	return source.slice(effectStart, effectEnd);
}

function extractRunBrowserActionsWorkmuxCommandBlock(source: string): string {
	const callbackStart = source.indexOf(
		'const runBrowserActionsWorkmuxCommand = useCallback',
	);
	assert.notEqual(callbackStart, -1);
	const callbackEnd = source.indexOf(
		'const browserActions = useBrowserActionsController',
		callbackStart,
	);
	assert.notEqual(callbackEnd, -1);
	return source.slice(callbackStart, callbackEnd);
}

function extractHandleRestartCodexBlock(source: string): string {
	const callbackStart = source.indexOf(
		'const handleRestartCodex = useCallback',
	);
	assert.notEqual(callbackStart, -1);
	const callbackEnd = source.indexOf(
		'const actionContext = useMemo',
		callbackStart,
	);
	assert.notEqual(callbackEnd, -1);
	return source.slice(callbackStart, callbackEnd);
}

function extractActionContextBlock(source: string): string {
	const contextStart = source.indexOf('const actionContext = useMemo');
	assert.notEqual(contextStart, -1);
	const contextEnd = source.indexOf(
		'const handleAction = useCallback',
		contextStart,
	);
	assert.notEqual(contextEnd, -1);
	return source.slice(contextStart, contextEnd);
}

function extractHandleCommandBridgeEntryBlock(source: string): string {
	const callbackStart = source.indexOf(
		'const handleCommandBridgeEntry = useCallback',
	);
	assert.notEqual(callbackStart, -1);
	const callbackEnd = source.indexOf(
		'const handleAction = useCallback',
		callbackStart,
	);
	assert.notEqual(callbackEnd, -1);
	return source.slice(callbackStart, callbackEnd);
}

function extractHandleActionBlock(source: string): string {
	const callbackStart = source.indexOf('const handleAction = useCallback');
	assert.notEqual(callbackStart, -1);
	const callbackEnd = source.indexOf(
		'const handleSlotPress = useCallback',
		callbackStart,
	);
	assert.notEqual(callbackEnd, -1);
	return source.slice(callbackStart, callbackEnd);
}

function extractHandleSlotPressBlock(source: string): string {
	const callbackStart = source.indexOf('const handleSlotPress = useCallback');
	assert.notEqual(callbackStart, -1);
	const callbackEnd = source.indexOf(
		'// Debounced PTY resize handler',
		callbackStart,
	);
	assert.notEqual(callbackEnd, -1);
	return source.slice(callbackStart, callbackEnd);
}

void describe('shell detail Workmux control channel wiring', () => {
	void test('routes shell scrollback through WorkmuxControlChannel instead of one-shot mdev scroll commands', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(source, /createWorkmuxControlChannel/);
		assert.doesNotMatch(source, /executeWorkmuxScrollbackRemoteCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollEnterCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollExitCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollLineCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollPageCommand/);
	});

	void test('cleans up scrollback executor before disposing the control channel', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const executorCleanupIndex = source.indexOf(
			'const cleanup = disposeTmuxScrollbackRuntimeStateForUiReset',
		);
		const sequencedDisposeIndex = source.indexOf(
			'disposeWorkmuxControlChannelAfterCleanup',
			executorCleanupIndex,
		);

		assert.notEqual(executorCleanupIndex, -1);
		assert.notEqual(sequencedDisposeIndex, -1);
		assert.ok(executorCleanupIndex < sequencedDisposeIndex);
		assert.doesNotMatch(
			source,
			/void workmuxControlChannel\.dispose\(\)\.catch/,
		);
	});

	void test('disables local xterm scrollback when touch scroll is routed through Workmux', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(
			source,
			/import \{ resolveShellTouchScrollPolicy \} from '\.\/shell-touch-scroll'/,
		);
		assert.match(source, /const remoteTouchScrollPolicy\s*=\s*useMemo/);
		assert.match(source, /resolveShellTouchScrollPolicy\(\{/);
		assert.match(
			source,
			/scrollback:\s*remoteTouchScrollPolicy\.xtermScrollback/,
		);
		assert.match(
			source,
			/touchScrollConfig=\{remoteTouchScrollPolicy\.touchScrollConfig\}/,
		);
		assert.doesNotMatch(source, /\btouchScrollEnabled\b/);
		assert.doesNotMatch(source, /const remoteTouchScrollOwnsViewport\s*=/);
		assert.doesNotMatch(source, /Math\.min\(width,\s*height\)\s*>=\s*600/);
	});

	void test('enables WebView scroll telemetry when scroll tracing is enabled', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(
			source,
			/import \{[^}]*configureScrollTraceEnabled[^}]*isScrollTraceEnabled[^}]*\} from '@\/lib\/scroll-trace'/s,
		);
		assert.match(
			source,
			/const scrollTraceEnabled\s*=\s*isConfiguredScrollTraceEnabled\(\)/,
		);
		assert.match(source, /configureScrollTraceEnabled\(scrollTraceEnabled\)/);
		assert.match(source, /scrollTraceEnabled,\s*debug:\s*__DEV__/);
		assert.doesNotMatch(source, /debugTelemetry:\s*__DEV__/);
	});

	void test('captures reconnect disposal reason before deferred channel cleanup', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const cleanupIndex = source.indexOf(
			'const cleanup = disposeTmuxScrollbackRuntimeStateForUiReset',
		);
		const disposeReasonIndex = source.indexOf(
			'const disposeReason = useAutoConnectStore.getState().isReconnecting',
			cleanupIndex,
		);
		const deferredDisposeIndex = source.indexOf(
			'disposeWorkmuxControlChannelAfterCleanup',
			cleanupIndex,
		);
		const deferredBlock = source.slice(
			deferredDisposeIndex,
			source.indexOf('onDisposeError', deferredDisposeIndex),
		);

		assert.notEqual(cleanupIndex, -1);
		assert.notEqual(disposeReasonIndex, -1);
		assert.notEqual(deferredDisposeIndex, -1);
		assert.ok(disposeReasonIndex < deferredDisposeIndex);
		assert.match(deferredBlock, /reason:\s*disposeReason/);
		assert.doesNotMatch(
			deferredBlock,
			/useAutoConnectStore\.getState\(\)\.isReconnecting/,
		);
	});

	void test('passes only the connection into WorkmuxControlChannel for Workmux control commands', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractCreateWorkmuxControlChannelBlock(source);

		assert.match(block, /connection:\s*connection\s*\?\?\s*null/);
		assert.doesNotMatch(block, /runRemoteCommand/);
		assert.doesNotMatch(block, /executeRemoteCommand/);
	});

	void test('keeps WorkmuxControlChannel memo scoped to tmux target cleanup lifecycle', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractWorkmuxControlChannelMemoBlock(source);

		assert.match(block, /\[\s*connection\s*,\s*normalizedTmuxTarget\s*\]/);
	});

	void test('retries routed agent notifications when the Workmux command channel changes', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const callbackBlock = extractRunBrowserActionsWorkmuxCommandBlock(source);
		const effectBlock = extractAgentNotificationRouteEffectBlock(source);

		assert.match(callbackBlock, /workmuxControlChannel\.command/);
		assert.match(callbackBlock, /\[\s*workmuxControlChannel\s*\]/);
		assert.match(
			effectBlock,
			/\[\s*agentConnectionId[\s\S]*runBrowserActionsWorkmuxCommand[\s\S]*\]/,
		);
	});

	void test('wires bridge-backed Codex restart through WorkmuxControlChannel operation', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractHandleRestartCodexBlock(source);
		const actionContextBlock = extractActionContextBlock(source);

		assert.match(
			source,
			/import \{ restartCodexWithBridge \} from '@\/lib\/codex-restart'/,
		);
		assert.match(actionContextBlock, /restartCodex:\s*handleRestartCodex/);
		assert.match(block, /restartCodexWithBridge\(\{/);
		assert.match(
			block,
			/const workmuxControlChannelSnapshot\s*=\s*workmuxControlChannelRef\.current/,
		);
		assert.match(block, /workmuxControlChannelSnapshot\.command/);
		assert.match(block, /workmuxControlChannelSnapshot\.operation/);
		assert.doesNotMatch(
			block,
			/workmuxControlChannelRef\.current\.(?:command|operation)/,
		);
		assert.doesNotMatch(
			block,
			/sendBytesRaw|pasteClipboard|runCommandPreset|TextEncoder|sendTextRaw|sendCommandStep/,
		);
		assert.doesNotMatch(block, /mdev codex restart/);
	});

	void test('guards Codex restart against duplicate and stale UI requests', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractHandleRestartCodexBlock(source);

		assert.match(
			source,
			/const invalidateCodexRestartRequests\s*=\s*useCallback/,
		);
		assert.match(source, /codexRestartGenerationRef\.current \+= 1/);
		assert.match(block, /if \(codexRestartInFlightRef\.current\) return/);
		assert.match(block, /codexRestartInFlightRef\.current = true/);
		assert.match(
			block,
			/finally\s*\{\s*codexRestartInFlightRef\.current = false;\s*\}/,
		);
		assert.match(block, /const isCurrentRestart\s*=\s*\(\) =>/);
		assert.match(block, /Codex restart superseded/);
		assert.match(block, /Codex restart failed after becoming stale/);
		assert.match(source, /invalidateCodexRestartRequests\(\);/);
		const invalidationBlock = source.slice(
			source.indexOf('const invalidateCodexRestartRequests = useCallback'),
			source.indexOf('const exitSelectionMode = useCallback'),
		);
		assert.doesNotMatch(
			invalidationBlock,
			/codexRestartInFlightRef\.current = false/,
		);
	});

	void test('delegates connection debug command wiring to hook', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(
			source,
			/import \{ useConnectionDebugCommand \} from '@\/lib\/use-connection-debug-command'/,
		);
		assert.match(
			source,
			/const debugConnectionInCodex = useConnectionDebugCommand\(\{/,
		);
		assert.match(source, /allowTerminalPaste: false,/);
		assert.match(source, /debugConnectionInCodex,\s*$/m);
		assert.doesNotMatch(source, /runConnectionDebugCommand\(\{/);
		assert.doesNotMatch(source, /loadLatestSavedConnectionForDiagnostic/);
	});

	void test('passes bridge handler into CommandMenuModal', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractHandleCommandBridgeEntryBlock(source);

		assert.match(source, /const handleCommandBridgeEntry\s*=\s*useCallback/);
		assert.match(block, /case 'codex\.restart':/);
		assert.match(
			block,
			/void handleRestartCodex\(\{ timeoutMs: entry\.timeoutMs \}\)/,
		);
		assert.match(block, /logger\.warn\('Unhandled command bridge operation'/);
		assert.match(source, /onBridge=\{handleCommandBridgeEntry\}/);
	});

	void test('routes action slot presses through action run options helper', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const actionBlock = extractHandleActionBlock(source);
		const block = extractHandleSlotPressBlock(source);

		assert.match(
			source,
			/import \{ runKeyboardActionSlot \} from '@\/lib\/keyboard-action-run-options'/,
		);
		assert.match(
			actionBlock,
			/\(actionId: ActionId, options\?: RunActionOptions\)/,
		);
		assert.match(actionBlock, /runAction\(actionId, actionContext, options\)/);
		assert.match(
			block,
			/case 'action':\s*runKeyboardActionSlot\(slot, handleAction\);/,
		);
	});
});
