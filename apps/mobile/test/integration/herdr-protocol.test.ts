import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
	buildHerdrTerminalControlCommand,
	createBoundedHerdrStderr,
	createHerdrLineDecoder,
	encodeHerdrInput,
	encodeHerdrRelease,
	encodeHerdrResize,
	encodeHerdrScroll,
	HERDR_MAX_INCOMPLETE_LINE_BYTES,
	HERDR_STDERR_LIMIT_BYTES,
	HerdrProtocolError,
	parseHerdrRecord,
} from '../../src/lib/herdr/protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodedJson(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(value)}\n`);
}

void test('builds normal and takeover commands with shell-safe terminal IDs', () => {
	assert.equal(
		buildHerdrTerminalControlCommand({
			terminalId: 'terminal-1',
			cols: 120,
			rows: 40,
		}),
		"herdr terminal session control 'terminal-1' --cols 120 --rows 40",
	);
	assert.equal(
		buildHerdrTerminalControlCommand({
			terminalId: "agent' $(touch /tmp/herdr); `id`",
			cols: 120,
			rows: 40,
			takeover: true,
		}),
		"herdr terminal session control 'agent'\\'' $(touch /tmp/herdr); `id`' --cols 120 --rows 40 --takeover",
	);
});

void test('rejects invalid terminal dimensions without retaining their values', () => {
	const invalidDimensions: readonly (readonly [number, number])[] = [
		[0, 40],
		[-1, 40],
		[12.5, 40],
		[Number.NaN, 40],
		[120, Number.MAX_SAFE_INTEGER + 1],
	];
	for (const [cols, rows] of invalidDimensions) {
		assert.throws(
			() =>
				buildHerdrTerminalControlCommand({
					terminalId: 'terminal-secret',
					cols,
					rows,
				}),
			(error: unknown) => {
				assert.ok(error instanceof HerdrProtocolError);
				assert.doesNotMatch(error.message, /terminal-secret|12\.5/);
				return true;
			},
		);
	}
});

void test('encodes UTF-8 and zero input bytes as exact canonical Base64 records', () => {
	assert.deepEqual(
		encodeHerdrInput(encoder.encode('hé🙂')),
		encodedJson({ type: 'terminal.input', bytes: 'aMOp8J+Zgg==' }),
	);
	assert.deepEqual(
		encodeHerdrInput(Uint8Array.of(0, 0xff, 0)),
		encodedJson({ type: 'terminal.input', bytes: 'AP8A' }),
	);
});

void test('encodes exact resize, scroll, and release records with one newline', () => {
	assert.deepEqual(
		encodeHerdrResize(100, 30),
		encodedJson({
			type: 'terminal.resize',
			cols: 100,
			rows: 30,
			cell_width_px: 0,
			cell_height_px: 0,
		}),
	);
	assert.deepEqual(
		encodeHerdrScroll('up', 3),
		encodedJson({
			type: 'terminal.scroll',
			direction: 'up',
			lines: 3,
			source: 'wheel',
		}),
	);
	assert.deepEqual(
		encodeHerdrScroll('down', 3),
		encodedJson({
			type: 'terminal.scroll',
			direction: 'down',
			lines: 3,
			source: 'wheel',
		}),
	);
	assert.deepEqual(
		encodeHerdrRelease(),
		encodedJson({ type: 'terminal.release' }),
	);

	for (const record of [
		encodeHerdrInput(Uint8Array.of(1)),
		encodeHerdrResize(1, 1),
		encodeHerdrScroll('up', 1),
		encodeHerdrRelease(),
	]) {
		assert.equal(decoder.decode(record).match(/\n/g)?.length, 1);
		assert.equal(record.at(-1), 0x0a);
		assert.notEqual(record.at(-2), 0x0a);
	}
});

void test('validates resize dimensions and clamps scroll lines to positive u16', () => {
	const invalidDimensions: readonly (readonly [number, number])[] = [
		[0, 1],
		[1, -1],
		[1.5, 2],
		[1, Number.POSITIVE_INFINITY],
	];
	for (const [cols, rows] of invalidDimensions) {
		assert.throws(
			() => encodeHerdrResize(cols, rows),
			HerdrProtocolError,
		);
	}
	assert.equal(JSON.parse(decoder.decode(encodeHerdrScroll('up', -10))).lines, 1);
	assert.equal(JSON.parse(decoder.decode(encodeHerdrScroll('up', 0))).lines, 1);
	assert.equal(JSON.parse(decoder.decode(encodeHerdrScroll('up', 2.9))).lines, 2);
	assert.equal(
		JSON.parse(decoder.decode(encodeHerdrScroll('up', 70_000))).lines,
		65_535,
	);
	assert.throws(
		() => encodeHerdrScroll('sideways' as 'up', 1),
		HerdrProtocolError,
	);
});

void test('frames split UTF-8, JSON tokens, CRLF, and multiple stdout records', () => {
	const lineDecoder = createHerdrLineDecoder();
	const wire = encoder.encode(
		'{"type":"future","label":"hé🙂"}\r\n{"type":"other"}\n',
	);
	const records: string[] = [];
	for (const byte of wire) {
		records.push(...lineDecoder.push(Uint8Array.of(byte)));
	}
	assert.deepEqual(records, [
		'{"type":"future","label":"hé🙂"}',
		'{"type":"other"}',
	]);
	assert.deepEqual(lineDecoder.finish(), []);
});

void test('finish returns one final unterminated record exactly once', () => {
	const lineDecoder = createHerdrLineDecoder();
	assert.deepEqual(lineDecoder.push(encoder.encode('{"type":')),
		[],
	);
	assert.deepEqual(lineDecoder.push(encoder.encode('"future"}')), []);
	assert.deepEqual(lineDecoder.finish(), ['{"type":"future"}']);
	assert.deepEqual(lineDecoder.finish(), []);
});

void test('rejects empty lines and fatal invalid UTF-8 without raw content', () => {
	for (const bytes of [Uint8Array.of(0x0a), Uint8Array.of(0x0d, 0x0a)]) {
		const lineDecoder = createHerdrLineDecoder();
		assert.throws(() => lineDecoder.push(bytes), HerdrProtocolError);
	}
	const lineDecoder = createHerdrLineDecoder();
	assert.throws(
		() => lineDecoder.push(Uint8Array.of(0xff, 0x0a)),
		(error: unknown) => {
			assert.ok(error instanceof HerdrProtocolError);
			assert.doesNotMatch(error.message, /ff/i);
			return true;
		},
	);
});

void test('rejects an incomplete line beyond four MiB before retaining it', () => {
	const lineDecoder = createHerdrLineDecoder();
	assert.deepEqual(
		lineDecoder.push(
			new Uint8Array(HERDR_MAX_INCOMPLETE_LINE_BYTES).fill(0x61),
		),
		[],
	);
	assert.throws(
		() => lineDecoder.push(Uint8Array.of(0x62)),
		HerdrProtocolError,
	);
});

void test('copies a chunked pending line only a constant number of times', () => {
	const chunk = new Uint8Array(4 * 1024).fill(0x61);
	const chunkCount = 64;
	const lineByteLength = chunk.byteLength * chunkCount;
	const originalSet = Uint8Array.prototype.set;
	let copiedByteCount = 0;
	const instrumentedSet = mock.method(
		Uint8Array.prototype,
		'set',
		function (
			this: Uint8Array,
			source: ArrayLike<number>,
			offset?: number,
		): void {
			copiedByteCount += source.length;
			originalSet.call(this, source, offset);
		},
	);

	try {
		const lineDecoder = createHerdrLineDecoder();
		for (let index = 0; index < chunkCount; index += 1) {
			assert.deepEqual(lineDecoder.push(chunk), []);
		}
		const records = lineDecoder.push(Uint8Array.of(0x0a));
		assert.equal(records.length, 1);
		assert.equal(records[0]?.length, lineByteLength);
	} finally {
		instrumentedSet.mock.restore();
	}

	assert.ok(
		copiedByteCount <= lineByteLength * 2,
		`copied ${copiedByteCount} bytes while framing ${lineByteLength} bytes`,
	);
});

void test('parses valid terminal frames and decodes canonical Base64 bytes', () => {
	assert.deepEqual(
		parseHerdrRecord(
			JSON.stringify({
				type: 'terminal.frame',
				seq: 1,
				encoding: 'ansi',
				width: 120,
				height: 40,
				full: true,
				bytes: 'AP8A',
				extra: 'ignored',
			}),
		),
		{
			type: 'terminal.frame',
			seq: 1,
			encoding: 'ansi',
			width: 120,
			height: 40,
			full: true,
			bytes: Uint8Array.of(0, 0xff, 0),
		},
	);
});

void test('rejects malformed known frames and non-canonical Base64', () => {
	const valid = {
		type: 'terminal.frame',
		seq: 1,
		encoding: 'ansi',
		width: 120,
		height: 40,
		full: true,
		bytes: 'AA==',
	};
	const invalidFrames = [
		{ ...valid, seq: 0 },
		{ ...valid, seq: -1 },
		{ ...valid, seq: 1.5 },
		{ ...valid, seq: Number.MAX_SAFE_INTEGER + 1 },
		{ ...valid, width: 0 },
		{ ...valid, width: Number.MAX_SAFE_INTEGER + 1 },
		{ ...valid, height: -1 },
		{ ...valid, encoding: 'utf8' },
		{ ...valid, full: 1 },
		{ ...valid, bytes: 'AA' },
		{ ...valid, bytes: 'A===' },
		{ ...valid, bytes: 'AA=A' },
		{ ...valid, bytes: 'AB==' },
		{ ...valid, bytes: 'AAB=' },
		{ ...valid, bytes: 'AA==\n' },
	];
	for (const frame of invalidFrames) {
		assert.throws(
			() => parseHerdrRecord(JSON.stringify(frame)),
			HerdrProtocolError,
		);
	}
});

void test('normalizes valid terminal.closed reasons and ignores unknown types', () => {
	assert.deepEqual(parseHerdrRecord('{"type":"terminal.closed"}'), {
		type: 'terminal.closed',
		reason: null,
	});
	assert.deepEqual(
		parseHerdrRecord('{"type":"terminal.closed","reason":null}'),
		{ type: 'terminal.closed', reason: null },
	);
	assert.deepEqual(
		parseHerdrRecord('{"type":"terminal.closed","reason":"done"}'),
		{ type: 'terminal.closed', reason: 'done' },
	);
	assert.deepEqual(
		parseHerdrRecord('{"type":"terminal.future","payload":"secret"}'),
		{ type: 'unknown' },
	);
	assert.throws(
		() => parseHerdrRecord('{"type":"terminal.closed","reason":7}'),
		HerdrProtocolError,
	);
});

void test('rejects invalid JSON and malformed record envelopes with typed safe errors', () => {
	for (const line of [
		'TOP_SECRET_INPUT{',
		'null',
		'[]',
		'{"payload":"TOP_SECRET_INPUT"}',
		'{"type":7,"payload":"TOP_SECRET_INPUT"}',
	]) {
		assert.throws(
			() => parseHerdrRecord(line),
			(error: unknown) => {
				assert.ok(error instanceof HerdrProtocolError);
				assert.doesNotMatch(error.message, /TOP_SECRET_INPUT/);
				assert.doesNotMatch(JSON.stringify(error), /TOP_SECRET_INPUT/);
				return true;
			},
		);
	}
});

void test('retains only the final 16 KiB of split stderr chunks', () => {
	const stderr = createBoundedHerdrStderr();
	stderr.push(encoder.encode(`discard-${'a'.repeat(10_000)}`));
	stderr.push(encoder.encode(`${'b'.repeat(10_000)}-TAIL`));
	const display = stderr.getDisplayText();
	assert.equal(encoder.encode(display).byteLength, HERDR_STDERR_LIMIT_BYTES);
	assert.doesNotMatch(display, /discard/);
	assert.match(display, /-TAIL$/);
});

void test('sanitizes stderr control characters and collapses display whitespace', () => {
	const stderr = createBoundedHerdrStderr();
	stderr.push(encoder.encode('  first\u0000\u001b[31m\t\n second\r\n\u007f third  '));
	assert.equal(stderr.getDisplayText(), 'first[31m second third');
});
