import {
	cloneDiagnosticValue,
	createSerializedErrorFromFields,
	normalizeConnectionIdentity,
	redactDiagnosticText,
	serializeConnectionDiagnosticError,
	UNREADABLE_ERROR_MESSAGE,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticEventInput,
	type ConnectionDiagnosticSource,
	type ConnectionDiagnosticStatus,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTrigger,
} from './connection-diagnostic-types';

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
			id: readDiagnosticStringField(trace, 'id', undefined) ?? 'unknown-trace',
			trigger: readConnectionDiagnosticTrigger(trace, 'trigger'),
			reason: readDiagnosticStringField(trace, 'reason', undefined) ?? 'unknown',
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

function sanitizeEventInput(input: unknown): ConnectionDiagnosticEventInput {
	const details = readObjectField(input, 'details');

	return {
		type:
			readDiagnosticStringField(input, 'type', undefined) ??
			'diagnostic.event.unserializable',
		source: readConnectionDiagnosticSource(input, 'source'),
		message: readDiagnosticStringField(input, 'message', undefined),
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

function normalizeDiagnosticError(
	value: unknown,
): ConnectionDiagnosticError | undefined {
	if (value === undefined) {
		return undefined;
	}

	const hasStructuredFields =
		readDiagnosticStringField(value, 'name', undefined) !== undefined ||
		readDiagnosticStringField(value, 'message', undefined) !== undefined ||
		readDiagnosticStringField(value, 'tag', undefined) !== undefined ||
		readObjectField(value, 'inner') !== undefined;

	if (!hasStructuredFields) {
		return serializeConnectionDiagnosticError(value);
	}

	return createSerializedErrorFromFields(value, {
		defaultName: 'Error',
		defaultMessage: UNREADABLE_ERROR_MESSAGE,
		includeStack: true,
	});
}

function readConnectionDiagnosticSource(
	value: unknown,
	field: string,
): ConnectionDiagnosticSource {
	const source = readDiagnosticStringField(value, field, undefined);
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
	const trigger = readDiagnosticStringField(value, field, undefined);
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
	const status = readDiagnosticStringField(value, field, undefined);
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

function readDiagnosticStringField(
	value: unknown,
	field: string,
	fallback: string | undefined,
): string | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'string'
			? redactDiagnosticText(fieldValue)
			: fallback;
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
