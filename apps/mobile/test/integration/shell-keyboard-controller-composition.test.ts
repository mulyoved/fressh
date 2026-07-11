import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const detailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');

function extractBalancedCall(source: string, callee: string): string {
	const start = source.indexOf(`${callee}(`);
	assert.notEqual(start, -1, `${callee} call was not found`);
	const open = source.indexOf('(', start);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === '(') depth += 1;
		if (source[index] === ')') {
			depth -= 1;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	assert.fail(`${callee} call was not closed`);
}

void describe('shell keyboard controller composition', () => {
	void test('shell detail delegates keyboard command workflow', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(source, /useShellKeyboardController\(\{/);
		for (const legacy of [
			'preferredKeyboardId',
			'modifierKeysActive',
			'commandTimeoutsRef',
			'workmuxKeyboardCommandRunner',
			'codexRestartGenerationRef',
			'codexRestartInFlightRef',
			'runtimeShellConfigReloadRequestIdRef',
			'systemKeyboardVisibleRef',
			'lastKeyboardVisibleRef',
		]) {
			assert.doesNotMatch(source, new RegExp(legacy));
		}
	});

	void test('shell detail remains an explicit composition root', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.doesNotMatch(source, /useShellController\(/);
		assert.match(source, /useShellTerminalController\(/);
		assert.match(source, /useShellScrollbackController\(/);
		assert.match(source, /useShellKeyboardController\(/);
	});

	void test('passes exact current controller and authority ports to keyboard', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const call = extractBalancedCall(source, 'useShellKeyboardController');

		assert.equal(source.match(/useShellKeyboardController\(\{/g)?.length, 1);
		for (const mapping of [
			/^\s*activity,\s*$/m,
			/sourceKey:\s*targetKey/,
			/scrollbackInput:\s*scrollback\.input/,
			/terminalView:\s*terminal\.view/,
			/^\s*remoteTarget,\s*$/m,
			/^\s*navScope,\s*$/m,
			/setNavScope:\s*preferences\.workmuxNavScope\.set/,
			/^\s*modalCommands,\s*$/m,
			/^\s*browserCommands,\s*$/m,
			/fitTerminalToDevice:\s*handleFitTerminalToDevice/,
			/^\s*debugConnectionInCodex,\s*$/m,
			/reloadRuntimeShellConfig:\s*reloadRuntimeShellConfigFromRemote/,
			/^\s*configureCommands,\s*$/m,
			/platformOS:\s*Platform\.OS/,
		]) {
			assert.match(call, mapping);
		}
		assert.match(
			source,
			/const remoteTarget = useMemo<ShellKeyboardRemoteTargetContext>[\s\S]*?targetKey,[\s\S]*?tmuxEnabled,[\s\S]*?sessionName: activeTmuxSessionName,[\s\S]*?connectionId,[\s\S]*?channelId,[\s\S]*?workmuxControlChannel,[\s\S]*?source: connection/,
		);
	});

	void test('consumes exact keyboard bundles and merges only Wispr text-entry props', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(
			source,
			/<TerminalKeyboard\s+\{\.\.\.keyboard\.terminalKeyboardProps\}/,
		);
		assert.match(
			source,
			/<CommandMenuModal[\s\S]*?\{\.\.\.keyboard\.commandMenuProps\}/,
		);
		assert.match(
			source,
			/<TerminalCommanderModal[\s\S]*?\{\.\.\.keyboard\.commanderProps\}/,
		);
		assert.match(
			source,
			/<ConfigureModal[\s\S]*?\{\.\.\.keyboard\.configureProps\}/,
		);
		const textEntry = source.slice(
			source.indexOf('<TextEntryModal'),
			source.indexOf('/>', source.indexOf('<TextEntryModal')),
		);
		assert.match(textEntry, /\{\.\.\.keyboard\.textEntryProps\}/);
		assert.match(textEntry, /wisprMode=\{wisprMode\}/);
		assert.match(textEntry, /wisprControl=\{wisprControl\}/);
		assert.match(textEntry, /onWisprSetup=/);
		assert.match(textEntry, /onWisprAutoStartChange=/);
		assert.match(textEntry, /onWisprFocus=/);
		assert.match(textEntry, /onValueChange=/);
		assert.doesNotMatch(textEntry, /onPaste=|history=\{/);
	});

	void test('delegates terminal callbacks once and retains no input bypass', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		for (const callback of [
			'onSelection={keyboard.onSelectionChanged}',
			'onSelectionModeChange={keyboard.onSelectionModeChange}',
			'onInput={keyboard.onWebViewInput}',
		]) {
			assert.equal(source.split(callback).length - 1, 1, callback);
		}
		assert.doesNotMatch(
			source,
			/shell\.sendData|terminal\.transport\.send|scrollback\.input\.sendSegments|Keyboard\.addListener/,
		);
		assert.doesNotMatch(
			source,
			/createWorkmuxKeyboardCommandRunner|restartCodexWithBridge|runKeyboardActionSlot|runMacro|buildCommanderExecuteSegments/,
		);
	});

	void test('invalidates keyboard authority before controller transition work', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const authorityEffect = source.indexOf(
			'keyboardAuthorityRef.current?.invalidate(reason)',
		);
		const terminalComposition = source.indexOf(
			'const terminal = useShellTerminalController',
		);
		const scrollbackComposition = source.indexOf(
			'const scrollback = useShellScrollbackController',
		);

		assert.notEqual(authorityEffect, -1);
		assert.ok(authorityEffect < terminalComposition);
		assert.ok(authorityEffect < scrollbackComposition);
		const runtimeCallback = source.slice(
			source.indexOf('const handleTerminalRuntimeChanged'),
			terminalComposition,
		);
		assert.ok(
			runtimeCallback.indexOf(
				"keyboardAuthorityRef.current?.invalidate('runtime-reset')",
			) <
				runtimeCallback.indexOf(
					'scrollbackRuntimeChangedRef.current(instanceId)',
				),
		);
	});
});
