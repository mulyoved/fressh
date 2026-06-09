import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatTerminalReflowSnapshot,
	MIN_TERMINAL_REFLOW_COLS,
	normalizeTerminalReflowCols,
} from '../../src/lib/terminal-reflow';

const decoder = new TextDecoder();
const decodeSnapshot = (bytes: Uint8Array) => decoder.decode(bytes);

void test('terminal reflow wraps long lines at the current cols', () => {
	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot('START:abcdefghijklmnopqrstuvwxyz:END', 20),
		),
		'START:abcdefghijklmn\r\nopqrstuvwxyz:END\r\n',
	);
});

void test('terminal reflow preserves explicit newlines and normalizes CRLF', () => {
	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot('alpha\r\n\r\nbeta\rgamma', 80),
		),
		'alpha\r\n\r\nbeta\r\ngamma\r\n',
	);
});

void test('terminal reflow keeps combining-mark clusters intact', () => {
	const line = `${'a'.repeat(19)}e\u0301b`;

	assert.equal(
		decodeSnapshot(formatTerminalReflowSnapshot(line, 20)),
		`${'a'.repeat(19)}e\u0301\r\nb\r\n`,
	);
});

void test('terminal reflow counts wide CJK characters as two cells', () => {
	assert.equal(
		decodeSnapshot(formatTerminalReflowSnapshot(`${'a'.repeat(18)}界b`, 20)),
		`${'a'.repeat(18)}界\r\nb\r\n`,
	);
});

void test('terminal reflow keeps emoji joiner sequences intact', () => {
	const family = '👨‍👩‍👧‍👦';

	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot(`${'a'.repeat(19)}${family}b`, 20),
		),
		`${'a'.repeat(19)}\r\n${family}b\r\n`,
	);
});

void test('terminal reflow counts emoji joiner sequences as one wide glyph', () => {
	const family = '👨‍👩‍👧‍👦';

	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot(`${'a'.repeat(18)}${family}b`, 20),
		),
		`${'a'.repeat(18)}${family}\r\nb\r\n`,
	);
});

void test('terminal reflow counts emoji skin-tone modifiers as zero-width', () => {
	const thumbsUp = '👍🏽';

	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot(`${'a'.repeat(18)}${thumbsUp}b`, 20),
		),
		`${'a'.repeat(18)}${thumbsUp}\r\nb\r\n`,
	);
});

void test('terminal reflow keeps regional-indicator flag pairs intact', () => {
	const flag = '🇺🇸';

	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot(`${'a'.repeat(18)}${flag}b`, 20),
		),
		`${'a'.repeat(18)}${flag}\r\nb\r\n`,
	);
});

void test('terminal reflow keeps Hebrew combining marks with their base glyph', () => {
	assert.equal(
		decodeSnapshot(
			formatTerminalReflowSnapshot(`${'a'.repeat(19)}א\u05b0b`, 20),
		),
		`${'a'.repeat(19)}א\u05b0\r\nb\r\n`,
	);
});

void test('terminal reflow trims trailing empty viewport filler', () => {
	assert.equal(
		decodeSnapshot(formatTerminalReflowSnapshot('alpha\nbeta\n   \n\t\n', 80)),
		'alpha\r\nbeta\r\n',
	);
});

void test('terminal reflow returns empty bytes for empty or whitespace-only captures', () => {
	assert.deepEqual(formatTerminalReflowSnapshot('', 80), new Uint8Array());
	assert.deepEqual(
		formatTerminalReflowSnapshot(' \n\t\r\n   ', 80),
		new Uint8Array(),
	);
});

void test('terminal reflow normalizes columns to a defensive minimum', () => {
	assert.equal(normalizeTerminalReflowCols(12), MIN_TERMINAL_REFLOW_COLS);
	assert.equal(normalizeTerminalReflowCols(20), 20);
	assert.equal(normalizeTerminalReflowCols(132), 132);
	assert.equal(
		normalizeTerminalReflowCols(Number.POSITIVE_INFINITY),
		MIN_TERMINAL_REFLOW_COLS,
	);
	assert.equal(normalizeTerminalReflowCols(20.5), MIN_TERMINAL_REFLOW_COLS);
	assert.equal(
		normalizeTerminalReflowCols(Number.NaN),
		MIN_TERMINAL_REFLOW_COLS,
	);
});
