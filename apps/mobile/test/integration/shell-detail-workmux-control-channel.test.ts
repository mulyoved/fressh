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
	const memoEnd = source.indexOf('const [keyboardLateBindings]', memoStart);
	assert.notEqual(memoEnd, -1);
	return source.slice(memoStart, memoEnd);
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

	void test('delegates scrollback cleanup while retaining control-channel disposal', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const controllerIndex = source.indexOf(
			'const scrollback = useShellScrollbackController',
		);
		const sequencedDisposeIndex = source.indexOf(
			'disposeWorkmuxControlChannelAfterCleanup',
			controllerIndex,
		);

		assert.notEqual(controllerIndex, -1);
		assert.notEqual(sequencedDisposeIndex, -1);
		assert.ok(controllerIndex < sequencedDisposeIndex);
		const compositionEnd = source.indexOf(
			'scrollbackRuntimeChangedRef.current',
			controllerIndex,
		);
		assert.notEqual(compositionEnd, -1);
		const composition = source.slice(controllerIndex, compositionEnd);
		assert.match(composition, /onTeardownCleanup:\s*\(cleanup\)\s*=>\s*\{/);
		assert.match(
			composition,
			/disposeWorkmuxControlChannelAfterCleanup\(\{[\s\S]*?^\s*cleanup,/m,
		);
		assert.match(
			composition,
			/onCleanupError:\s*\(error\)\s*=>\s*reportShellScrollbackChannelCleanupError\(\{/,
		);
		assert.match(
			composition,
			/reportShellScrollbackChannelCleanupError\(\{[\s\S]*?^\s*logger,/m,
		);
		assert.equal(
			composition.match(/onCleanupError:/g)?.length,
			1,
			'cleanup timeout/error observer must be mapped exactly once',
		);
		assert.doesNotMatch(
			source.slice(compositionEnd),
			/disposeWorkmuxControlChannelAfterCleanup/,
		);
		assert.doesNotMatch(
			source,
			/disposeTmuxScrollbackRuntimeStateForUiReset|createWorkmuxScrollbackCommandExecutor/,
		);
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
		const controllerIndex = source.indexOf(
			'const scrollback = useShellScrollbackController',
		);
		const disposeReasonIndex = source.indexOf(
			'const disposeReason = useAutoConnectStore.getState().isReconnecting',
			controllerIndex,
		);
		const deferredDisposeIndex = source.indexOf(
			'disposeWorkmuxControlChannelAfterCleanup',
			controllerIndex,
		);
		const deferredBlock = source.slice(
			deferredDisposeIndex,
			source.indexOf('onDisposeError', deferredDisposeIndex),
		);

		assert.notEqual(controllerIndex, -1);
		assert.notEqual(disposeReasonIndex, -1);
		assert.notEqual(deferredDisposeIndex, -1);
		assert.ok(disposeReasonIndex < deferredDisposeIndex);
		assert.match(deferredBlock, /prepareDispose:\s*\(\)\s*=>/);
		assert.match(deferredBlock, /workmuxControlChannel\.prepareDispose\(\{/);
		assert.match(deferredBlock, /reason:\s*disposeReason/);
		assert.doesNotMatch(
			deferredBlock,
			/useAutoConnectStore\.getState\(\)\.isReconnecting/,
		);
	});

	void test('wires active diagnostic trace into production WorkmuxControlChannel', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const memoBlock = extractWorkmuxControlChannelMemoBlock(source);

		assert.match(source, /activeDiagnosticTraceRef\.current\?\.event\(event\)/);
		assert.match(memoBlock, /trace:\s*workmuxDiagnosticTrace/);
		assert.match(
			memoBlock,
			/\[\s*connection\s*,\s*normalizedTmuxTarget\s*,\s*workmuxDiagnosticTrace\s*\]/,
		);
	});

	void test('routes Workmux transport failures into shell transport invalidation', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const remoteCore = readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/keyboard-remote-core.ts'),
			'utf8',
		);

		assert.match(source, /import \{ useSshStore \} from '@\/lib\/ssh-store'/);
		assert.match(source, /invalidateShellTransport:\s*\(\s*nextConnectionId/);
		assert.match(
			source,
			/invalidateShellTransport\(nextConnectionId, nextChannelId\)/,
		);
		assert.match(remoteCore, /onTransportUnhealthy:\s*\(\)\s*=>/);
		assert.match(remoteCore, /invalidateShellTransport\(/);
	});

	void test('passes only the connection into WorkmuxControlChannel for Workmux control commands', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractCreateWorkmuxControlChannelBlock(source);

		assert.match(block, /connection:\s*connection\s*\?\?\s*null/);
		assert.match(block, /trace:\s*workmuxDiagnosticTrace/);
		assert.doesNotMatch(block, /runRemoteCommand/);
		assert.doesNotMatch(block, /executeRemoteCommand/);
	});

	void test('keeps WorkmuxControlChannel memo scoped to tmux target cleanup lifecycle', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractWorkmuxControlChannelMemoBlock(source);

		assert.match(
			block,
			/\[\s*connection\s*,\s*normalizedTmuxTarget\s*,\s*workmuxDiagnosticTrace\s*\]/,
		);
	});

	void test('keys routed agent notifications by the Workmux control channel', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const notificationSource = readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/notifications.tsx'),
			'utf8',
		);
		const callbackBlock = extractRunBrowserActionsWorkmuxCommandBlock(source);

		assert.match(callbackBlock, /workmuxControlChannel\.command/);
		assert.match(callbackBlock, /\[\s*workmuxControlChannel\s*\]/);
		assert.match(
			callbackBlock,
			/const runNotificationWorkmuxCommand = useCallback\([\s\S]*\[runBrowserActionsWorkmuxCommand\]/,
		);
		assert.match(
			notificationSource,
			/\[core, hookOrchestrator, routeEffectKey, commandPortKey\]/,
		);
		assert.match(source, /commandPortKey:\s*workmuxControlChannel/);
	});

	void test('keeps the focused browser controller on the shared Workmux command channel', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const callbackBlock = extractRunBrowserActionsWorkmuxCommandBlock(source);

		assert.match(
			source,
			/import \{ useBrowserActionsController \} from '@\/lib\/shell-controllers\/browser-actions'/,
		);
		assert.match(callbackBlock, /workmuxControlChannel\.command/);
		assert.match(
			source,
			/runWorkmuxCommand:\s*runBrowserActionsWorkmuxCommand/,
		);
	});

	void test('wires bridge-backed Codex restart through WorkmuxControlChannel operation', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const remoteCore = readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/keyboard-remote-core.ts'),
			'utf8',
		);

		assert.match(source, /^\s*workmuxControlChannel,\s*$/m);
		assert.match(
			source,
			/remote:\s*\{[\s\S]*?workmuxControlChannel,[\s\S]*?source: connection,/,
		);
		assert.match(remoteCore, /restartCodex\(\{/);
		assert.match(
			remoteCore,
			/authority\.target\.workmuxControlChannel\.(?:command|operation)/,
		);
		assert.doesNotMatch(source, /restartCodexWithBridge|handleRestartCodex/);
	});

	void test('guards Codex restart against duplicate and stale UI requests', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const remoteCore = readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/keyboard-remote-core.ts'),
			'utf8',
		);

		assert.match(remoteCore, /restartInFlight/);
		assert.match(remoteCore, /restartGeneration/);
		assert.match(remoteCore, /restartCancellation/);
		assert.match(remoteCore, /isCurrent\(authority\)/);
		assert.doesNotMatch(source, /createGenerationRequestGate|codexRestartGate/);
		assert.doesNotMatch(
			source,
			/codexRestartGenerationRef|codexRestartInFlightRef/,
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
		const remoteCore = readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/keyboard-remote-core.ts'),
			'utf8',
		);

		assert.match(remoteCore, /copied\.operation === 'codex\.restart'/);
		assert.match(source, /\{\.\.\.keyboard\.commandMenuProps\}/);
		assert.doesNotMatch(source, /handleCommandBridgeEntry/);
	});

	void test('composes one native worktree workspace controller and modal', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		assert.equal(source.match(/useWorktreeWorkspaceController\(/g)?.length, 1);
		assert.match(
			source,
			/const worktreeWorkspace = useWorktreeWorkspaceController\(\{\s*connection: connection \?\? null,\s*tmuxEnabled,\s*sessionName: activeTmuxSessionName,\s*sourceKey: targetKey,\s*workmuxControlChannel,\s*arbiter: modalArbiter,\s*\}\);/,
		);
		assert.match(
			source,
			/openNewWorktreeWorkspace: worktreeWorkspace\.openNew/,
		);
		assert.match(
			source,
			/openCloseWorktreeWorkspace: worktreeWorkspace\.openClose/,
		);
		assert.equal(source.match(/<WorktreeWorkspaceModal\b/g)?.length, 1);
		assert.match(
			source,
			/<WorktreeWorkspaceModal\s+bottomOffset=\{Platform\.OS === 'android' \? insets\.bottom \+ 24 : 24\}\s+\{\.\.\.worktreeWorkspace\.modalProps\}\s*\/>/,
		);
	});

	void test('routes action slot presses through action run options helper', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const inputCore = readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers/keyboard-input-core.ts'),
			'utf8',
		);

		assert.match(inputCore, /runKeyboardActionSlot\(copiedSlot,/);
		assert.match(source, /\{\.\.\.keyboard\.terminalKeyboardProps\}/);
		assert.doesNotMatch(source, /runKeyboardActionSlot|handleSlotPress/);
	});
});
