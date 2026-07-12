import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MAX_SECURE_STORE_VALUE_BYTES,
	assertPayloadFits,
	canonicalJson,
	decodeValueChunks,
	encodeValueChunks,
	utf8ByteLength,
} from '../../src/lib/transactional-secure-storage/codec';

void test('value chunks stay under 1800 UTF-8 bytes and preserve Unicode', () => {
	const value = `${'a'.repeat(1349)}🙂${'界'.repeat(900)}`;
	const chunks = encodeValueChunks(value);
	assert.ok(chunks.length > 1);
	assert.ok(
		chunks.every(
			(chunk) => utf8ByteLength(chunk) <= MAX_SECURE_STORE_VALUE_BYTES,
		),
	);
	assert.equal(decodeValueChunks(chunks), value);
});

void test('canonicalJson ignores object insertion order', () => {
	assert.equal(
		canonicalJson({ z: 1, nested: { b: true, a: 'x' } }),
		canonicalJson({ nested: { a: 'x', b: true }, z: 1 }),
	);
});

void test('canonicalJson uses locale-independent UTF-16 key order', () => {
	assert.equal(
		canonicalJson({ ä: 4, Á: 3, z: 2, a: 1 }),
		'{"a":1,"z":2,"Á":3,"ä":4}',
	);
});

void test('assertPayloadFits rejects 1801 UTF-8 bytes', () => {
	assert.throws(() => assertPayloadFits('x'.repeat(1801)), /1800 UTF-8 bytes/);
});
