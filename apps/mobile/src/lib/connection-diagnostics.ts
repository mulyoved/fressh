import { redactBrowserActionErrorText } from './browser-action-error-report';

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
	tag?: string;
	inner?: unknown;
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

export type ConnectionDiagnosticRecorderOptions = {
	now?: () => number;
	maxHistory?: number;
};

type HistoryEntry = {
	order: number;
	trace: ConnectionDiagnosticTrace;
};

export type ConnectionDiagnosticPromptOptions = {
	appState?: ConnectionDiagnosticAppState;
};

const DEFAULT_MAX_HISTORY = 20;

let traceSequence = 0;

const CIRCULAR_PLACEHOLDER = '[Circular]';
const REDACTED_PLACEHOLDER = '[REDACTED]';
const UNREADABLE_ERROR_MESSAGE = '[Unserializable error]';
const DIAGNOSTIC_SECRET_TEXT_PATTERN =
	/(^|[^\w])((?:access[_-]?token)|(?:api[_-]?key)|auth|authorization|client[_-]?secret|code|credential|id[_-]?token|key|passphrase|password|private[_-]?key|refresh[_-]?token|secret|session|sig|signature|token)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\n]*)/giu;
const DIAGNOSTIC_AUTH_SCHEME_PATTERN =
	/(^|[^\w])((?:Bearer|Basic|Token))\s+(?:"[^"]*"|'[^']*'|[^\s"',;]+)/gu;
const DIAGNOSTIC_SECRET_TERMS = [
	'accesstoken',
	'apikey',
	'auth',
	'authorization',
	'clientsecret',
	'credential',
	'idtoken',
	'passphrase',
	'password',
	'privatekey',
	'refreshtoken',
	'secret',
	'signature',
	'token',
];
const DIAGNOSTIC_SECRET_KEY_TERMS = [
	...DIAGNOSTIC_SECRET_TERMS,
	'code',
	'key',
	'session',
	'sig',
];
const CONNECTION_IDENTITY_KEYS = new Set([
	'savedConnectionId',
	'connectionId',
	'username',
	'host',
	'port',
	'keyId',
	'useTmux',
	'tmuxSessionName',
]);

function redactDiagnosticText(value: string): string {
	const redacted = redactBrowserActionErrorText(
		value
			.replace(
				DIAGNOSTIC_SECRET_TEXT_PATTERN,
				(_match, prefix: string, name: string, separator: string) =>
					`${prefix}${name}${separator} [redacted]`,
			)
			.replace(
				DIAGNOSTIC_AUTH_SCHEME_PATTERN,
				(_match, prefix: string, scheme: string) =>
					`${prefix}${scheme} [redacted]`,
			),
	)
		.replace(
			/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
			REDACTED_PLACEHOLDER,
		)
		.replace(
			/(^|[^\w-])((?:private[_-]?key)|passphrase)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"';&|]+))/giu,
			(_match, prefix: string, name: string, doubleQuoted, singleQuoted) => {
				const quote =
					doubleQuoted !== undefined
						? '"'
						: singleQuoted !== undefined
							? "'"
							: '';
				return `${prefix}${name}=${quote}[redacted]${quote}`;
			},
		)
		.replace(
			/(^|[^\w-])((?:private[_-]?key)|passphrase)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s"',;]+))/giu,
			(_match, prefix: string, name: string, doubleQuoted, singleQuoted) => {
				const quote =
					doubleQuoted !== undefined
						? '"'
						: singleQuoted !== undefined
							? "'"
							: '';
				return `${prefix}${name}: ${quote}[redacted]${quote}`;
			},
		);

	return containsDiagnosticSecretTerm(redacted)
		? REDACTED_PLACEHOLDER
		: redacted;
}

function containsDiagnosticSecretTerm(value: string): boolean {
	const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
	return DIAGNOSTIC_SECRET_TERMS.some((secretName) =>
		normalizedValue.includes(secretName),
	);
}

function isSecretDiagnosticKey(key: string): boolean {
	if (CONNECTION_IDENTITY_KEYS.has(key)) {
		return false;
	}

	const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
	return DIAGNOSTIC_SECRET_KEY_TERMS.some((secretName) =>
		normalizedKey.includes(secretName),
	);
}

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
			typeof value === 'number' ||
			typeof value === 'boolean'
		) {
			return value;
		}

		if (typeof value === 'string') {
			return redactDiagnosticText(value);
		}

		if (typeof value === 'bigint') {
			return `${value}n`;
		}

		if (typeof value === 'undefined') {
			return undefined;
		}

		if (typeof value === 'function') {
			return redactDiagnosticText(
				value.name ? `[Function ${value.name}]` : '[Function anonymous]',
			);
		}

		if (typeof value === 'symbol') {
			return redactDiagnosticText(`[Symbol ${value.description ?? ''}]`);
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
				const safeKey = isSecretDiagnosticKey(key) ? REDACTED_PLACEHOLDER : key;
				snapshot[safeKey] = isSecretDiagnosticKey(key)
					? REDACTED_PLACEHOLDER
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

function sanitizeEventInput(input: unknown): ConnectionDiagnosticEventInput {
	const details = readObjectField(input, 'details');

	return {
		type:
			readErrorStringField(input, 'type', undefined) ??
			'diagnostic.event.unserializable',
		source: readConnectionDiagnosticSource(input, 'source'),
		message: readErrorStringField(input, 'message', undefined),
		connection: normalizeConnectionIdentity(
			readObjectField(input, 'connection'),
		),
		error: normalizeDiagnosticError(readObjectField(input, 'error')),
		details:
			details !== undefined
				? (cloneDiagnosticValue(details) as Record<string, unknown>)
				: undefined,
	};
}

function createConnectionDiagnosticEvent(input: {
	rawEvent: unknown;
	startedAtMs: number;
	atMs: number;
}): ConnectionDiagnosticEvent {
	try {
		const sanitizedInput = sanitizeEventInput(input.rawEvent);
		return {
			...sanitizedInput,
			atMs: input.atMs,
			elapsedMs: input.atMs - input.startedAtMs,
		};
	} catch {
		return {
			type: 'diagnostic.event.unserializable',
			source: 'manual-diagnostic',
			message: UNREADABLE_ERROR_MESSAGE,
			atMs: input.atMs,
			elapsedMs: input.atMs - input.startedAtMs,
		};
	}
}

function cloneTrace(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	return {
		...trace,
		reason: redactDiagnosticText(trace.reason),
		events: trace.events.map((event) => cloneDiagnosticValue(event)),
	};
}

function normalizeTraceForPrompt(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	try {
		const startedAtMs = readNumberField(trace, 'startedAtMs') ?? 0;
		const events = readObjectField(trace, 'events');
		return {
			id: readErrorStringField(trace, 'id', undefined) ?? 'unknown-trace',
			trigger: readConnectionDiagnosticTrigger(trace, 'trigger'),
			reason: readErrorStringField(trace, 'reason', undefined) ?? 'unknown',
			status: readConnectionDiagnosticStatus(trace, 'status'),
			startedAtMs,
			finishedAtMs: readNumberField(trace, 'finishedAtMs'),
			events: Array.isArray(events)
				? events.map((event) =>
						createConnectionDiagnosticEvent({
							rawEvent: event,
							startedAtMs,
							atMs: readNumberField(event, 'atMs') ?? startedAtMs,
						}),
					)
				: [],
		};
	} catch {
		return {
			id: 'unknown-trace',
			trigger: 'manual-diagnostic',
			reason: UNREADABLE_ERROR_MESSAGE,
			status: 'failed',
			startedAtMs: 0,
			events: [],
		};
	}
}

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

export function serializeConnectionDiagnosticError(
	error: unknown,
): ConnectionDiagnosticError {
	if (isErrorLike(error)) {
		return createSerializedErrorFromFields(error, {
			defaultName: 'Error',
			defaultMessage: UNREADABLE_ERROR_MESSAGE,
			includeStack: true,
		});
	}

	const tag = readErrorStringField(error, 'tag', undefined);
	const inner = readObjectField(error, 'inner');
	if (tag !== undefined || inner !== undefined) {
		return createSerializedErrorFromFields(error, {
			defaultName: 'NonError',
			defaultMessage: tag ?? UNREADABLE_ERROR_MESSAGE,
			includeStack: false,
		});
	}

	let message: string;
	try {
		message =
			typeof error === 'string'
				? redactDiagnosticText(error)
				: redactDiagnosticText(String(error));
	} catch {
		message = UNREADABLE_ERROR_MESSAGE;
	}

	return {
		name: 'NonError',
		message,
	};
}

function createSerializedErrorFromFields(
	error: unknown,
	options: {
		defaultName: string;
		defaultMessage: string;
		includeStack: boolean;
	},
): ConnectionDiagnosticError {
	const name =
		readErrorStringField(error, 'name', undefined) ?? options.defaultName;
	const message =
		readErrorStringField(error, 'message', undefined) ?? options.defaultMessage;
	const tag = readErrorStringField(error, 'tag', undefined);
	const inner = readObjectField(error, 'inner');
	const serializedError: ConnectionDiagnosticError = {
		name: name || options.defaultName,
		message,
	};

	if (options.includeStack) {
		const stack = readErrorStringField(error, 'stack', undefined);
		if (stack !== undefined) {
			serializedError.stack = stack;
		}
	}

	if (tag !== undefined) {
		serializedError.tag = tag;
	}

	if (inner !== undefined) {
		serializedError.inner = cloneDiagnosticValue(inner);
	}

	return serializedError;
}

function isErrorLike(error: unknown): error is Error {
	try {
		return error instanceof Error;
	} catch {
		return false;
	}
}

function readErrorStringField(
	error: unknown,
	field: string,
	fallback: string | undefined,
): string | undefined {
	try {
		const value = readObjectField(error, field);
		return typeof value === 'string' ? redactDiagnosticText(value) : fallback;
	} catch {
		return fallback;
	}
}

function readNumberField(value: unknown, field: string): number | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'number' && Number.isFinite(fieldValue)
			? fieldValue
			: undefined;
	} catch {
		return undefined;
	}
}

function readBooleanField(value: unknown, field: string): boolean | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'boolean' ? fieldValue : undefined;
	} catch {
		return undefined;
	}
}

function readConnectionDiagnosticSource(
	value: unknown,
	field: string,
): ConnectionDiagnosticSource {
	const source = readErrorStringField(value, field, undefined);
	switch (source) {
		case 'latest-shell':
		case 'active-connection':
		case 'saved-entry':
		case 'tailscale-recovery':
		case 'reconnect-controller':
		case 'manual-diagnostic':
		case 'foreground-service':
		case 'command-menu':
			return source;
		default:
			return 'manual-diagnostic';
	}
}

function readConnectionDiagnosticTrigger(
	value: unknown,
	field: string,
): ConnectionDiagnosticTrigger {
	const trigger = readErrorStringField(value, field, undefined);
	switch (trigger) {
		case 'initial-auto-connect':
		case 'reconnect':
		case 'manual-diagnostic':
		case 'command-menu':
			return trigger;
		default:
			return 'manual-diagnostic';
	}
}

function readConnectionDiagnosticStatus(
	value: unknown,
	field: string,
): ConnectionDiagnosticStatus {
	const status = readErrorStringField(value, field, undefined);
	switch (status) {
		case 'running':
		case 'failed':
		case 'connected':
		case 'skipped':
			return status;
		default:
			return 'failed';
	}
}

function normalizeConnectionIdentity(
	value: unknown,
): ConnectionDiagnosticConnectionIdentity | undefined {
	const identity: ConnectionDiagnosticConnectionIdentity = {};
	const savedConnectionId = readErrorStringField(
		value,
		'savedConnectionId',
		undefined,
	);
	const connectionId = readErrorStringField(value, 'connectionId', undefined);
	const username = readErrorStringField(value, 'username', undefined);
	const host = readErrorStringField(value, 'host', undefined);
	const port = readNumberField(value, 'port');
	const keyId = readErrorStringField(value, 'keyId', undefined);
	const useTmux = readBooleanField(value, 'useTmux');
	const tmuxSessionName = readErrorStringField(
		value,
		'tmuxSessionName',
		undefined,
	);

	if (savedConnectionId !== undefined)
		identity.savedConnectionId = savedConnectionId;
	if (connectionId !== undefined) identity.connectionId = connectionId;
	if (username !== undefined) identity.username = username;
	if (host !== undefined) identity.host = host;
	if (port !== undefined) identity.port = port;
	if (keyId !== undefined) identity.keyId = keyId;
	if (useTmux !== undefined) identity.useTmux = useTmux;
	if (tmuxSessionName !== undefined) {
		identity.tmuxSessionName = tmuxSessionName;
	}

	return Object.keys(identity).length ? identity : undefined;
}

function normalizeDiagnosticError(
	value: unknown,
): ConnectionDiagnosticError | undefined {
	if (value === undefined) {
		return undefined;
	}

	const hasStructuredFields =
		readErrorStringField(value, 'name', undefined) !== undefined ||
		readErrorStringField(value, 'message', undefined) !== undefined ||
		readErrorStringField(value, 'tag', undefined) !== undefined ||
		readObjectField(value, 'inner') !== undefined;

	if (hasStructuredFields) {
		return createSerializedErrorFromFields(value, {
			defaultName: 'Error',
			defaultMessage: UNREADABLE_ERROR_MESSAGE,
			includeStack: true,
		});
	}

	return serializeConnectionDiagnosticError(value);
}

function readObjectField(value: unknown, field: string): unknown {
	try {
		if (
			value === null ||
			(typeof value !== 'object' && typeof value !== 'function')
		) {
			return undefined;
		}

		return (value as Record<string, unknown>)[field];
	} catch {
		return undefined;
	}
}

export function createConnectionDiagnosticRecorder(
	options: ConnectionDiagnosticRecorderOptions = {},
): ConnectionDiagnosticRecorder {
	const now = options.now ?? Date.now;
	const maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
	let latestTrace: ConnectionDiagnosticTrace | null = null;
	let history: HistoryEntry[] = [];
	let recorderGeneration = 0;
	let traceOrderSequence = 0;

	return {
		startTrace: ({ trigger, reason }) => {
			const startedAtMs = now();
			const traceGeneration = recorderGeneration;
			traceOrderSequence += 1;
			const traceOrder = traceOrderSequence;
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
					const atMs = now();
					const event = createConnectionDiagnosticEvent({
						rawEvent: input,
						startedAtMs: trace.startedAtMs,
						atMs,
					});
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
					if (traceGeneration === recorderGeneration) {
						history = [
							...history.filter((entry) => entry.trace.id !== trace.id),
							{ order: traceOrder, trace: cloneTrace(trace) },
						]
							.sort((left, right) => left.order - right.order)
							.slice(-maxHistory);
					}
				},
			};
		},
		getLatestTrace: () => (latestTrace ? cloneTrace(latestTrace) : null),
		getHistory: () => history.map((entry) => cloneTrace(entry.trace)),
		clear: () => {
			recorderGeneration += 1;
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

export const connectionDiagnosticRecorder =
	createConnectionDiagnosticRecorder();

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
