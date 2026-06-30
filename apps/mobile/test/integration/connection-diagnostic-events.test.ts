import assert from 'node:assert/strict';
import test from 'node:test';
import {
	diagnosticEvents,
	type ConnectionDiagnosticEvent,
	type ManualDiagnosticTimeoutEvent,
} from '../../src/lib/connection-diagnostic-events';
import {
	diagnosticEvents as barrelDiagnosticEvents,
	type ConnectionDiagnosticEvent as BarrelConnectionDiagnosticEvent,
} from '../../src/lib/connection-diagnostics';

type DiagnosticEventConstructorKind = ReturnType<
	(typeof diagnosticEvents)[keyof typeof diagnosticEvents]
>['kind'];

type ExactDiagnosticEventConstructorCoverage = [
	Exclude<ConnectionDiagnosticEvent['kind'], DiagnosticEventConstructorKind>,
	Exclude<DiagnosticEventConstructorKind, ConnectionDiagnosticEvent['kind']>,
] extends [never, never]
	? true
	: false;

const assertExactDiagnosticEventConstructorCoverage: ExactDiagnosticEventConstructorCoverage = true;

const assertNoLegacyFields = (event: ConnectionDiagnosticEvent) => {
	assert.equal('details' in event, false);
	assert.equal('type' in event, false);
};

void test('diagnostic event constructors return typed event shapes', () => {
	const selected = diagnosticEvents.savedEntrySelected({
		source: 'manual-diagnostic',
		connection: {
			savedConnectionId: 'saved-1',
			username: 'muly',
			host: 'dev.tailnet.ts.net',
			port: 22,
			keyId: 'key-1',
			useTmux: true,
			tmuxSessionName: 'main',
		},
	});
	const started = diagnosticEvents.sshConnectStarted({
		source: 'saved-entry',
		connection: selected.connection,
	});
	const timeout = diagnosticEvents.manualDiagnosticTimeout({
		timeoutMs: 60_000,
		message: 'Connection diagnostic timed out after 60000ms',
	});
	const preciseTimeout: ManualDiagnosticTimeoutEvent = timeout;

	assert.equal(selected.kind, 'saved-entry.selected');
	assert.equal(started.kind, 'ssh.connect.started');
	assert.equal(preciseTimeout.kind, 'manual-diagnostic.timeout');
	assert.equal(preciseTimeout.timeoutMs, 60_000);

	const events: ConnectionDiagnosticEvent[] = [selected, started, timeout];
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'saved-entry.selected',
			'ssh.connect.started',
			'manual-diagnostic.timeout',
		],
	);
});

void test('normal diagnostic events do not expose generic details payloads', () => {
	const event = diagnosticEvents.keyResolved({
		source: 'manual-diagnostic',
		connection: {
			savedConnectionId: 'saved-1',
			host: 'dev.tailnet.ts.net',
		},
	});

	assert.equal('details' in event, false);
	assert.equal('type' in event, false);
});

void test('constructors ignore widened legacy event fields', () => {
	const legacyInput = {
		source: 'manual-diagnostic' as const,
		connection: {
			savedConnectionId: 'saved-1',
			host: 'dev.tailnet.ts.net',
		},
		kind: 'legacy.kind',
		type: 'legacy.type',
		details: { leaked: true },
	};

	const event = diagnosticEvents.keyResolved(legacyInput);

	assert.equal(event.kind, 'key.resolved');
	assertNoLegacyFields(event);
});

void test('constructors copy only allowed nested connection identity fields', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		connectionId: 'connection-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
		privateKey: 'must-not-leak',
		password: 'must-not-leak',
	};

	const selected = diagnosticEvents.savedEntrySelected({
		source: 'manual-diagnostic',
		connection,
	});
	const optional = diagnosticEvents.autoConnectSavedEntryConnectStarted({
		source: 'saved-entry',
		connection,
	});

	const expectedConnection = {
		savedConnectionId: 'saved-1',
		connectionId: 'connection-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	};
	assert.deepEqual(selected.connection, expectedConnection);
	assert.deepEqual(optional.connection, expectedConnection);
	assert.notEqual(selected.connection, connection);
	assert.notEqual(optional.connection, connection);
	assert.equal('privateKey' in selected.connection, false);
	assert.equal('password' in selected.connection, false);
	assert.equal('privateKey' in optional.connection, false);
	assert.equal('password' in optional.connection, false);
});

void test('constructors copy only allowed nested diagnostic error fields', () => {
	const inner = { code: 'ECONNRESET', secret: 'inner-is-intentionally-kept' };
	const error = {
		name: 'Error',
		message: 'Connection failed',
		stack: 'stack trace',
		tag: 'ssh-connect',
		inner,
		secret: 'must-not-leak',
		cause: { secret: 'must-not-leak' },
	};

	const event = diagnosticEvents.sshConnectFailed({
		source: 'manual-diagnostic',
		connection: {
			savedConnectionId: 'saved-1',
			host: 'dev.tailnet.ts.net',
		},
		error,
	});

	assert.deepEqual(event.error, {
		name: 'Error',
		message: 'Connection failed',
		stack: 'stack trace',
		tag: 'ssh-connect',
		inner,
	});
	assert.notEqual(event.error, error);
	assert.notEqual(event.error.inner, inner);
	inner.code = 'MUTATED';
	inner.secret = 'mutated';
	assert.deepEqual(event.error.inner, {
		code: 'ECONNRESET',
		secret: 'inner-is-intentionally-kept',
	});
	assert.doesNotThrow(() => JSON.stringify(event));
	assert.equal('secret' in event.error, false);
	assert.equal('cause' in event.error, false);
});

void test('diagnostic error inner snapshots are JSON-safe', () => {
	const circular: Record<string, unknown> = { code: 'ECONNRESET' };
	circular.self = circular;
	const arrayInner = [{ label: 'first' }, circular];
	const error = {
		name: 'Error',
		message: 'Connection failed',
		inner: {
			arrayInner,
			big: 10n,
			fn: function namedDiagnosticHelper() {
				return undefined;
			},
			symbol: Symbol('diagnostic'),
			date: new Date('2026-06-30T00:00:00.000Z'),
			nullValue: null,
		},
	};

	const event = diagnosticEvents.sshConnectFailed({
		source: 'manual-diagnostic',
		connection: { host: 'dev.tailnet.ts.net' },
		error,
	});

	arrayInner[0] = { label: 'mutated' };
	circular.code = 'MUTATED';

	assert.deepEqual(event.error.inner, {
		arrayInner: [
			{ label: 'first' },
			{
				code: 'ECONNRESET',
				self: '[Circular]',
			},
		],
		big: '10n',
		fn: '[Function namedDiagnosticHelper]',
		symbol: '[Symbol diagnostic]',
		date: '[object Date]',
		nullValue: null,
	});
	assert.doesNotThrow(() => JSON.stringify(event));
});

void test('diagnostic error inner snapshots tolerate hostile objects', () => {
	const hostile: Record<string, unknown> = {};
	Object.defineProperty(hostile, 'secret', {
		enumerable: true,
		get() {
			throw new Error('getter failed');
		},
	});
	const shared = { label: 'shared' };
	const inner = {
		hostile,
		first: shared,
		second: shared,
	};

	const event = diagnosticEvents.sshConnectFailed({
		source: 'manual-diagnostic',
		connection: { host: 'dev.tailnet.ts.net' },
		error: {
			name: 'Error',
			message: 'Connection failed',
			inner,
		},
	});

	assert.deepEqual(event.error.inner, {
		hostile: { secret: '[Unreadable]' },
		first: { label: 'shared' },
		second: { label: 'shared' },
	});
	assert.doesNotThrow(() => JSON.stringify(event));
});

void test('constructors copy only allowed nested Tailscale readiness result fields', () => {
	const readiness: {
		kind: 'failed';
		attempted: boolean;
		available: true;
		secret: string;
	} = {
		kind: 'failed',
		attempted: true,
		available: true,
		secret: 'must-not-leak',
	};

	const event = diagnosticEvents.tailscaleEnsureReadyResult({
		source: 'tailscale-recovery',
		platformOS: 'android',
		readiness,
	});
	readiness.attempted = false;
	readiness.secret = 'mutated';

	assert.deepEqual(event.readiness, {
		kind: 'failed',
		attempted: true,
		available: true,
	});
	assert.notEqual(event.readiness, readiness);
	assert.equal('secret' in event.readiness, false);
});

void test('constructors copy only allowed nested Tailscale recovery result fields', () => {
	const recoveryResult: {
		kind: 'nonNetworkFailure';
		attempted: false;
		networkLikeFailure: false;
		available: boolean;
		secret: string;
	} = {
		kind: 'nonNetworkFailure',
		attempted: false,
		networkLikeFailure: false,
		available: true,
		secret: 'must-not-leak',
	};

	const event = diagnosticEvents.tailscaleRecoveryResult({
		source: 'tailscale-recovery',
		recoveryResult,
	});
	recoveryResult.available = false;
	recoveryResult.secret = 'mutated';

	assert.deepEqual(event.recoveryResult, {
		kind: 'nonNetworkFailure',
		attempted: false,
		networkLikeFailure: false,
		available: true,
	});
	assert.notEqual(event.recoveryResult, recoveryResult);
	assert.equal('secret' in event.recoveryResult, false);
});

void test('constructors copy every Tailscale readiness result variant', () => {
	const readinessResults = [
		{ kind: 'unsupported', attempted: false, available: false },
		{ kind: 'unavailable', attempted: false, available: false },
		{ kind: 'ready', attempted: true, available: true },
		{ kind: 'cooldown', attempted: false, available: true },
		{ kind: 'notStarted', attempted: false, available: true },
		{ kind: 'failed', attempted: true, available: true },
	] as const;

	for (const readiness of readinessResults) {
		const widened = { ...readiness, secret: 'must-not-leak' };
		const event = diagnosticEvents.tailscaleEnsureReadyResult({
			source: 'tailscale-recovery',
			platformOS: 'android',
			readiness: widened,
		});

		assert.deepEqual(event.readiness, readiness);
		assert.notEqual(event.readiness, widened);
		assert.equal('secret' in event.readiness, false);
	}
});

void test('constructors copy every Tailscale recovery result variant', () => {
	const recoveryResults = [
		{
			kind: 'nonNetworkFailure',
			attempted: false,
			networkLikeFailure: false,
			available: false,
		},
		{
			kind: 'unsupported',
			attempted: false,
			networkLikeFailure: true,
			available: false,
		},
		{
			kind: 'unavailable',
			attempted: false,
			networkLikeFailure: true,
			available: false,
		},
		{
			kind: 'cooldown',
			attempted: false,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'notStarted',
			attempted: false,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'preflightReady',
			attempted: false,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'recovered',
			attempted: true,
			networkLikeFailure: true,
			available: true,
		},
		{
			kind: 'failed',
			attempted: true,
			networkLikeFailure: true,
			available: true,
		},
	] as const;

	for (const recoveryResult of recoveryResults) {
		const widened = { ...recoveryResult, secret: 'must-not-leak' };
		const event = diagnosticEvents.tailscaleRecoveryResult({
			source: 'tailscale-recovery',
			recoveryResult: widened,
		});

		assert.deepEqual(event.recoveryResult, recoveryResult);
		assert.notEqual(event.recoveryResult, widened);
		assert.equal('secret' in event.recoveryResult, false);
	}
});

void test('optional saved-entry constructors preserve omitted connections', () => {
	const error = { name: 'Error', message: 'failed' };
	const events = [
		diagnosticEvents.autoConnectSavedEntryConnectStarted({
			source: 'saved-entry',
		}),
		diagnosticEvents.autoConnectSavedEntryConnectFailed({
			source: 'saved-entry',
		}),
		diagnosticEvents.autoConnectSavedEntryConnectThrew({
			source: 'saved-entry',
			error,
		}),
		diagnosticEvents.autoConnectSavedEntryRetryStarted({
			source: 'saved-entry',
		}),
		diagnosticEvents.autoConnectSavedEntryRetryThrew({
			source: 'saved-entry',
			error,
		}),
	];

	for (const event of events) {
		assert.equal(event.connection, undefined);
	}
});

void test('connection diagnostics barrel exports diagnostic event helpers', () => {
	const event: BarrelConnectionDiagnosticEvent =
		barrelDiagnosticEvents.savedEntryMissing({ source: 'saved-entry' });

	assert.equal(event.kind, 'saved-entry.missing');
	assertNoLegacyFields(event);
});

void test('diagnostic event constructors cover every public event kind', () => {
	assert.equal(assertExactDiagnosticEventConstructorCoverage, true);

	const connection = {
		savedConnectionId: 'saved-1',
		connectionId: 'connection-1',
		username: 'muly',
		host: 'dev.tailnet.ts.net',
		port: 22,
		keyId: 'key-1',
		useTmux: true,
		tmuxSessionName: 'main',
	};
	const error = { name: 'Error', message: 'failed' };
	const events: ConnectionDiagnosticEvent[] = [
		diagnosticEvents.savedEntrySelected({
			source: 'saved-entry',
			connection,
		}),
		diagnosticEvents.savedEntryMissing({ source: 'saved-entry' }),
		diagnosticEvents.savedEntryInvalidTmuxSettings({
			source: 'saved-entry',
			connection,
			useTmuxType: 'string',
			tmuxSessionNameType: 'undefined',
		}),
		diagnosticEvents.keyResolved({ source: 'saved-entry', connection }),
		diagnosticEvents.keyMissing({ source: 'saved-entry', connection }),
		diagnosticEvents.sshConnectStarted({
			source: 'saved-entry',
			connection,
		}),
		diagnosticEvents.sshConnectProgress({
			source: 'saved-entry',
			connection,
			phase: 'auth',
		}),
		diagnosticEvents.sshConnectConnected({
			source: 'saved-entry',
			connection,
			storedConnectionId: 'stored-1',
		}),
		diagnosticEvents.sshConnectFailed({
			source: 'saved-entry',
			connection,
			error,
		}),
		diagnosticEvents.sshShellStarted({ source: 'saved-entry', connection }),
		diagnosticEvents.sshShellConnected({
			source: 'saved-entry',
			connection,
			channelId: 1,
			storedConnectionId: 'stored-1',
		}),
		diagnosticEvents.sshShellFailed({
			source: 'saved-entry',
			connection,
			error,
			storedConnectionId: 'stored-1',
		}),
		diagnosticEvents.sshShellTmuxAttachFailed({
			source: 'saved-entry',
			connection,
			error,
			tmuxAttachFailureReason: 'no-session',
			storedConnectionId: 'stored-1',
		}),
		diagnosticEvents.diagnosticDisconnected({
			source: 'manual-diagnostic',
			connection,
		}),
		diagnosticEvents.diagnosticDisconnectFailed({
			source: 'manual-diagnostic',
			connection,
			error,
		}),
		diagnosticEvents.tailscaleEnsureReadyResult({
			source: 'tailscale-recovery',
			platformOS: 'android',
			readiness: { kind: 'ready', attempted: true, available: true },
		}),
		diagnosticEvents.tailscaleRecoveryResult({
			source: 'tailscale-recovery',
			recoveryResult: {
				kind: 'recovered',
				attempted: true,
				networkLikeFailure: true,
				available: true,
			},
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.started',
			source: 'reconnect-controller',
			reason: 'network-failure',
			windowMs: 30_000,
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.stopped',
			source: 'reconnect-controller',
			reason: 'reconnected',
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.start.blocked',
			source: 'reconnect-controller',
			reason: 'already-running',
			isAutoConnecting: true,
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.retry.scheduled',
			source: 'reconnect-controller',
			attemptIndex: 1,
			delayMs: 1_000,
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.attempt.started',
			source: 'reconnect-controller',
			reconnectElapsedMs: 100,
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.attempt.connected',
			source: 'reconnect-controller',
			reconnectElapsedMs: 200,
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.attempt.failed',
			source: 'reconnect-controller',
			reconnectElapsedMs: 300,
		}),
		diagnosticEvents.reconnect({
			kind: 'reconnect.timeout',
			source: 'reconnect-controller',
			reconnectElapsedMs: 30_000,
			windowMs: 30_000,
		}),
		diagnosticEvents.manualDiagnosticSavedEntryMissing({
			source: 'manual-diagnostic',
		}),
		diagnosticEvents.manualDiagnosticTailscaleAttention({
			source: 'tailscale-recovery',
			message: 'Open Tailscale',
		}),
		diagnosticEvents.manualDiagnosticTailscaleAttentionCleared({
			source: 'tailscale-recovery',
		}),
		diagnosticEvents.manualDiagnosticTmuxAttachFailed({
			source: 'manual-diagnostic',
			connection,
			tmuxAttachFailureReason: 'no-session',
		}),
		diagnosticEvents.manualDiagnosticWarning({
			source: 'manual-diagnostic',
			message: 'warning',
			error,
		}),
		diagnosticEvents.manualDiagnosticTimeout({
			timeoutMs: 60_000,
			message: 'Connection diagnostic timed out after 60000ms',
		}),
		diagnosticEvents.manualDiagnosticFailed({
			source: 'manual-diagnostic',
			error,
		}),
		diagnosticEvents.autoConnectLatestShellSelected({
			source: 'latest-shell',
			connection,
			channelId: 1,
			pathname: '/shell/detail',
		}),
		diagnosticEvents.autoConnectLatestShellMissing({
			source: 'latest-shell',
			pathname: '/home',
		}),
		diagnosticEvents.autoConnectActiveConnectionSelected({
			source: 'active-connection',
			connection,
		}),
		diagnosticEvents.autoConnectActiveConnectionMissing({
			source: 'active-connection',
		}),
		diagnosticEvents.autoConnectActiveConnectionShellStarted({
			source: 'active-connection',
			connection,
		}),
		diagnosticEvents.autoConnectActiveConnectionShellConnected({
			source: 'active-connection',
			connection,
			channelId: 2,
		}),
		diagnosticEvents.autoConnectActiveConnectionShellFailed({
			source: 'active-connection',
			connection,
			error,
		}),
		diagnosticEvents.autoConnectActiveConnectionTmuxAttachFailed({
			source: 'active-connection',
			connection,
			error,
			tmuxAttachFailureReason: 'no-session',
			tmuxSessionName: 'main',
		}),
		diagnosticEvents.autoConnectSavedEntryConnectStarted({
			source: 'saved-entry',
			connection,
		}),
		diagnosticEvents.autoConnectSavedEntryConnectConnected({
			source: 'saved-entry',
			connection,
			connectionId: 'connection-1',
			channelId: 3,
		}),
		diagnosticEvents.autoConnectSavedEntryConnectFailed({
			source: 'saved-entry',
			connection,
		}),
		diagnosticEvents.autoConnectSavedEntryConnectThrew({
			source: 'saved-entry',
			connection,
			error,
		}),
		diagnosticEvents.autoConnectSavedEntryConnectTmuxAttachFailed({
			source: 'saved-entry',
			connection,
			connectionId: 'connection-1',
			tmuxAttachFailureReason: 'no-session',
			tmuxSessionName: 'main',
			storedConnectionId: 'stored-1',
		}),
		diagnosticEvents.autoConnectSavedEntryRetryStarted({
			source: 'saved-entry',
			connection,
		}),
		diagnosticEvents.autoConnectSavedEntryRetryThrew({
			source: 'saved-entry',
			connection,
			error,
		}),
	];

	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'saved-entry.selected',
			'saved-entry.missing',
			'saved-entry.invalid-tmux-settings',
			'key.resolved',
			'key.missing',
			'ssh.connect.started',
			'ssh.connect.progress',
			'ssh.connect.connected',
			'ssh.connect.failed',
			'ssh.shell.started',
			'ssh.shell.connected',
			'ssh.shell.failed',
			'ssh.shell.tmux-attach-failed',
			'ssh.diagnostic.disconnected',
			'ssh.diagnostic.disconnect-failed',
			'tailscale.ensure-ready.result',
			'tailscale.recovery.result',
			'reconnect.started',
			'reconnect.stopped',
			'reconnect.start.blocked',
			'reconnect.retry.scheduled',
			'reconnect.attempt.started',
			'reconnect.attempt.connected',
			'reconnect.attempt.failed',
			'reconnect.timeout',
			'manual-diagnostic.saved-entry.missing',
			'manual-diagnostic.tailscale.attention',
			'manual-diagnostic.tailscale.attention-cleared',
			'manual-diagnostic.tmux-attach-failed',
			'manual-diagnostic.warning',
			'manual-diagnostic.timeout',
			'manual-diagnostic.failed',
			'auto-connect.latest-shell.selected',
			'auto-connect.latest-shell.missing',
			'auto-connect.active-connection.selected',
			'auto-connect.active-connection.missing',
			'auto-connect.active-connection.shell-started',
			'auto-connect.active-connection.shell-connected',
			'auto-connect.active-connection.shell-failed',
			'auto-connect.active-connection.tmux-attach-failed',
			'auto-connect.saved-entry.connect.started',
			'auto-connect.saved-entry.connect.connected',
			'auto-connect.saved-entry.connect.failed',
			'auto-connect.saved-entry.connect.threw',
			'auto-connect.saved-entry.connect.tmux-attach-failed',
			'auto-connect.saved-entry.retry.started',
			'auto-connect.saved-entry.retry.threw',
		],
	);
	const eventKinds: string[] = events.map((event) => event.kind);
	assert.equal(
		eventKinds.includes('manual-diagnostic.saved-entry.selected'),
		false,
	);
	assert.equal(eventKinds.includes('manual-diagnostic.key-missing'), false);
	assert.equal(eventKinds.includes('auto-connect.source.latest-shell'), false);
	assert.equal(eventKinds.includes('auto-connect.saved-entry.selected'), false);
	for (const event of events) {
		assertNoLegacyFields(event);
	}

	const byKind = new Map(events.map((event) => [event.kind, event]));
	assert.deepEqual(byKind.get('saved-entry.invalid-tmux-settings'), {
		kind: 'saved-entry.invalid-tmux-settings',
		source: 'saved-entry',
		connection,
		useTmuxType: 'string',
		tmuxSessionNameType: 'undefined',
	});
	assert.deepEqual(byKind.get('ssh.shell.tmux-attach-failed'), {
		kind: 'ssh.shell.tmux-attach-failed',
		source: 'saved-entry',
		connection,
		error,
		tmuxAttachFailureReason: 'no-session',
		storedConnectionId: 'stored-1',
	});
	assert.deepEqual(byKind.get('tailscale.recovery.result'), {
		kind: 'tailscale.recovery.result',
		source: 'tailscale-recovery',
		message: undefined,
		recoveryResult: {
			kind: 'recovered',
			attempted: true,
			networkLikeFailure: true,
			available: true,
		},
	});
	assert.deepEqual(byKind.get('reconnect.timeout'), {
		kind: 'reconnect.timeout',
		source: 'reconnect-controller',
		message: undefined,
		reconnectElapsedMs: 30_000,
		windowMs: 30_000,
	});
	assert.deepEqual(byKind.get('manual-diagnostic.tailscale.attention'), {
		kind: 'manual-diagnostic.tailscale.attention',
		source: 'tailscale-recovery',
		message: 'Open Tailscale',
	});
	assert.deepEqual(
		byKind.get('auto-connect.active-connection.tmux-attach-failed'),
		{
			kind: 'auto-connect.active-connection.tmux-attach-failed',
			source: 'active-connection',
			message: undefined,
			connection,
			error,
			tmuxAttachFailureReason: 'no-session',
			tmuxSessionName: 'main',
		},
	);
	assert.deepEqual(byKind.get('auto-connect.saved-entry.connect.connected'), {
		kind: 'auto-connect.saved-entry.connect.connected',
		source: 'saved-entry',
		message: undefined,
		connection,
		connectionId: 'connection-1',
		channelId: 3,
		storedConnectionId: undefined,
	});
});

void test('canonical constructors replace legacy diagnostic event names', () => {
	const connection = {
		savedConnectionId: 'saved-1',
		host: 'dev.tailnet.ts.net',
	};

	const selected = diagnosticEvents.savedEntrySelected({
		source: 'manual-diagnostic',
		connection,
	});
	const keyMissing = diagnosticEvents.keyMissing({
		source: 'manual-diagnostic',
		connection,
	});
	const latestShellSelected = diagnosticEvents.autoConnectLatestShellSelected({
		source: 'latest-shell',
		connection,
		channelId: 1,
		pathname: '/shell/latest',
	});

	assert.equal(selected.kind, 'saved-entry.selected');
	assert.equal(selected.source, 'manual-diagnostic');
	assert.equal(keyMissing.kind, 'key.missing');
	assert.equal(keyMissing.source, 'manual-diagnostic');
	assert.equal(latestShellSelected.kind, 'auto-connect.latest-shell.selected');
});

void test('reconnect event durations use event-specific payload names', () => {
	const attemptInput = {
		kind: 'reconnect.attempt.started' as const,
		source: 'reconnect-controller' as const,
		reconnectElapsedMs: 100,
		elapsedMs: 999,
		type: 'legacy.type',
		details: { elapsedMs: 999 },
	};
	const attempt = diagnosticEvents.reconnect(attemptInput);

	assert.equal(attempt.kind, 'reconnect.attempt.started');
	assert.equal(attempt.reconnectElapsedMs, 100);
	assert.equal('elapsedMs' in attempt, false);
	assertNoLegacyFields(attempt);

	const timeoutInput = {
		kind: 'reconnect.timeout' as const,
		source: 'reconnect-controller' as const,
		reconnectElapsedMs: 30_000,
		elapsedMs: 999,
		windowMs: 30_000,
		type: 'legacy.type',
		details: { elapsedMs: 999, windowMs: 30_000 },
	};
	const timeout = diagnosticEvents.reconnect(timeoutInput);

	assert.equal(timeout.kind, 'reconnect.timeout');
	assert.equal(timeout.reconnectElapsedMs, 30_000);
	assert.equal(timeout.windowMs, 30_000);
	assert.equal('elapsedMs' in timeout, false);
	assertNoLegacyFields(timeout);
});

void test('later event group constructors copy only allowed payloads', () => {
	const reconnectInput = {
		kind: 'reconnect.retry.scheduled' as const,
		source: 'reconnect-controller' as const,
		attemptIndex: 2,
		delayMs: 1_000,
		type: 'legacy.type',
		details: { delayMs: 1_000 },
	};
	const reconnect = diagnosticEvents.reconnect(reconnectInput);

	assert.equal(reconnect.kind, 'reconnect.retry.scheduled');
	assert.equal(reconnect.delayMs, 1_000);
	assert.equal(reconnect.attemptIndex, 2);
	assertNoLegacyFields(reconnect);

	const manualDiagnosticInput = {
		source: 'manual-diagnostic' as const,
		message: 'Connection diagnostic failed',
		error: {
			name: 'Error',
			message: 'Connection diagnostic failed',
		},
		type: 'legacy.type',
		details: { leaked: true },
	};
	const manualDiagnostic = diagnosticEvents.manualDiagnosticFailed(
		manualDiagnosticInput,
	);

	assert.equal(manualDiagnostic.kind, 'manual-diagnostic.failed');
	assert.equal(manualDiagnostic.error.message, 'Connection diagnostic failed');
	assertNoLegacyFields(manualDiagnostic);

	const activeShellConnectedInput = {
		source: 'active-connection' as const,
		connection: {
			connectionId: 'active-1',
			host: 'dev.tailnet.ts.net',
		},
		channelId: 42,
		pathname: '/terminal/active-1',
		type: 'legacy.type',
		details: { channelId: 42 },
	};
	const activeShellConnected =
		diagnosticEvents.autoConnectActiveConnectionShellConnected(
			activeShellConnectedInput,
		);

	assert.equal(
		activeShellConnected.kind,
		'auto-connect.active-connection.shell-connected',
	);
	assert.equal(activeShellConnected.channelId, 42);
	assert.equal(activeShellConnected.pathname, '/terminal/active-1');
	assertNoLegacyFields(activeShellConnected);
});

void test('typed event variants narrow event-specific payloads', () => {
	const event: ConnectionDiagnosticEvent = diagnosticEvents.reconnect({
		kind: 'reconnect.retry.scheduled',
		source: 'reconnect-controller',
		attemptIndex: 1,
		delayMs: 500,
	});

	if (event.kind !== 'reconnect.retry.scheduled') {
		assert.fail('expected reconnect retry scheduled event');
	}

	const delayMs: number = event.delayMs;
	assert.equal(delayMs, 500);
});
