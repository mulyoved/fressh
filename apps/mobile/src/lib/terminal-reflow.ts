export const TERMINAL_REFLOW_HISTORY_LINES = 300;
export const MIN_TERMINAL_REFLOW_COLS = 20;

const encoder = new TextEncoder();

export function normalizeTerminalReflowCols(cols: number): number {
	if (!Number.isSafeInteger(cols) || cols < MIN_TERMINAL_REFLOW_COLS) {
		return MIN_TERMINAL_REFLOW_COLS;
	}
	return cols;
}

export function formatTerminalReflowSnapshot(
	capturedText: string,
	cols: number,
): Uint8Array {
	const wrapCols = normalizeTerminalReflowCols(cols);
	const lines = capturedText.replace(/\r\n?/g, '\n').split('\n');

	while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
		lines.pop();
	}

	if (lines.length === 0) {
		return new Uint8Array();
	}

	const outputLines = lines.flatMap((line) => wrapLineByCells(line, wrapCols));

	return encoder.encode(`${outputLines.join('\r\n')}\r\n`);
}

function wrapLineByCells(line: string, cols: number): string[] {
	if (line.length === 0) {
		return [''];
	}

	const wrappedLines: string[] = [];
	let currentLine = '';
	let currentWidth = 0;

	for (const cluster of segmentGraphemeClusters(line)) {
		const clusterWidth = stringCellWidth(cluster);
		if (
			currentLine.length > 0 &&
			currentWidth + clusterWidth > cols &&
			clusterWidth > 0
		) {
			wrappedLines.push(currentLine);
			currentLine = '';
			currentWidth = 0;
		}
		currentLine += cluster;
		currentWidth += clusterWidth;
	}

	wrappedLines.push(currentLine);
	return wrappedLines;
}

function segmentGraphemeClusters(value: string): string[] {
	const clusters: string[] = [];
	let current = '';
	let joinNext = false;
	let currentRegionalIndicators = 0;

	for (const char of value) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined) continue;
		const isRegionalIndicator = isRegionalIndicatorCodePoint(codePoint);

		if (current === '') {
			current = char;
			joinNext = codePoint === 0x200d;
			currentRegionalIndicators = isRegionalIndicator ? 1 : 0;
			continue;
		}

		if (
			joinNext ||
			isGraphemeExtender(codePoint) ||
			(isRegionalIndicator && currentRegionalIndicators === 1)
		) {
			current += char;
			currentRegionalIndicators = isRegionalIndicator
				? currentRegionalIndicators + 1
				: 0;
		} else {
			clusters.push(current);
			current = char;
			currentRegionalIndicators = isRegionalIndicator ? 1 : 0;
		}

		joinNext = codePoint === 0x200d;
	}

	if (current !== '') {
		clusters.push(current);
	}

	return clusters;
}

function stringCellWidth(value: string): number {
	if (isRegionalIndicatorPair(value)) {
		return 2;
	}

	let width = 0;
	let previousWasJoiner = false;

	for (const char of value) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined) continue;

		if (isZeroWidthCodePoint(codePoint)) {
			previousWasJoiner = codePoint === 0x200d;
			continue;
		}

		const codePointWidth = codePointCellWidth(codePoint);
		if (previousWasJoiner && codePointWidth > 0) {
			width = Math.max(width, codePointWidth);
		} else {
			width += codePointWidth;
		}
		previousWasJoiner = false;
	}

	return width;
}

function codePointCellWidth(codePoint: number): number {
	if (codePoint === 0) return 0;
	if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
	if (isWideCodePoint(codePoint)) return 2;
	return 1;
}

function isGraphemeExtender(codePoint: number): boolean {
	return (
		isCombiningMark(codePoint) ||
		isVariationSelector(codePoint) ||
		isEmojiModifier(codePoint) ||
		codePoint === 0x200d
	);
}

function isZeroWidthCodePoint(codePoint: number): boolean {
	return (
		isCombiningMark(codePoint) ||
		isVariationSelector(codePoint) ||
		isEmojiModifier(codePoint) ||
		codePoint === 0x200b ||
		codePoint === 0x200c ||
		codePoint === 0x200d ||
		codePoint === 0xfeff
	);
}

function isCombiningMark(codePoint: number): boolean {
	return (
		(codePoint >= 0x0591 && codePoint <= 0x05bd) ||
		codePoint === 0x05bf ||
		(codePoint >= 0x05c1 && codePoint <= 0x05c2) ||
		(codePoint >= 0x05c4 && codePoint <= 0x05c5) ||
		codePoint === 0x05c7 ||
		(codePoint >= 0x0610 && codePoint <= 0x061a) ||
		(codePoint >= 0x064b && codePoint <= 0x065f) ||
		codePoint === 0x0670 ||
		(codePoint >= 0x06d6 && codePoint <= 0x06dc) ||
		(codePoint >= 0x06df && codePoint <= 0x06e4) ||
		(codePoint >= 0x06e7 && codePoint <= 0x06e8) ||
		(codePoint >= 0x06ea && codePoint <= 0x06ed) ||
		(codePoint >= 0x0300 && codePoint <= 0x036f) ||
		(codePoint >= 0x0483 && codePoint <= 0x0489) ||
		(codePoint >= 0x07eb && codePoint <= 0x07f3) ||
		(codePoint >= 0x0816 && codePoint <= 0x0819) ||
		(codePoint >= 0x081b && codePoint <= 0x0823) ||
		(codePoint >= 0x0825 && codePoint <= 0x0827) ||
		(codePoint >= 0x0829 && codePoint <= 0x082d) ||
		(codePoint >= 0x0859 && codePoint <= 0x085b) ||
		(codePoint >= 0x08d3 && codePoint <= 0x08e1) ||
		(codePoint >= 0x08e3 && codePoint <= 0x0903) ||
		(codePoint >= 0x093a && codePoint <= 0x093c) ||
		(codePoint >= 0x0941 && codePoint <= 0x0948) ||
		(codePoint >= 0x094d && codePoint <= 0x094f) ||
		(codePoint >= 0x0951 && codePoint <= 0x0957) ||
		(codePoint >= 0x0962 && codePoint <= 0x0963) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
		(codePoint >= 0xa66f && codePoint <= 0xa672) ||
		(codePoint >= 0xa674 && codePoint <= 0xa67d) ||
		(codePoint >= 0xa69e && codePoint <= 0xa69f) ||
		(codePoint >= 0xa6f0 && codePoint <= 0xa6f1) ||
		(codePoint >= 0xa8e0 && codePoint <= 0xa8f1) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f)
	);
}

function isVariationSelector(codePoint: number): boolean {
	return (
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		(codePoint >= 0xe0100 && codePoint <= 0xe01ef)
	);
}

function isEmojiModifier(codePoint: number): boolean {
	return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isRegionalIndicatorCodePoint(codePoint: number): boolean {
	return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function isRegionalIndicatorPair(value: string): boolean {
	const chars = [...value];
	return (
		chars.length === 2 &&
		chars.every((char) => {
			const codePoint = char.codePointAt(0);
			return codePoint !== undefined && isRegionalIndicatorCodePoint(codePoint);
		})
	);
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	);
}
