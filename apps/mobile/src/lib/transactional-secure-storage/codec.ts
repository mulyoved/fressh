import { fromByteArray, toByteArray } from 'base64-js';

export const MAX_SECURE_STORE_VALUE_BYTES = 1800;
export const MAX_RAW_VALUE_CHUNK_BYTES = 1350;

const textEncoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}

export function assertPayloadFits(payload: string): void {
	if (utf8ByteLength(payload) > MAX_SECURE_STORE_VALUE_BYTES) {
		throw new Error(
			`Secure storage payload exceeds ${MAX_SECURE_STORE_VALUE_BYTES} UTF-8 bytes`,
		);
	}
}

export function encodeValueChunks(value: string): string[] {
	const bytes = textEncoder.encode(value);
	const chunks: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += MAX_RAW_VALUE_CHUNK_BYTES) {
		chunks.push(
			fromByteArray(bytes.subarray(offset, offset + MAX_RAW_VALUE_CHUNK_BYTES)),
		);
	}
	return chunks;
}

export function decodeValueChunks(chunks: readonly string[]): string {
	const decodedChunks = chunks.map((chunk) => toByteArray(chunk));
	const byteLength = decodedChunks.reduce(
		(total, chunk) => total + chunk.byteLength,
		0,
	);
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of decodedChunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function sortObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortObjectKeys);
	}
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, fieldValue]) => fieldValue !== undefined)
				.sort(([left], [right]) =>
					left < right ? -1 : left > right ? 1 : 0,
				)
				.map(([key, fieldValue]) => [key, sortObjectKeys(fieldValue)]),
		);
	}
	return value;
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortObjectKeys(value));
}
