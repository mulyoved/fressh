import { redactBrowserActionErrorText } from './browser-action-error-report';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticEventInput,
	type ConnectionDiagnosticSource,
	type ConnectionDiagnosticStatus,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTrigger,
} from './connection-diagnostic-types';

export const CIRCULAR_PLACEHOLDER = '[Circular]';
export const REDACTED_PLACEHOLDER = '[REDACTED]';
export const UNREADABLE_ERROR_MESSAGE = '[Unserializable error]';

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

export function redactDiagnosticText(value: string): string {
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

export function cloneDiagnosticValue<T>(value: T): T {
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

export function createConnectionDiagnosticEvent(input: {
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

export function normalizeTraceForPrompt(
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

export function normalizeConnectionIdentity(
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
