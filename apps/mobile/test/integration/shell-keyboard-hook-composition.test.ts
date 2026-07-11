import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
	`${process.cwd()}/src/lib/shell-controllers/keyboard.tsx`,
	'utf8',
);
const runtimeSource = readFileSync(
	`${process.cwd()}/src/lib/shell-controllers/keyboard-hook-runtime.ts`,
	'utf8',
);

void test('keyboard hook owns one Android visibility listener pair and exact flash timing', () => {
	assert.match(source, /Keyboard\.addListener\('keyboardDidShow'/);
	assert.match(source, /Keyboard\.addListener\('keyboardDidHide'/);
	assert.match(runtimeSource, /duration: 800/);
	assert.match(runtimeSource, /delay: 400/);
	assert.match(runtimeSource, /useNativeDriver: true/);
});

void test('keyboard hook composes all cores and uses replay-safe disposal', () => {
	assert.match(source, /createShellKeyboardStateCore/);
	assert.match(source, /createShellKeyboardInputCore/);
	assert.match(source, /createShellKeyboardRemoteCore/);
	assert.match(source, /createReplaySafeDisposer/);
	assert.match(source, /useSyncExternalStore/);
});

void test('keyboard hook routes action policy through canonical helpers', () => {
	assert.match(source, /runAction\(actionId,/);
	assert.doesNotMatch(source, /switch \(actionId\)/);
	assert.match(source, /inputCore\.handleSlotPress/);
});
