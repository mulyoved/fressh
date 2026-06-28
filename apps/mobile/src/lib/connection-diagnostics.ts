export type ConnectionDiagnosticTrigger =
	| 'initial-auto-connect'
	| 'reconnect'
	| 'manual-diagnostic'
	| 'command-menu';

export type ConnectionDiagnosticStatus =
	| 'running'
	| 'failed'
	| 'connected'
	| 'skipped';

export type ConnectionDiagnosticSource =
	| 'latest-shell'
	| 'active-connection'
	| 'saved-entry'
	| 'tailscale-recovery'
	| 'reconnect-controller'
	| 'manual-diagnostic'
	| 'foreground-service'
	| 'command-menu';

export type ConnectionDiagnosticConnectionIdentity = {
	savedConnectionId?: string;
	connectionId?: string;
	username?: string;
	host?: string;
	port?: number;
	keyId?: string;
	useTmux?: boolean;
	tmuxSessionName?: string;
};

export type ConnectionDiagnosticError = {
	name: string;
	message: string;
	stack?: string;
};

export type ConnectionDiagnosticEventInput = {
	type: string;
	source: ConnectionDiagnosticSource;
	message?: string;
	connection?: ConnectionDiagnosticConnectionIdentity;
	error?: ConnectionDiagnosticError;
	details?: Record<string, unknown>;
};

export type ConnectionDiagnosticEvent = ConnectionDiagnosticEventInput & {
	atMs: number;
	elapsedMs: number;
};

export type ConnectionDiagnosticTrace = {
	id: string;
	trigger: ConnectionDiagnosticTrigger;
	reason: string;
	status: ConnectionDiagnosticStatus;
	startedAtMs: number;
	finishedAtMs?: number;
	events: ConnectionDiagnosticEvent[];
};

export type ConnectionDiagnosticTraceHandle = {
	trace: ConnectionDiagnosticTrace;
	event: (input: ConnectionDiagnosticEventInput) => ConnectionDiagnosticEvent;
	finish: (status: Exclude<ConnectionDiagnosticStatus, 'running'>) => void;
};

export type ConnectionDiagnosticAppState = {
	platformOS: string;
	pathname?: string;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	foregroundServiceStarted?: boolean;
	backgroundWorkAllowed?: boolean;
	foregroundServiceRequired?: boolean;
	appActive?: boolean;
};

export type ConnectionDiagnosticRecorder = {
	startTrace: (input: {
		trigger: ConnectionDiagnosticTrigger;
		reason: string;
	}) => ConnectionDiagnosticTraceHandle;
	getLatestTrace: () => ConnectionDiagnosticTrace | null;
	getHistory: () => ConnectionDiagnosticTrace[];
	clear: () => void;
};

type RecorderOptions = {
	now?: () => number;
	maxHistory?: number;
};

type FormatPromptOptions = {
	appState?: ConnectionDiagnosticAppState;
};

const DEFAULT_MAX_HISTORY = 20;

let traceSequence = 0;

function nextTraceId(now: number): string {
	traceSequence += 1;
	return `connection-diagnostic-${now}-${traceSequence}`;
}

function sanitizeDiagnosticValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeDiagnosticValue(entry));
	}

	if (!value || typeof value !== 'object') {
		return value;
	}

	const sanitizedEntries = Object.entries(value as Record<string, unknown>).map(
		([key, entryValue]) => {
			if (/privateKey/i.test(key)) {
				return [key, '[REDACTED]'] as const;
			}

			return [key, sanitizeDiagnosticValue(entryValue)] as const;
		},
	);

	return Object.fromEntries(sanitizedEntries);
}

function cloneDiagnosticValue<T>(value: T): T {
	if (value === undefined) {
		return value;
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeEventInput(
	input: ConnectionDiagnosticEventInput,
): ConnectionDiagnosticEventInput {
	return {
		...input,
		connection: input.connection
			? cloneDiagnosticValue(input.connection)
			: undefined,
		error: input.error ? cloneDiagnosticValue(input.error) : undefined,
		details: input.details
			? (sanitizeDiagnosticValue(
					cloneDiagnosticValue(input.details),
				) as Record<string, unknown>)
			: undefined,
	};
}

function cloneTrace(trace: ConnectionDiagnosticTrace): ConnectionDiagnosticTrace {
	return {
		...trace,
		events: trace.events.map((event) => cloneDiagnosticValue(event)),
	};
}

function formatConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): string {
	if (!connection) return 'unknown connection';

	const username = connection.username?.trim();
	const host = connection.host?.trim();
	const port = connection.port;
	const address =
		username && host && typeof port === 'number'
			? `${username}@${host}:${port}`
			: null;

	const savedId = connection.savedConnectionId?.trim();
	const connectionId = connection.connectionId?.trim();
	const keyId = connection.keyId?.trim();
	const tmuxSessionName = connection.tmuxSessionName?.trim();
	const parts = [
		address,
		savedId ? `savedConnectionId=${savedId}` : null,
		connectionId ? `connectionId=${connectionId}` : null,
		typeof connection.useTmux === 'boolean'
			? `useTmux=${String(connection.useTmux)}`
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
		`- +${event.elapsedMs}ms ${event.type}`,
		`source=${event.source}`,
		event.message ? `message=${event.message}` : null,
		event.connection
			? `connection=${formatConnectionIdentity(event.connection)}`
			: null,
		event.error
			? `error=${event.error.name}: ${event.error.message}`
			: null,
	];

	if (event.details) {
		parts.push(
			`details=${JSON.stringify(
				sanitizeDiagnosticValue(event.details),
				null,
				2,
			).replace(/\n/g, ' ')}`,
		);
	}

	return parts.filter(Boolean).join(' | ');
}

export function serializeConnectionDiagnosticError(
	error: unknown,
): ConnectionDiagnosticError {
	if (error instanceof Error) {
		return {
			name: error.name || 'Error',
			message: error.message,
			stack: error.stack,
		};
	}

	return {
		name: 'NonError',
		message: typeof error === 'string' ? error : String(error),
	};
}

export function createConnectionDiagnosticRecorder(
	options: RecorderOptions = {},
): ConnectionDiagnosticRecorder {
	const now = options.now ?? Date.now;
	const maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
	let latestTrace: ConnectionDiagnosticTrace | null = null;
	let history: ConnectionDiagnosticTrace[] = [];

	return {
		startTrace: ({ trigger, reason }) => {
			const startedAtMs = now();
			const trace: ConnectionDiagnosticTrace = {
				id: nextTraceId(startedAtMs),
				trigger,
				reason,
				status: 'running',
				startedAtMs,
				events: [],
			};
			latestTrace = trace;

			return {
				trace,
				event: (input) => {
					const sanitizedInput = sanitizeEventInput(input);
					const atMs = now();
					const event: ConnectionDiagnosticEvent = {
						...sanitizedInput,
						atMs,
						elapsedMs: atMs - trace.startedAtMs,
					};
					trace.events.push(event);
					return event;
				},
				finish: (status) => {
					trace.status = status;
					trace.finishedAtMs = now();
					latestTrace = trace;
					history = [...history, cloneTrace(trace)].slice(-maxHistory);
				},
			};
		},
		getLatestTrace: () => (latestTrace ? cloneTrace(latestTrace) : null),
		getHistory: () => history.map((trace) => cloneTrace(trace)),
		clear: () => {
			latestTrace = null;
			history = [];
		},
	};
}

function findPrimaryConnectionIdentity(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticConnectionIdentity | undefined {
	for (const event of trace.events) {
		if (event.connection) {
			return event.connection;
		}
	}

	return undefined;
}

export const connectionDiagnosticRecorder =
	createConnectionDiagnosticRecorder();

export function formatConnectionDiagnosticPrompt(
	trace: ConnectionDiagnosticTrace,
	options: FormatPromptOptions = {},
): string {
	const connection = findPrimaryConnectionIdentity(trace);
	const appStateLines = options.appState
		? [
				'App state:',
				`- platformOS: ${options.appState.platformOS}`,
				`- pathname: ${options.appState.pathname}`,
				`- isAutoConnecting: ${String(options.appState.isAutoConnecting)}`,
				`- isReconnecting: ${String(options.appState.isReconnecting)}`,
				`- foregroundServiceStarted: ${String(
					options.appState.foregroundServiceStarted,
				)}`,
				`- backgroundWorkAllowed: ${String(
					options.appState.backgroundWorkAllowed,
				)}`,
				`- foregroundServiceRequired: ${String(
					options.appState.foregroundServiceRequired,
				)}`,
				`- appActive: ${String(options.appState.appActive)}`,
			]
		: [];

	return [
		'Debug this Fressh mobile SSH connection failure.',
		'',
		'Trace summary:',
		`- traceId: ${trace.id}`,
		`- trigger: ${trace.trigger}`,
		`- reason: ${trace.reason}`,
		`- status: ${trace.status}`,
		`- startedAtMs: ${trace.startedAtMs}`,
		`- finishedAtMs: ${trace.finishedAtMs ?? 'not-finished'}`,
		`- connection: ${formatConnectionIdentity(connection)}`,
		'',
		...appStateLines,
		...(appStateLines.length ? [''] : []),
		'Events:',
		...trace.events.map((event) => formatEvent(event)),
		'',
		'Private key material has been omitted from this diagnostic trace.',
		'Please explain the most likely failure point, the evidence from the trace, and the next debugging steps.',
	].join('\n');
}
