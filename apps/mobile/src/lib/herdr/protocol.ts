import { fromByteArray, toByteArray } from 'base64-js';

import { quoteShell } from '../host-browser-actions';

export const HERDR_MAX_INCOMPLETE_LINE_BYTES = 4 * 1024 * 1024;
export const HERDR_STDERR_LIMIT_BYTES = 16 * 1024;

const encoder = new TextEncoder();

type HerdrProtocolErrorCode =
	| 'invalid-command'
	| 'invalid-outbound-record'
	| 'invalid-stdout'
	| 'oversized-record'
	| 'malformed-record';

const protocolErrorMessages: Record<HerdrProtocolErrorCode, string> = {
	'invalid-command': 'Herdr terminal command parameters are invalid.',
	'invalid-outbound-record': 'Herdr terminal control data is invalid.',
	'invalid-stdout': 'Herdr terminal output is not valid UTF-8.',
	'oversized-record': 'Herdr terminal output record is too large.',
	'malformed-record': 'Herdr terminal output record is malformed.',
};

export class HerdrProtocolError extends Error {
	readonly code: HerdrProtocolErrorCode;

	constructor(code: HerdrProtocolErrorCode) {
		super(protocolErrorMessages[code]);
		this.name = 'HerdrProtocolError';
		this.code = code;
	}
}

export type HerdrTerminalFrame = Readonly<{
	type: 'terminal.frame';
	seq: number;
	encoding: 'ansi';
	width: number;
	height: number;
	full: boolean;
	bytes: Uint8Array;
}>;

export type HerdrTerminalClosed = Readonly<{
	type: 'terminal.closed';
	reason: string | null;
}>;

export type HerdrTerminalRecord =
	| HerdrTerminalFrame
	| HerdrTerminalClosed
	| Readonly<{ type: 'unknown' }>;

function isSafePositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function requireDimensions(cols: unknown, rows: unknown): void {
	if (!isSafePositiveInteger(cols) || !isSafePositiveInteger(rows)) {
		throw new HerdrProtocolError('invalid-command');
	}
}

export function buildHerdrTerminalControlCommand(input: {
	terminalId: string;
	cols: number;
	rows: number;
	takeover?: boolean;
}): string {
	requireDimensions(input.cols, input.rows);
	return [
		'herdr terminal session control',
		quoteShell(input.terminalId),
		`--cols ${input.cols}`,
		`--rows ${input.rows}`,
		input.takeover ? '--takeover' : null,
	]
		.filter((part): part is string => part !== null)
		.join(' ');
}

function encodeRecord(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(value)}\n`);
}

function asUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
	return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export function encodeHerdrInput(
	bytes: Uint8Array | ArrayBuffer,
): Uint8Array {
	return encodeRecord({
		type: 'terminal.input',
		bytes: fromByteArray(asUint8Array(bytes)),
	});
}

export function encodeHerdrResize(cols: number, rows: number): Uint8Array {
	if (!isSafePositiveInteger(cols) || !isSafePositiveInteger(rows)) {
		throw new HerdrProtocolError('invalid-outbound-record');
	}
	return encodeRecord({
		type: 'terminal.resize',
		cols,
		rows,
		cell_width_px: 0,
		cell_height_px: 0,
	});
}

export function encodeHerdrScroll(
	direction: 'up' | 'down',
	lines: number,
): Uint8Array {
	if (direction !== 'up' && direction !== 'down') {
		throw new HerdrProtocolError('invalid-outbound-record');
	}
	const integerLines = Number.isNaN(lines) ? 1 : Math.trunc(lines);
	const clampedLines = Math.max(1, Math.min(65_535, integerLines));
	return encodeRecord({
		type: 'terminal.scroll',
		direction,
		lines: clampedLines,
		source: 'wheel',
	});
}

export function encodeHerdrRelease(): Uint8Array {
	return encodeRecord({ type: 'terminal.release' });
}

function decodeLine(bytes: Uint8Array): string {
	const withoutCarriageReturn =
		bytes.at(-1) === 0x0d ? bytes.subarray(0, bytes.byteLength - 1) : bytes;
	if (withoutCarriageReturn.byteLength === 0) {
		throw new HerdrProtocolError('malformed-record');
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(
			withoutCarriageReturn,
		);
	} catch {
		throw new HerdrProtocolError('invalid-stdout');
	}
}

function joinBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
	if (left.byteLength === 0) return right.slice();
	if (right.byteLength === 0) return left;
	const joined = new Uint8Array(left.byteLength + right.byteLength);
	joined.set(left);
	joined.set(right, left.byteLength);
	return joined;
}

export function createHerdrLineDecoder(): Readonly<{
	push(chunk: Uint8Array | ArrayBuffer): string[];
	finish(): string[];
}> {
	let pending: Uint8Array<ArrayBufferLike> = new Uint8Array();

	function assertBounded(additionalBytes: number): void {
		if (
			pending.byteLength + additionalBytes >
			HERDR_MAX_INCOMPLETE_LINE_BYTES
		) {
			throw new HerdrProtocolError('oversized-record');
		}
	}

	return {
		push(chunk) {
			const bytes = asUint8Array(chunk);
			const lines: string[] = [];
			let segmentStart = 0;
			for (let index = 0; index < bytes.byteLength; index += 1) {
				if (bytes[index] !== 0x0a) continue;
				const segment = bytes.subarray(segmentStart, index);
				assertBounded(segment.byteLength);
				lines.push(decodeLine(joinBytes(pending, segment)));
				pending = new Uint8Array();
				segmentStart = index + 1;
			}
			const remainder = bytes.subarray(segmentStart);
			assertBounded(remainder.byteLength);
			pending = joinBytes(pending, remainder);
			return lines;
		},
		finish() {
			if (pending.byteLength === 0) return [];
			const line = decodeLine(pending);
			pending = new Uint8Array();
			return [line];
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCanonicalBase64(value: unknown): Uint8Array {
	if (
		typeof value !== 'string' ||
		!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(
			value,
		)
	) {
		throw new HerdrProtocolError('malformed-record');
	}
	try {
		const bytes = toByteArray(value);
		if (fromByteArray(bytes) !== value) {
			throw new HerdrProtocolError('malformed-record');
		}
		return bytes;
	} catch (error) {
		if (error instanceof HerdrProtocolError) throw error;
		throw new HerdrProtocolError('malformed-record');
	}
}

export function parseHerdrRecord(line: string): HerdrTerminalRecord {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		throw new HerdrProtocolError('malformed-record');
	}
	if (!isRecord(value) || typeof value.type !== 'string') {
		throw new HerdrProtocolError('malformed-record');
	}

	if (value.type === 'terminal.frame') {
		if (
			!isSafePositiveInteger(value.seq) ||
			value.encoding !== 'ansi' ||
			!isSafePositiveInteger(value.width) ||
			!isSafePositiveInteger(value.height) ||
			typeof value.full !== 'boolean'
		) {
			throw new HerdrProtocolError('malformed-record');
		}
		return {
			type: 'terminal.frame',
			seq: value.seq,
			encoding: 'ansi',
			width: value.width,
			height: value.height,
			full: value.full,
			bytes: decodeCanonicalBase64(value.bytes),
		};
	}

	if (value.type === 'terminal.closed') {
		if (
			value.reason !== undefined &&
			value.reason !== null &&
			typeof value.reason !== 'string'
		) {
			throw new HerdrProtocolError('malformed-record');
		}
		return {
			type: 'terminal.closed',
			reason: value.reason ?? null,
		};
	}

	return { type: 'unknown' };
}

export function sanitizeHerdrDiagnostic(value: string): string {
	const withoutControlCharacters = Array.from(value)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return !(
				code <= 0x08 ||
				code === 0x0b ||
				code === 0x0c ||
				(code >= 0x0e && code <= 0x1f) ||
				(code >= 0x7f && code <= 0x9f)
			);
		})
		.join('');
	return withoutControlCharacters
		.replace(/\s+/g, ' ')
		.trim();
}

export function createBoundedHerdrStderr(): Readonly<{
	push(chunk: Uint8Array | ArrayBuffer): void;
	getDisplayText(): string;
}> {
	let tail = new Uint8Array();
	return {
		push(chunk) {
			const bytes = asUint8Array(chunk);
			if (bytes.byteLength >= HERDR_STDERR_LIMIT_BYTES) {
				tail = bytes.slice(bytes.byteLength - HERDR_STDERR_LIMIT_BYTES);
				return;
			}
			const retainedFromTail = Math.min(
				tail.byteLength,
				HERDR_STDERR_LIMIT_BYTES - bytes.byteLength,
			);
			const next = new Uint8Array(retainedFromTail + bytes.byteLength);
			next.set(tail.subarray(tail.byteLength - retainedFromTail));
			next.set(bytes, retainedFromTail);
			tail = next;
		},
		getDisplayText() {
			return sanitizeHerdrDiagnostic(new TextDecoder().decode(tail));
		},
	};
}
