import assert from 'node:assert/strict';
import test from 'node:test';
import {
	autoConnectEvents,
	formatConnectionDiagnosticPrompt,
	manualDiagnosticEvents,
	reconnectEvents,
	savedEntryEvents,
	sshEvents,
	tailscaleDiagnosticEvents,
	type ConnectionDiagnosticTrace,
} from '../../src/lib/connection-diagnostics';

void test('prompt renders typed event timeline and app state', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-1',
		trigger: 'manual-diagnostic',
		reason: 'command-menu',
		status: 'failed',
		startedAtMs: 100,
		finishedAtMs: 150,
		events: [
			{
				...savedEntryEvents.selected({
					source: 'manual-diagnostic',
					connection: {
						savedConnectionId: 'saved-1',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
						useTmux: true,
						tmuxSessionName: 'main',
					},
				}),
				atMs: 110,
				elapsedMs: 10,
			},
			{
				...sshEvents.connectFailed({
					source: 'saved-entry',
					connection: { host: 'dev.tailnet.ts.net' },
					error: { name: 'Error', message: 'connection refused' },
				}),
				atMs: 140,
				elapsedMs: 40,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace, {
		appState: {
			platformOS: 'android',
			isAutoConnecting: false,
			isReconnecting: false,
			pathname: '/shell/detail',
			foregroundServiceStarted: true,
			backgroundWorkAllowed: true,
			foregroundServiceRequired: false,
			appActive: true,
		},
	});

	assert.match(prompt, /Debug this Fressh mobile SSH connection failure/);
	assert.match(prompt, /platformOS: android/);
	assert.match(prompt, /isAutoConnecting: false/);
	assert.match(prompt, /isReconnecting: false/);
	assert.match(prompt, /pathname: \/shell\/detail/);
	assert.match(prompt, /foregroundServiceStarted: true/);
	assert.match(prompt, /backgroundWorkAllowed: true/);
	assert.match(prompt, /foregroundServiceRequired: false/);
	assert.match(prompt, /appActive: true/);
	assert.match(prompt, /selected connection/i);
	assert.match(prompt, /dev\.tailnet\.ts\.net/);
	assert.match(prompt, /ssh\.connect\.failed/);
	assert.match(prompt, /connection refused/);
	assert.match(prompt, /Private key material has been omitted/);
});

void test('prompt preserves personal diagnostic tokens but omits private key blocks', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-token',
		trigger: 'manual-diagnostic',
		reason: 'token=abc is useful context',
		status: 'failed',
		startedAtMs: 100,
		events: [
			{
				...manualDiagnosticEvents.failed({
					source: 'manual-diagnostic',
					error: {
						name: 'Error',
						message: [
							'-----BEGIN OPENSSH PRIVATE KEY-----',
							'secret',
							'-----END OPENSSH PRIVATE KEY-----',
						].join('\n'),
					},
				}),
				atMs: 100,
				elapsedMs: 0,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);
	assert.match(prompt, /token=abc is useful context/);
	assert.doesNotMatch(prompt, /secret/);
	assert.match(
		prompt,
		/PRIVATE KEY OMITTED|Private key material has been omitted|Private key material omitted/,
	);
});

void test('prompt selects the richest later connection identity', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-richer-identity',
		trigger: 'manual-diagnostic',
		reason: 'identity-selection',
		status: 'failed',
		startedAtMs: 100,
		finishedAtMs: 180,
		events: [
			{
				...savedEntryEvents.selected({
					source: 'saved-entry',
					connection: {
						savedConnectionId: 'saved-22',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
					},
				}),
				atMs: 100,
				elapsedMs: 0,
			},
			{
				...savedEntryEvents.selected({
					source: 'active-connection',
					connection: {
						savedConnectionId: 'saved-22',
						connectionId: 'connection-9',
						username: 'muly',
						host: 'dev.tailnet.ts.net',
						port: 22,
						keyId: 'key-9',
						useTmux: true,
						tmuxSessionName: 'workspace',
					},
				}),
				atMs: 140,
				elapsedMs: 40,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);
	const selectedConnectionLine = prompt
		.split('\n')
		.find((line) => line.startsWith('Selected connection: '));

	assert.equal(
		selectedConnectionLine,
		'Selected connection: muly@dev.tailnet.ts.net:22 | savedConnectionId=saved-22 | connectionId=connection-9 | useTmux=true | tmuxSessionName=workspace | keyId=key-9',
	);
});

void test('prompt renders event-specific typed diagnostic fields', () => {
	const baseConnection = {
		host: 'dev.tailnet.ts.net',
		username: 'muly',
		port: 22,
	};
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-event-specifics',
		trigger: 'manual-diagnostic',
		reason: 'specifics',
		status: 'failed',
		startedAtMs: 1000,
		events: [
			{
				...manualDiagnosticEvents.timeout({
					message: 'Diagnostic timed out',
					timeoutMs: 15000,
				}),
				atMs: 1010,
				elapsedMs: 10,
			},
			{
				...sshEvents.shellConnected({
					source: 'saved-entry',
					connection: baseConnection,
					channelId: 7,
					storedConnectionId: 'stored-shell',
				}),
				atMs: 1020,
				elapsedMs: 20,
			},
			{
				...sshEvents.shellTmuxAttachFailed({
					source: 'saved-entry',
					connection: baseConnection,
					error: { name: 'TmuxError', message: 'attach failed' },
					tmuxAttachFailureReason: 'missing-session',
					storedConnectionId: 'stored-tmux',
				}),
				atMs: 1030,
				elapsedMs: 30,
			},
			{
				...tailscaleDiagnosticEvents.ensureReadyResult({
					source: 'manual-diagnostic',
					platformOS: 'android',
					readiness: {
						kind: 'ready',
						attempted: true,
						available: true,
					},
				}),
				atMs: 1040,
				elapsedMs: 40,
			},
			{
				...tailscaleDiagnosticEvents.recoveryResult({
					source: 'tailscale-recovery',
					recoveryResult: {
						kind: 'recovered',
						attempted: true,
						networkLikeFailure: true,
						available: true,
					},
				}),
				atMs: 1050,
				elapsedMs: 50,
			},
			{
				...autoConnectEvents.savedEntryConnectConnected({
					source: 'saved-entry',
					connection: baseConnection,
					connectionId: 'saved-entry-1',
					channelId: 11,
					storedConnectionId: 'stored-auto',
				}),
				atMs: 1060,
				elapsedMs: 60,
			},
			{
				...autoConnectEvents.activeConnectionTmuxAttachFailed({
					source: 'active-connection',
					connection: baseConnection,
					error: { name: 'TmuxError', message: 'active attach failed' },
					tmuxAttachFailureReason: 'session-exited',
					tmuxSessionName: 'workspace',
				}),
				atMs: 1070,
				elapsedMs: 70,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);

	for (const expected of [
		'timeoutMs=15000',
		'channelId=7',
		'storedConnectionId=stored-shell',
		'tmuxAttachFailureReason=missing-session',
		'storedConnectionId=stored-tmux',
		'platformOS=android',
		'"kind": "ready"',
		'recoveryResult={',
		'"kind": "recovered"',
		'connectionId=saved-entry-1',
		'channelId=11',
		'storedConnectionId=stored-auto',
		'tmuxAttachFailureReason=session-exited',
		'tmuxSessionName=workspace',
	]) {
		assert.match(
			prompt,
			new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
		);
	}
	assert.doesNotMatch(prompt, /undefined/);
});

void test('prompt renders fields through domain formatters', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-domain-formatters',
		trigger: 'manual-diagnostic',
		reason: 'domain formatter fields',
		status: 'connected',
		startedAtMs: 100,
		events: [
			{
				...autoConnectEvents.savedEntryConnectConnected({
					source: 'saved-entry',
					connection: { savedConnectionId: 'saved-1' },
					connectionId: 'connection-1',
					channelId: 9,
					storedConnectionId: 'stored-1',
				}),
				atMs: 110,
				elapsedMs: 10,
			},
			{
				...tailscaleDiagnosticEvents.recoveryResult({
					source: 'tailscale-recovery',
					recoveryResult: {
						kind: 'recovered',
						attempted: true,
						networkLikeFailure: true,
						available: true,
					},
				}),
				atMs: 120,
				elapsedMs: 20,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);

	assert.match(prompt, /auto-connect.saved-entry.connect.connected/);
	assert.match(prompt, /connectionId=connection-1/);
	assert.match(prompt, /channelId=9/);
	assert.match(prompt, /storedConnectionId=stored-1/);
	assert.match(prompt, /tailscale.recovery.result/);
	assert.match(prompt, /recoveryResult=/);
});

void test('prompt renders saved-entry and reconnect domain fields', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-saved-entry-reconnect-formatters',
		trigger: 'reconnect',
		reason: 'formatter coverage',
		status: 'failed',
		startedAtMs: 2000,
		events: [
			{
				...savedEntryEvents.invalidTmuxSettings({
					source: 'saved-entry',
					connection: { savedConnectionId: 'saved-1' },
					useTmuxType: 'string',
					tmuxSessionNameType: 'number',
				}),
				atMs: 2010,
				elapsedMs: 10,
			},
			{
				...reconnectEvents.started({
					source: 'reconnect-controller',
					reason: 'network down',
					windowMs: 30000,
				}),
				atMs: 2020,
				elapsedMs: 20,
			},
			{
				...reconnectEvents.startBlocked({
					source: 'reconnect-controller',
					reason: 'already running',
					isAutoConnecting: true,
					isReconnecting: false,
					resetInFlight: true,
				}),
				atMs: 2030,
				elapsedMs: 30,
			},
			{
				...reconnectEvents.stopped({
					source: 'reconnect-controller',
					reason: 'manual stop',
				}),
				atMs: 2035,
				elapsedMs: 35,
			},
			{
				...reconnectEvents.retryScheduled({
					source: 'reconnect-controller',
					attemptIndex: 2,
					delayMs: 1500,
				}),
				atMs: 2040,
				elapsedMs: 40,
			},
			{
				...reconnectEvents.attemptFailed({
					source: 'reconnect-controller',
					reconnectElapsedMs: 4200,
				}),
				atMs: 2050,
				elapsedMs: 50,
			},
			{
				...reconnectEvents.timeout({
					source: 'reconnect-controller',
					reconnectElapsedMs: 30000,
					windowMs: 30000,
				}),
				atMs: 2060,
				elapsedMs: 60,
			},
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);

	for (const expected of [
		'useTmuxType=string',
		'tmuxSessionNameType=number',
		'reason=network down',
		'windowMs=30000',
		'reason=already running',
		'isAutoConnecting=true',
		'isReconnecting=false',
		'resetInFlight=true',
		'reason=manual stop',
		'attemptIndex=2',
		'delayMs=1500',
		'reconnectElapsedMs=4200',
		'reconnectElapsedMs=30000',
	]) {
		assert.match(
			prompt,
			new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
		);
	}
});

void test('prompt does not render generic details fields', () => {
	const trace: ConnectionDiagnosticTrace = {
		id: 'trace-no-generic-details',
		trigger: 'manual-diagnostic',
		reason: 'typed fields only',
		status: 'skipped',
		startedAtMs: 100,
		events: [
			{
				...savedEntryEvents.missing({
					source: 'manual-diagnostic',
					message: 'No saved entry',
				}),
				details: { legacyType: 'saved-entry.missing' },
				atMs: 100,
				elapsedMs: 0,
			} as ConnectionDiagnosticTrace['events'][number],
		],
	};

	const prompt = formatConnectionDiagnosticPrompt(trace);

	assert.doesNotMatch(prompt, /details=/);
	assert.doesNotMatch(prompt, /legacyType/);
});
