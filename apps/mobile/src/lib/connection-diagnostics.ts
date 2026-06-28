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
	readonly trace: ConnectionDiagnosticTrace;
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

const CIRCULAR_PLACEHOLDER = '[Circular]';

function nextTraceId(now: number): string {
	traceSequence += 1;
	return `connection-diagnostic-${now}-${traceSequence}`;
}

function snapshotDiagnosticValue(
	value: unknown,
	seen = new WeakMap<object, unknown>(),
): unknown {
	try {
		if (
			value === null ||
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean'
		) {
			return value;
		}

		if (typeof value === 'bigint') {
			return `${value}n`;
		}

		if (typeof value === 'undefined') {
			return undefined;
		}

		if (typeof value === 'function') {
			return value.name
				? `[Function ${value.name}]`
				: '[Function anonymous]';
		}

		if (typeof value === 'symbol') {
			return `[Symbol ${value.description ?? ''}]`;
		}

		if (!value || typeof value !== 'object') {
			return String(value);
		}

		if (seen.has(value)) {
			return CIRCULAR_PLACEHOLDER;
		}

		if (Array.isArray(value)) {
			const snapshot: unknown[] = [];
			seen.set(value, snapshot);
			for (const entry of value) {
				snapshot.push(snapshotDiagnosticValue(entry, seen));
			}
			return snapshot;
		}

		if (Object.getPrototypeOf(value) === Object.prototype) {
			const snapshot: Record<string, unknown> = {};
			seen.set(value, snapshot);
			for (const [key, entryValue] of Object.entries(value)) {
				snapshot[key] = /privateKey/i.test(key)
					? '[REDACTED]'
					: snapshotDiagnosticValue(entryValue, seen);
			}
			return snapshot;
		}

		return Object.prototype.toString.call(value);
	} catch {
		return '[Unserializable]';
	}
}

function cloneDiagnosticValue<T>(value: T): T {
	return snapshotDiagnosticValue(value) as T;
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
			? (cloneDiagnosticValue(input.details) as Record<string, unknown>)
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
				cloneDiagnosticValue(event.details),
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
			let finished = false;

			return {
				get trace() {
					return cloneTrace(trace);
				},
				event: (input) => {
					const sanitizedInput = sanitizeEventInput(input);
					const atMs = now();
					const event: ConnectionDiagnosticEvent = {
						...sanitizedInput,
						atMs,
						elapsedMs: atMs - trace.startedAtMs,
					};
					if (finished) {
						return cloneDiagnosticValue(event);
					}
					trace.events.push(event);
					return cloneDiagnosticValue(event);
				},
				finish: (status) => {
					if (finished) {
						return;
					}
					finished = true;
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
	let selectedConnection: ConnectionDiagnosticConnectionIdentity | undefined;
	let selectedScore = -1;

	for (const event of trace.events) {
		if (!event.connection) {
			continue;
		}

		const score = [
			event.connection.savedConnectionId?.trim(),
			event.connection.connectionId?.trim(),
			event.connection.username?.trim(),
			event.connection.host?.trim(),
			typeof event.connection.port === 'number'
				? String(event.connection.port)
				: undefined,
			event.connection.keyId?.trim(),
			typeof event.connection.useTmux === 'boolean'
				? String(event.connection.useTmux)
				: undefined,
			event.connection.tmuxSessionName?.trim(),
		].filter(Boolean).length;

		if (score >= selectedScore) {
			selectedConnection = event.connection;
			selectedScore = score;
		}
	}

	return selectedConnection;
}

export const connectionDiagnosticRecorder =
	createConnectionDiagnosticRecorder();

export function formatConnectionDiagnosticPrompt(
	trace: ConnectionDiagnosticTrace,
	options: FormatPromptOptions = {},
): string {
	const connection = findPrimaryConnectionIdentity(trace);
	const appStateLines: string[] = [];

	if (options.appState) {
		appStateLines.push(
			'App state:',
			`- platformOS: ${options.appState.platformOS}`,
			`- isAutoConnecting: ${String(options.appState.isAutoConnecting)}`,
			`- isReconnecting: ${String(options.appState.isReconnecting)}`,
		);

		if (options.appState.pathname !== undefined) {
			appStateLines.push(`- pathname: ${options.appState.pathname}`);
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
			appStateLines.push(`- appActive: ${String(options.appState.appActive)}`);
		}
	}

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
