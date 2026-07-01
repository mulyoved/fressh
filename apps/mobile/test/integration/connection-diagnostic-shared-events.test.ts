import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildActiveConnectionIdentity,
	buildSavedEntryIdentity,
	copyConnectionIdentity,
	formatDiagnosticJsonInline,
	formatConnectionIdentity,
	omitPrivateKeyMaterial,
	serializeConnectionDiagnosticError,
	snapshotDiagnosticValue,
	type connectionDiagnosticEventKinds,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

void test('identity helpers copy only diagnostic-safe connection fields', () => {
	const saved = buildSavedEntryIdentity('saved-1', {
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		security: { keyId: 'key-1', privateKey: 'private' },
		useTmux: true,
		tmuxSessionName: 'main',
		autoConnect: true,
		password: 'must-not-copy',
	} as never);
	const active = buildActiveConnectionIdentity({
		connectionId: 'active-1',
		connectionDetails: {
			username: 'muly',
			host: 'dev.tailnet.ts.net',
			port: 22,
		},
	});
	const copied = copyConnectionIdentity({
		...saved,
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} as never);

	assert.deepEqual(saved, {
		savedConnectionId: 'saved-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	});
	assert.deepEqual(active, {
		connectionId: 'active-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
	});
	assert.equal('privateKey' in copied, false);
	assert.equal('password' in copied, false);
});

void test('snapshot helper is circular-safe and omits private key blocks', () => {
	const value: { nested?: unknown; key: string; token: string } = {
		token: 'token=abc stays for personal diagnostics',
		key: [
			'-----BEGIN OPENSSH PRIVATE KEY-----',
			'secret-key-body',
			'-----END OPENSSH PRIVATE KEY-----',
		].join('\n'),
	};
	value.nested = value;

	const serialized = JSON.stringify(snapshotDiagnosticValue(value));

	assert.doesNotMatch(serialized, /secret-key-body/);
	assert.match(serialized, /Private key material omitted/);
	assert.match(serialized, /Circular/);
	assert.match(serialized, /token=abc stays/);
});

void test('error serializer keeps useful fields and omits private key material', () => {
	const error = serializeConnectionDiagnosticError({
		name: 'SshError',
		message: [
			'failed',
			'-----BEGIN RSA PRIVATE KEY-----',
			'secret',
			'-----END RSA PRIVATE KEY-----',
		].join('\n'),
		tag: 'ssh-connect',
		inner: { code: 'ECONNRESET' },
		secret: 'must-not-copy',
	});

	assert.equal(error.name, 'SshError');
	assert.equal(error.tag, 'ssh-connect');
	assert.doesNotMatch(error.message, /secret/);
	assert.equal('secret' in error, false);
	assert.deepEqual(error.inner, { code: 'ECONNRESET' });
});

void test('private key omission helper redacts PEM blocks only', () => {
	assert.equal(omitPrivateKeyMaterial('token=abc'), 'token=abc');
	assert.equal(
		omitPrivateKeyMaterial(
			['-----BEGIN PRIVATE KEY-----', 'abc', '-----END PRIVATE KEY-----'].join(
				'\n',
			),
		),
		'[Private key material omitted]',
	);
});

void test('inline diagnostic JSON formatter handles undefined snapshots', () => {
	assert.equal(formatDiagnosticJsonInline(undefined), 'undefined');
});

void test('connection identity formatter covers unknown and rich identities', () => {
	assert.equal(formatConnectionIdentity(undefined), 'unknown connection');
	assert.equal(
		formatConnectionIdentity({
			savedConnectionId: 'saved-1',
			connectionId: 'active-1',
			username: 'muly',
			host: 'dev.tailnet.ts.net',
			port: 22,
			keyId: 'key-1',
			useTmux: true,
			tmuxSessionName: 'main',
		}),
		[
			'muly@dev.tailnet.ts.net:22',
			'savedConnectionId=saved-1',
			'connectionId=active-1',
			'useTmux=true',
			'tmuxSessionName=main',
			'keyId=key-1',
		].join(' | '),
	);
});

type ListedConnectionDiagnosticEventKind =
	(typeof connectionDiagnosticEventKinds)[number];
type MissingConnectionDiagnosticEventKind = Exclude<
	ConnectionDiagnosticEvent['kind'],
	ListedConnectionDiagnosticEventKind
>;
type ExtraConnectionDiagnosticEventKind = Exclude<
	ListedConnectionDiagnosticEventKind,
	ConnectionDiagnosticEvent['kind']
>;
type ConnectionDiagnosticEventKindsExactlyCoverUnion = [
	MissingConnectionDiagnosticEventKind,
	ExtraConnectionDiagnosticEventKind,
] extends [never, never]
	? true
	: never;

const assertConnectionDiagnosticEventKindsExactlyCoverUnion: ConnectionDiagnosticEventKindsExactlyCoverUnion = true;
void assertConnectionDiagnosticEventKindsExactlyCoverUnion;
