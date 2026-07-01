import assert from 'node:assert/strict';
import test from 'node:test';
import {
	manualDiagnosticEvents,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

type UnsafeConnectionIdentity = ConnectionDiagnosticConnectionIdentity & {
	privateKey: string;
	password: string;
};

void test('manual diagnostic events stay in the manual domain', () => {
	const timeout = manualDiagnosticEvents.timeout({
		timeoutMs: 60_000,
		message: 'Connection diagnostic timed out after 60000ms',
	});
	const failed = manualDiagnosticEvents.failed({
		source: 'manual-diagnostic',
		error: { name: 'Error', message: 'failed' },
	});
	const events: ConnectionDiagnosticEvent[] = [timeout, failed];

	assert.deepEqual(
		events.map((event) => event.kind),
		['manual-diagnostic.timeout', 'manual-diagnostic.failed'],
	);
});

void test('manual diagnostic error events serialize errors', () => {
	const failed = manualDiagnosticEvents.failed({
		source: 'manual-diagnostic',
		error: {
			name: 'Error',
			message: 'failed',
			secret: 'must-not-copy',
			privateKey: 'must-not-copy',
		} as never,
	});

	assert.deepEqual(failed.error, {
		name: 'Error',
		message: 'failed',
	});
	assert.equal('secret' in failed.error, false);
	assert.equal('privateKey' in failed.error, false);
});

void test('manual diagnostic warnings serialize errors', () => {
	const warning = manualDiagnosticEvents.warning({
		source: 'manual-diagnostic',
		message: 'warning',
		error: {
			name: 'Error',
			message: 'warning failed',
			secret: 'must-not-copy',
			privateKey: 'must-not-copy',
		},
	});

	assert.deepEqual(warning.error, {
		name: 'Error',
		message: 'warning failed',
	});
	assert.equal('secret' in warning.error, false);
	assert.equal('privateKey' in warning.error, false);
});

void test('manual diagnostic tmux attach failures copy identity', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} satisfies UnsafeConnectionIdentity;
	const failed = manualDiagnosticEvents.tmuxAttachFailed({
		source: 'manual-diagnostic',
		connection,
		tmuxAttachFailureReason: 'session-missing',
	});

	assert.deepEqual(failed.connection, {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.equal('privateKey' in failed.connection, false);
	assert.equal('password' in failed.connection, false);
	assert.equal(failed.tmuxAttachFailureReason, 'session-missing');
});
