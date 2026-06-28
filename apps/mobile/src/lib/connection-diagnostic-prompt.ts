import { normalizeTraceForPrompt } from './connection-diagnostic-normalization';
import {
	cloneDiagnosticValue,
	normalizeConnectionIdentity,
	redactDiagnosticText,
	UNREADABLE_ERROR_MESSAGE,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticPromptOptions,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';

function formatConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): string {
	const normalizedConnection = normalizeConnectionIdentity(connection);
	if (!normalizedConnection) return 'unknown connection';

	const username = normalizedConnection.username
		? redactDiagnosticText(normalizedConnection.username.trim())
		: undefined;
	const host = normalizedConnection.host
		? redactDiagnosticText(normalizedConnection.host.trim())
		: undefined;
	const port = normalizedConnection.port;
	const address =
		username && host && typeof port === 'number'
			? `${username}@${host}:${port}`
			: null;

	const savedId = normalizedConnection.savedConnectionId
		? redactDiagnosticText(normalizedConnection.savedConnectionId.trim())
		: undefined;
	const connectionId = normalizedConnection.connectionId
		? redactDiagnosticText(normalizedConnection.connectionId.trim())
		: undefined;
	const keyId = normalizedConnection.keyId
		? redactDiagnosticText(normalizedConnection.keyId.trim())
		: undefined;
	const tmuxSessionName = normalizedConnection.tmuxSessionName
		? redactDiagnosticText(normalizedConnection.tmuxSessionName.trim())
		: undefined;
	const parts = [
		address,
		savedId ? `savedConnectionId=${savedId}` : null,
		connectionId ? `connectionId=${connectionId}` : null,
		typeof normalizedConnection.useTmux === 'boolean'
			? `useTmux=${String(normalizedConnection.useTmux)}`
			: null,
		tmuxSessionName ? `tmuxSessionName=${tmuxSessionName}` : null,
	];
	if (keyId) {
		parts.push(`keyId=${keyId}`);
	}

	return parts.filter(Boolean).join(' | ') || 'unknown connection';
}

function formatEvent(event: ConnectionDiagnosticEvent): string {
	const parts = [
		`- +${event.elapsedMs}ms ${redactDiagnosticText(event.type)}`,
		`source=${event.source}`,
		event.message ? `message=${redactDiagnosticText(event.message)}` : null,
		event.connection
			? `connection=${formatConnectionIdentity(event.connection)}`
			: null,
		event.error
			? `error=${redactDiagnosticText(
					event.error.name,
				)}: ${redactDiagnosticText(event.error.message)}`
			: null,
	];

	if (event.error?.tag) {
		parts.push(`errorTag=${redactDiagnosticText(event.error.tag)}`);
	}

	if (event.error?.stack) {
		parts.push(
			`errorStack=${redactDiagnosticText(event.error.stack).replace(
				/\n/g,
				' ',
			)}`,
		);
	}

	if (event.error?.inner !== undefined) {
		parts.push(
			`errorInner=${JSON.stringify(
				cloneDiagnosticValue(event.error.inner),
				null,
				2,
			).replace(/\n/g, ' ')}`,
		);
	}

	if (event.details) {
		parts.push(
			`details=${JSON.stringify(
				cloneDiagnosticValue(event.details),
				null,
				2,
			).replace(/\n/g, ' ')}`,
		);
	}

	return parts.filter(Boolean).join(' | ');
}

function findPrimaryConnectionIdentity(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticConnectionIdentity | undefined {
	let selectedConnection: ConnectionDiagnosticConnectionIdentity | undefined;
	let selectedScore = -1;

	for (const event of trace.events) {
		const connection = normalizeConnectionIdentity(event.connection);
		if (!connection) {
			continue;
		}

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

export function formatConnectionDiagnosticPrompt(
	trace: ConnectionDiagnosticTrace,
	options: ConnectionDiagnosticPromptOptions = {},
): string {
	try {
		const safeTrace = normalizeTraceForPrompt(trace);
		const connection = findPrimaryConnectionIdentity(safeTrace);
		const appStateLines: string[] = [];

		if (options.appState) {
			appStateLines.push(
				'App state:',
				`- platformOS: ${redactDiagnosticText(options.appState.platformOS)}`,
				`- isAutoConnecting: ${String(options.appState.isAutoConnecting)}`,
				`- isReconnecting: ${String(options.appState.isReconnecting)}`,
			);

			if (options.appState.pathname !== undefined) {
				appStateLines.push(
					`- pathname: ${redactDiagnosticText(options.appState.pathname)}`,
				);
			}

			if (options.appState.foregroundServiceStarted !== undefined) {
				appStateLines.push(
					`- foregroundServiceStarted: ${String(
						options.appState.foregroundServiceStarted,
					)}`,
				);
			}

			if (options.appState.backgroundWorkAllowed !== undefined) {
				appStateLines.push(
					`- backgroundWorkAllowed: ${String(
						options.appState.backgroundWorkAllowed,
					)}`,
				);
			}

			if (options.appState.foregroundServiceRequired !== undefined) {
				appStateLines.push(
					`- foregroundServiceRequired: ${String(
						options.appState.foregroundServiceRequired,
					)}`,
				);
			}

			if (options.appState.appActive !== undefined) {
				appStateLines.push(
					`- appActive: ${String(options.appState.appActive)}`,
				);
			}
		}

		return [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace summary:',
			`- traceId: ${redactDiagnosticText(safeTrace.id)}`,
			`- trigger: ${safeTrace.trigger}`,
			`- reason: ${redactDiagnosticText(safeTrace.reason)}`,
			`- status: ${safeTrace.status}`,
			`- startedAtMs: ${safeTrace.startedAtMs}`,
			`- finishedAtMs: ${safeTrace.finishedAtMs ?? 'not-finished'}`,
			`- connection: ${formatConnectionIdentity(connection)}`,
			'',
			...appStateLines,
			...(appStateLines.length ? [''] : []),
			'Events:',
			...safeTrace.events.map((event) => formatEvent(event)),
			'',
			'Private key material has been omitted from this diagnostic trace.',
			'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
		].join('\n');
	} catch {
		return [
			'Debug this Fressh mobile SSH connection failure.',
			'',
			'Trace summary:',
			'- traceId: unknown-trace',
			'- trigger: manual-diagnostic',
			`- reason: ${UNREADABLE_ERROR_MESSAGE}`,
			'- status: failed',
			'- startedAtMs: 0',
			'- finishedAtMs: not-finished',
			'- connection: unknown connection',
			'',
			'Events:',
			'',
			'Private key material has been omitted from this diagnostic trace.',
			'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
		].join('\n');
	}
}
