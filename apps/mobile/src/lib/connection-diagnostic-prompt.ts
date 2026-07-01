import { normalizeLegacyTraceForPrompt } from './connection-diagnostic-normalization';
import {
	cloneDiagnosticValue,
	normalizeConnectionIdentity,
	omitPrivateKeyMaterial,
	safeDiagnosticString,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticPromptOptions,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';

function formatConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): string {
	const normalizedConnection = normalizeConnectionIdentity(connection);
	if (!normalizedConnection) return 'unknown connection';

	const username = normalizedConnection.username?.trim();
	const host = normalizedConnection.host?.trim();
	const port = normalizedConnection.port;
	const address =
		username && host && typeof port === 'number'
			? `${username}@${host}:${port}`
			: host;
	const parts = [
		address ? safeDiagnosticString(address) : null,
		normalizedConnection.savedConnectionId
			? `savedConnectionId=${safeDiagnosticString(
					normalizedConnection.savedConnectionId.trim(),
				)}`
			: null,
		normalizedConnection.connectionId
			? `connectionId=${safeDiagnosticString(
					normalizedConnection.connectionId.trim(),
				)}`
			: null,
		typeof normalizedConnection.useTmux === 'boolean'
			? `useTmux=${String(normalizedConnection.useTmux)}`
			: null,
		normalizedConnection.tmuxSessionName
			? `tmuxSessionName=${safeDiagnosticString(
					normalizedConnection.tmuxSessionName.trim(),
				)}`
			: null,
		normalizedConnection.keyId
			? `keyId=${safeDiagnosticString(normalizedConnection.keyId.trim())}`
			: null,
	];

	return parts.filter(Boolean).join(' | ') || 'unknown connection';
}

function readConnection(
	event: ConnectionDiagnosticTimedEvent,
): ConnectionDiagnosticConnectionIdentity | undefined {
	return 'connection' in event
		? normalizeConnectionIdentity(event.connection)
		: undefined;
}

function readError(event: ConnectionDiagnosticTimedEvent):
	| {
			name: string;
			message: string;
			tag?: string;
			stack?: string;
			inner?: unknown;
	  }
	| undefined {
	return 'error' in event ? event.error : undefined;
}

function readDetails(event: ConnectionDiagnosticTimedEvent): unknown {
	return 'details' in event ? event.details : undefined;
}

function formatJsonInline(value: unknown): string {
	return JSON.stringify(cloneDiagnosticValue(value), null, 2).replace(
		/\n/g,
		' ',
	);
}

function findPrimaryConnectionIdentity(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticConnectionIdentity | undefined {
	let selectedConnection: ConnectionDiagnosticConnectionIdentity | undefined;
	let selectedScore = -1;

	for (const event of trace.events) {
		const connection = readConnection(event);
		if (!connection) continue;

		const score = [
			connection.savedConnectionId?.trim(),
			connection.connectionId?.trim(),
			connection.username?.trim(),
			connection.host?.trim(),
			typeof connection.port === 'number' ? String(connection.port) : undefined,
			connection.keyId?.trim(),
			typeof connection.useTmux === 'boolean'
				? String(connection.useTmux)
				: undefined,
			connection.tmuxSessionName?.trim(),
		].filter(Boolean).length;

		if (score >= selectedScore) {
			selectedConnection = connection;
			selectedScore = score;
		}
	}

	return selectedConnection;
}

function formatError(event: ConnectionDiagnosticTimedEvent): string | null {
	const error = readError(event);
	if (!error) return null;

	const parts = [
		`error=${safeDiagnosticString(error.name)}: ${safeDiagnosticString(
			error.message,
		)}`,
		error.tag ? `errorTag=${safeDiagnosticString(error.tag)}` : null,
		error.stack
			? `errorStack=${safeDiagnosticString(error.stack).replace(/\n/g, ' ')}`
			: null,
		error.inner !== undefined
			? `errorInner=${formatJsonInline(error.inner)}`
			: null,
	];

	return parts.filter(Boolean).join(' | ');
}

function formatEventSpecifics(event: ConnectionDiagnosticTimedEvent): string[] {
	switch (event.kind) {
		case 'manual-diagnostic.timeout':
			return [`timeoutMs=${event.timeoutMs}`];
		case 'ssh.shell.connected':
			return [
				`channelId=${event.channelId}`,
				`storedConnectionId=${event.storedConnectionId}`,
			];
		case 'ssh.connect.connected':
			return [`storedConnectionId=${event.storedConnectionId}`];
		case 'ssh.shell.tmux-attach-failed':
			return [
				`tmuxAttachFailureReason=${event.tmuxAttachFailureReason ?? 'unknown'}`,
				`storedConnectionId=${event.storedConnectionId}`,
			];
		case 'ssh.shell.failed':
			return [`storedConnectionId=${event.storedConnectionId}`];
		case 'tailscale.ensure-ready.result':
			return [
				`platformOS=${event.platformOS}`,
				`readiness=${formatJsonInline(event.readiness)}`,
			];
		case 'tailscale.recovery.result':
			return [`recoveryResult=${formatJsonInline(event.recoveryResult)}`];
		case 'auto-connect.latest-shell.selected':
			return [
				...(typeof event.channelId === 'number'
					? [`channelId=${event.channelId}`]
					: []),
				...(event.pathname
					? [`pathname=${safeDiagnosticString(event.pathname)}`]
					: []),
			];
		case 'auto-connect.latest-shell.missing':
			return [`pathname=${safeDiagnosticString(event.pathname)}`];
		case 'auto-connect.active-connection.shell-connected':
			return [
				`channelId=${event.channelId}`,
				...(event.pathname
					? [`pathname=${safeDiagnosticString(event.pathname)}`]
					: []),
			];
		case 'auto-connect.active-connection.shell-failed':
			return event.tmuxSessionName
				? [`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`]
				: [];
		case 'auto-connect.active-connection.tmux-attach-failed':
			return [
				`tmuxAttachFailureReason=${event.tmuxAttachFailureReason ?? 'unknown'}`,
				`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`,
			];
		case 'auto-connect.saved-entry.connect.connected':
			return [
				`connectionId=${safeDiagnosticString(event.connectionId)}`,
				`channelId=${event.channelId}`,
				...(event.storedConnectionId
					? [
							`storedConnectionId=${safeDiagnosticString(
								event.storedConnectionId,
							)}`,
						]
					: []),
			];
		case 'auto-connect.saved-entry.connect.failed':
			return [
				...(event.connectionId
					? [`connectionId=${safeDiagnosticString(event.connectionId)}`]
					: []),
				...(event.storedConnectionId
					? [
							`storedConnectionId=${safeDiagnosticString(
								event.storedConnectionId,
							)}`,
						]
					: []),
			];
		case 'auto-connect.saved-entry.connect.tmux-attach-failed':
			return [
				`connectionId=${safeDiagnosticString(event.connectionId)}`,
				`tmuxAttachFailureReason=${event.tmuxAttachFailureReason ?? 'unknown'}`,
				`tmuxSessionName=${safeDiagnosticString(event.tmuxSessionName)}`,
				`storedConnectionId=${safeDiagnosticString(event.storedConnectionId)}`,
			];
		default:
			return [];
	}
}

function formatEvent(event: ConnectionDiagnosticTimedEvent): string {
	const error = formatError(event);
	const details = readDetails(event);
	const connection = readConnection(event);
	const parts = [
		`- +${event.elapsedMs}ms ${event.kind}`,
		`source=${event.source}`,
		'message' in event && event.message
			? `message=${safeDiagnosticString(event.message)}`
			: null,
		connection ? `connection=${formatConnectionIdentity(connection)}` : null,
		error,
		...formatEventSpecifics(event),
		details !== undefined ? `details=${formatJsonInline(details)}` : null,
	];

	return omitPrivateKeyMaterial(parts.filter(Boolean).join(' | '));
}

function formatAppState(options: ConnectionDiagnosticPromptOptions): string[] {
	const state = options.appState;
	if (!state) return [];

	const lines = [
		'App state:',
		`- platformOS: ${safeDiagnosticString(state.platformOS)}`,
		`- isAutoConnecting: ${String(state.isAutoConnecting)}`,
		`- isReconnecting: ${String(state.isReconnecting)}`,
	];

	if (state.pathname !== undefined) {
		lines.push(`- pathname: ${safeDiagnosticString(state.pathname)}`);
	}
	if (state.foregroundServiceStarted !== undefined) {
		lines.push(
			`- foregroundServiceStarted: ${String(state.foregroundServiceStarted)}`,
		);
	}
	if (state.backgroundWorkAllowed !== undefined) {
		lines.push(
			`- backgroundWorkAllowed: ${String(state.backgroundWorkAllowed)}`,
		);
	}
	if (state.foregroundServiceRequired !== undefined) {
		lines.push(
			`- foregroundServiceRequired: ${String(state.foregroundServiceRequired)}`,
		);
	}
	if (state.appActive !== undefined) {
		lines.push(`- appActive: ${String(state.appActive)}`);
	}

	return lines;
}

export function formatConnectionDiagnosticPrompt(
	trace: ConnectionDiagnosticTrace,
	options: ConnectionDiagnosticPromptOptions = {},
): string {
	try {
		const safeTrace = normalizeLegacyTraceForPrompt(trace);
		const appState = formatAppState(options);
		const connection = findPrimaryConnectionIdentity(safeTrace);
		const failure = [...safeTrace.events]
			.reverse()
			.find((event) => readError(event) || event.kind.includes('failed'));
		const lines = [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace:',
			`- traceId: ${safeDiagnosticString(safeTrace.id)}`,
			`- trigger: ${safeTrace.trigger}`,
			`- reason: ${safeDiagnosticString(safeTrace.reason)}`,
			`- status: ${safeTrace.status}`,
			`- startedAtMs: ${safeTrace.startedAtMs}`,
			`- finishedAtMs: ${safeTrace.finishedAtMs ?? 'not-finished'}`,
			'',
			`Selected connection: ${formatConnectionIdentity(connection)}`,
			'',
			...appState,
			...(appState.length ? [''] : []),
			'Failure summary:',
			failure ? formatEvent(failure) : '- no failure event recorded',
			'',
			'Timeline:',
			...safeTrace.events.map((event) => formatEvent(event)),
			'',
			'Private key material has been omitted from this diagnostic trace.',
			'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
		];

		return omitPrivateKeyMaterial(lines.join('\n'));
	} catch (error) {
		return [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace:',
			'- traceId: unknown-trace',
			'- trigger: manual-diagnostic',
			`- reason: ${safeDiagnosticString(error)}`,
			'- status: failed',
			'',
			'Selected connection: unknown connection',
			'',
			'Failure summary:',
			'- prompt formatting failed',
			'',
			'Timeline:',
			'- prompt formatting failed',
			'',
			'Private key material has been omitted from this diagnostic trace.',
			'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
		].join('\n');
	}
}
