import assert from 'node:assert/strict';
import test from 'node:test';
import {
	autoConnectEvents,
	formatAutoConnectEventFields,
	connectionDiagnosticEventKinds,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics/events';

type UnsafeConnectionIdentity = ConnectionDiagnosticConnectionIdentity & {
	privateKey: string;
	password: string;
};

void test('auto-connect events own auto-connect saved-entry vocabulary', () => {
	const selected = autoConnectEvents.latestShellSelected({
		source: 'latest-shell',
		connection: { connectionId: 'conn-1' },
		channelId: 3,
		pathname: '/shell/detail',
	});
	const connected = autoConnectEvents.savedEntryConnectConnected({
		source: 'saved-entry',
		connection: { savedConnectionId: 'saved-1' },
		connectionId: 'conn-2',
		channelId: 4,
		storedConnectionId: 'stored-2',
	});
	const events: ConnectionDiagnosticEvent[] = [selected, connected];

	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'auto-connect.latest-shell.selected',
			'auto-connect.saved-entry.connect.connected',
		],
	);
	assert.ok(
		connectionDiagnosticEventKinds.includes(
			'auto-connect.saved-entry.connect.connected',
		),
	);
});

void test('auto-connect error events copy identity and serialize errors', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		connectionId: 'conn-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} as never;
	const error = {
		name: 'Error',
		message: 'shell failed',
		secret: 'must-not-copy',
		privateKey: 'must-not-copy',
	} as never;
	const activeConnectionFailed = autoConnectEvents.activeConnectionShellFailed({
		source: 'active-connection',
		connection,
		error,
		tmuxSessionName: 'main',
	});
	const savedEntryThrew = autoConnectEvents.savedEntryConnectThrew({
		source: 'saved-entry',
		connection,
		error: {
			name: 'Error',
			message: 'connect threw',
			secret: 'must-not-copy',
			privateKey: 'must-not-copy',
		} as never,
	});

	assert.deepEqual(activeConnectionFailed.connection, {
		savedConnectionId: 'saved-1',
		connectionId: 'conn-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.deepEqual(activeConnectionFailed.error, {
		name: 'Error',
		message: 'shell failed',
	});
	assert.equal('privateKey' in activeConnectionFailed.connection, false);
	assert.equal('password' in activeConnectionFailed.connection, false);
	assert.equal('secret' in activeConnectionFailed.error, false);
	assert.equal('privateKey' in activeConnectionFailed.error, false);

	assert.deepEqual(savedEntryThrew.connection, {
		savedConnectionId: 'saved-1',
		connectionId: 'conn-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.deepEqual(savedEntryThrew.error, {
		name: 'Error',
		message: 'connect threw',
	});
	assert.equal('privateKey' in savedEntryThrew.connection, false);
	assert.equal('password' in savedEntryThrew.connection, false);
	assert.equal('secret' in savedEntryThrew.error, false);
	assert.equal('privateKey' in savedEntryThrew.error, false);
});

void test('auto-connect tmux attach failures copy identity and serialize errors', () => {
	const connection = {
		connectionId: 'conn-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} satisfies UnsafeConnectionIdentity;
	const failed = autoConnectEvents.activeConnectionTmuxAttachFailed({
		source: 'active-connection',
		connection,
		error: {
			name: 'Error',
			message: 'tmux attach failed',
			secret: 'must-not-copy',
			privateKey: 'must-not-copy',
		},
		tmuxAttachFailureReason: 'session-missing',
		tmuxSessionName: 'main',
	});

	assert.deepEqual(failed.connection, {
		connectionId: 'conn-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.deepEqual(failed.error, {
		name: 'Error',
		message: 'tmux attach failed',
	});
	assert.equal('privateKey' in failed.connection, false);
	assert.equal('password' in failed.connection, false);
	assert.equal('secret' in failed.error, false);
	assert.equal('privateKey' in failed.error, false);
	assert.equal(failed.tmuxAttachFailureReason, 'session-missing');
	assert.equal(failed.tmuxSessionName, 'main');
});

void test('auto-connect saved-entry retry errors copy optional identity and serialize errors', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
		privateKey: 'must-not-copy',
		password: 'must-not-copy',
	} satisfies UnsafeConnectionIdentity;
	const retry = autoConnectEvents.savedEntryRetryThrew({
		source: 'saved-entry',
		connection,
		error: {
			name: 'Error',
			message: 'retry threw',
			secret: 'must-not-copy',
			privateKey: 'must-not-copy',
		},
	});

	assert.deepEqual(retry.connection, {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
	});
	assert.deepEqual(retry.error, {
		name: 'Error',
		message: 'retry threw',
	});
	assert.equal('privateKey' in retry.connection, false);
	assert.equal('password' in retry.connection, false);
	assert.equal('secret' in retry.error, false);
	assert.equal('privateKey' in retry.error, false);
});

void test('auto-connect optional saved-entry events preserve omitted connection as undefined', () => {
	const started = autoConnectEvents.savedEntryConnectStarted({
		source: 'saved-entry',
	});
	const failed = autoConnectEvents.savedEntryConnectFailed({
		source: 'saved-entry',
	});
	const threw = autoConnectEvents.savedEntryConnectThrew({
		source: 'saved-entry',
		error: new Error('connect threw'),
	});
	const retryStarted = autoConnectEvents.savedEntryRetryStarted({
		source: 'saved-entry',
	});
	const retryThrew = autoConnectEvents.savedEntryRetryThrew({
		source: 'saved-entry',
		error: new Error('retry threw'),
	});

	assert.equal(started.connection, undefined);
	assert.equal(failed.connection, undefined);
	assert.equal(threw.connection, undefined);
	assert.equal(retryStarted.connection, undefined);
	assert.equal(retryThrew.connection, undefined);
});

void test('saved-entry connect events carry reconnect trigger and tmux metadata', () => {
	const started = autoConnectEvents.savedEntryConnectStarted({
		source: 'saved-entry',
		trigger: 'reconnect',
		connection: {
			connectionId: 'stored-host-1',
			username: 'muly',
			host: 'dev-host',
			port: 22,
		},
		tmuxSessionName: 'main',
	});
	const failed = autoConnectEvents.savedEntryConnectFailed({
		source: 'saved-entry',
		trigger: 'reconnect',
		connectionId: 'conn-2',
		storedConnectionId: 'stored-host-1',
		failureClass: 'failedNetwork',
		message: 'network failure',
	});

	assert.equal(started.trigger, 'reconnect');
	assert.equal(started.tmuxSessionName, 'main');
	assert.equal(started.connection?.host, 'dev-host');
	assert.equal(failed.failureClass, 'failedNetwork');
});

void test('saved-entry connect events accept auto-connect trigger and format it', () => {
	const started = autoConnectEvents.savedEntryConnectStarted({
		source: 'saved-entry',
		trigger: 'auto-connect',
		connection: {
			connectionId: 'stored-host-2',
			host: 'dev-host-2',
			port: 2222,
		},
		message: 'starting saved-entry auto-connect',
	});

	assert.equal(started.trigger, 'auto-connect');
	assert.deepEqual(formatAutoConnectEventFields(started), [
		'trigger=auto-connect',
		'host=dev-host-2',
		'port=2222',
	]);
});

void test('saved-entry metadata formatter covers added event kinds', () => {
	const connected = autoConnectEvents.savedEntryConnectConnected({
		source: 'saved-entry',
		connection: {
			savedConnectionId: 'saved-1',
			connectionId: 'conn-1',
			host: 'dev-host',
			port: 22,
		},
		connectionId: 'conn-1',
		channelId: 4,
		storedConnectionId: 'stored-1',
		trigger: 'reconnect',
		tmuxSessionName: 'main',
		failureClass: 'failedNetwork',
	});
	const failed = autoConnectEvents.savedEntryConnectFailed({
		source: 'saved-entry',
		connectionId: 'conn-2',
		storedConnectionId: 'stored-2',
		trigger: 'reconnect',
		host: 'failed-host',
		port: 2022,
		tmuxSessionName: 'ops',
		failureClass: 'failedAuth',
	});
	const tmuxAttachFailed = autoConnectEvents.savedEntryConnectTmuxAttachFailed({
		source: 'saved-entry',
		connection: {
			savedConnectionId: 'saved-3',
			connectionId: 'conn-3',
			host: 'tmux-host',
			port: 2200,
		},
		connectionId: 'conn-3',
		tmuxAttachFailureReason: 'session-missing',
		tmuxSessionName: 'shared',
		storedConnectionId: 'stored-3',
		trigger: 'manual-diagnostic',
		failureClass: 'failedTmuxAttach',
	});
	const started = autoConnectEvents.savedEntryConnectStarted({
		source: 'saved-entry',
		trigger: 'manual-diagnostic',
		host: 'start-host',
		port: 2223,
		tmuxSessionName: 'diag',
		failureClass: 'failedNetwork',
	});
	const retryStarted = autoConnectEvents.savedEntryRetryStarted({
		source: 'saved-entry',
		trigger: 'reconnect',
		host: 'retry-host',
		port: 2224,
		tmuxSessionName: 'retry',
		failureClass: 'timeout',
	});
	const threw = autoConnectEvents.savedEntryConnectThrew({
		source: 'saved-entry',
		error: new Error('connect threw'),
		trigger: 'manual-diagnostic',
		host: 'throw-host',
		port: 2225,
		tmuxSessionName: 'throw',
		failureClass: 'startupFailed',
	});
	const retryThrew = autoConnectEvents.savedEntryRetryThrew({
		source: 'saved-entry',
		error: new Error('retry threw'),
		trigger: 'reconnect',
		host: 'retry-throw-host',
		port: 2226,
		tmuxSessionName: 'retry-throw',
		failureClass: 'cleanupFailed',
	});

	assert.deepEqual(formatAutoConnectEventFields(connected), [
		'connectionId=conn-1',
		'channelId=4',
		'trigger=reconnect',
		'storedConnectionId=stored-1',
		'host=dev-host',
		'port=22',
		'tmuxSessionName=main',
		'failureClass=failedNetwork',
	]);
	assert.deepEqual(formatAutoConnectEventFields(failed), [
		'trigger=reconnect',
		'connectionId=conn-2',
		'storedConnectionId=stored-2',
		'host=failed-host',
		'port=2022',
		'tmuxSessionName=ops',
		'failureClass=failedAuth',
	]);
	assert.deepEqual(formatAutoConnectEventFields(tmuxAttachFailed), [
		'connectionId=conn-3',
		'trigger=manual-diagnostic',
		'tmuxAttachFailureReason=session-missing',
		'tmuxSessionName=shared',
		'storedConnectionId=stored-3',
		'host=tmux-host',
		'port=2200',
		'failureClass=failedTmuxAttach',
	]);
	assert.deepEqual(formatAutoConnectEventFields(started), [
		'trigger=manual-diagnostic',
		'host=start-host',
		'port=2223',
		'tmuxSessionName=diag',
		'failureClass=failedNetwork',
	]);
	assert.deepEqual(formatAutoConnectEventFields(retryStarted), [
		'trigger=reconnect',
		'host=retry-host',
		'port=2224',
		'tmuxSessionName=retry',
		'failureClass=timeout',
	]);
	assert.deepEqual(formatAutoConnectEventFields(threw), [
		'trigger=manual-diagnostic',
		'host=throw-host',
		'port=2225',
		'tmuxSessionName=throw',
		'failureClass=startupFailed',
	]);
	assert.deepEqual(formatAutoConnectEventFields(retryThrew), [
		'trigger=reconnect',
		'host=retry-throw-host',
		'port=2226',
		'tmuxSessionName=retry-throw',
		'failureClass=cleanupFailed',
	]);
});
