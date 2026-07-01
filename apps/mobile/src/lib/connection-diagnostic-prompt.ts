import {
	formatConnectionDiagnosticEventFields,
	formatConnectionIdentity,
	formatDiagnosticJsonInline,
	normalizeConnectionIdentity,
	omitPrivateKeyMaterial,
	safeDiagnosticString,
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticPromptOptions,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostics/events';

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
			? `errorInner=${formatDiagnosticJsonInline(error.inner)}`
			: null,
	];

	return parts.filter(Boolean).join(' | ');
}

function formatEventSpecifics(event: ConnectionDiagnosticTimedEvent): string[] {
	return formatConnectionDiagnosticEventFields(event);
}

function formatEvent(event: ConnectionDiagnosticTimedEvent): string {
	const error = formatError(event);
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
		const appState = formatAppState(options);
		const connection = findPrimaryConnectionIdentity(trace);
		const failure = [...trace.events]
			.reverse()
			.find((event) => readError(event) || event.kind.includes('failed'));
		const lines = [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace:',
			`- traceId: ${safeDiagnosticString(trace.id)}`,
			`- trigger: ${trace.trigger}`,
			`- reason: ${safeDiagnosticString(trace.reason)}`,
			`- status: ${trace.status}`,
			`- startedAtMs: ${trace.startedAtMs}`,
			`- finishedAtMs: ${trace.finishedAtMs ?? 'not-finished'}`,
			'',
			`Selected connection: ${formatConnectionIdentity(connection)}`,
			'',
			...appState,
			...(appState.length ? [''] : []),
			'Failure summary:',
			failure ? formatEvent(failure) : '- no failure event recorded',
			'',
			'Timeline:',
			...trace.events.map((event) => formatEvent(event)),
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
