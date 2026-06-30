import { diagnosticEvents } from './connection-diagnostic-events';
import {
	cloneDiagnosticValue,
	normalizeConnectionIdentity,
	safeDiagnosticString,
	serializeConnectionDiagnosticError,
	UNREADABLE_ERROR_MESSAGE,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticSource,
	type ConnectionDiagnosticStatus,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTrigger,
} from './connection-diagnostic-types';

export type ConnectionDiagnosticPromptCompatibleTimedEvent =
	ConnectionDiagnosticTimedEvent & {
		type: string;
	};

const connectionDiagnosticEventKinds = new Set<string>([
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
]);

const legacyTypeAliases = new Map<string, string>([
	['connection.selected', 'saved-entry.selected'],
	['manual-diagnostic.saved-entry.selected', 'saved-entry.selected'],
	['auto-connect.source.latest-shell', 'auto-connect.latest-shell.selected'],
	[
		'auto-connect.source.missing-latest-shell',
		'auto-connect.latest-shell.missing',
	],
	[
		'auto-connect.source.missing-active-connection',
		'auto-connect.active-connection.missing',
	],
	['auto-connect.saved-entry.missing', 'saved-entry.missing'],
]);

export function normalizeTraceForPrompt(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	try {
		const startedAtMs = readNumberField(trace, 'startedAtMs') ?? 0;
		const events = readObjectField(trace, 'events');
		return {
			id: readStringField(trace, 'id') ?? 'unknown-trace',
			trigger: readConnectionDiagnosticTrigger(trace, 'trigger'),
			reason: readStringField(trace, 'reason') ?? 'unknown',
			status: readConnectionDiagnosticStatus(trace, 'status'),
			startedAtMs,
			finishedAtMs: readNumberField(trace, 'finishedAtMs'),
			events: Array.isArray(events)
				? events.map((event) =>
						normalizeTimedConnectionDiagnosticEvent({
							event,
							startedAtMs,
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

export function normalizeTimedConnectionDiagnosticEvent(input: {
	event: unknown;
	startedAtMs: number;
	atMs?: number;
	elapsedMs?: number;
}): ConnectionDiagnosticPromptCompatibleTimedEvent {
	const atMs =
		input.atMs ?? readNumberField(input.event, 'atMs') ?? input.startedAtMs;
	const normalizedEvent = normalizeLegacyEvent(input.event);
	return cloneDiagnosticValue({
		...normalizedEvent,
		type: normalizedEvent.kind,
		atMs,
		elapsedMs:
			input.elapsedMs ??
			readNumberField(input.event, 'elapsedMs') ??
			atMs - input.startedAtMs,
	});
}

export function normalizeLegacyEvent(
	input: unknown,
): ConnectionDiagnosticEvent {
	const kind = readStringField(input, 'kind');
	if (kind !== undefined && connectionDiagnosticEventKinds.has(kind)) {
		const event = normalizeKnownDiagnosticEvent(input, kind);
		if (event) return event;
	}

	const type = readStringField(input, 'type');
	const source = readConnectionDiagnosticSource(input, 'source');
	const message = readStringField(input, 'message');
	const connection = readConnectionIdentity(input);
	const canonicalType =
		type === undefined ? undefined : (legacyTypeAliases.get(type) ?? type);
	if (
		canonicalType !== undefined &&
		connectionDiagnosticEventKinds.has(canonicalType)
	) {
		const event = normalizeKnownDiagnosticEvent(input, canonicalType, type);
		if (event) return event;
	}

	switch (type) {
		case 'connection.key-resolved':
		case 'manual-diagnostic.key-resolved':
			return diagnosticEvents.keyResolved({
				source,
				connection,
			});
		case 'connection.key-missing':
		case 'manual-diagnostic.key-missing':
			return diagnosticEvents.keyMissing({
				source,
				connection,
			});
		default:
			return normalizeGenericLegacyEvent({
				input,
				type,
				source,
				message,
				connection,
			});
	}
}

function normalizeKnownDiagnosticEvent(
	input: unknown,
	kind: string,
	legacyType?: string,
): ConnectionDiagnosticEvent | undefined {
	const event = cloneDiagnosticValue(input);
	if (!isRecord(event)) return undefined;

	const source = readConnectionDiagnosticSource(input, 'source');
	const connection = readConnectionIdentity(input);
	const normalizedEvent: Record<string, unknown> = {
		...event,
		kind,
		source,
	};
	delete normalizedEvent.type;
	if (Object.keys(connection).length) {
		normalizedEvent.connection = connection;
	}
	if (readObjectField(input, 'error') !== undefined) {
		normalizedEvent.error = readLegacyDiagnosticError(input);
	}
	if (legacyType !== undefined) {
		const details = readLegacyDetails(input, legacyType);
		if (Object.keys(details).some((key) => key !== 'legacyType')) {
			normalizedEvent.details = details;
		}
	}

	return cloneDiagnosticValue(normalizedEvent) as ConnectionDiagnosticEvent;
}

function normalizeGenericLegacyEvent(input: {
	input: unknown;
	type: string | undefined;
	source: ConnectionDiagnosticSource;
	message: string | undefined;
	connection: ConnectionDiagnosticConnectionIdentity;
}): ConnectionDiagnosticEvent {
	const details = readLegacyDetails(input.input, input.type);
	const fallback = diagnosticEvents.manualDiagnosticWarning({
		source: input.source,
		message: formatLegacyEventMessage(input.type, input.message),
		error: readGenericLegacyDiagnosticError(
			input.input,
			input.type,
			input.message,
		),
	});

	return cloneDiagnosticValue({
		...fallback,
		...(Object.keys(input.connection).length
			? { connection: input.connection }
			: {}),
		details,
	}) as ConnectionDiagnosticEvent;
}

function readLegacyDiagnosticError(input: unknown) {
	const error = serializeConnectionDiagnosticError(
		readObjectField(input, 'error') ?? readStringField(input, 'message'),
	);
	const details = readObjectField(input, 'details');

	return details === undefined || error.inner !== undefined
		? error
		: {
				...error,
				inner: cloneDiagnosticValue(details),
			};
}

function readGenericLegacyDiagnosticError(
	input: unknown,
	type: string | undefined,
	message: string | undefined,
) {
	const error = readObjectField(input, 'error');
	if (error !== undefined) {
		return serializeConnectionDiagnosticError(error);
	}

	return serializeConnectionDiagnosticError({
		name: 'LegacyConnectionDiagnosticEvent',
		message: formatLegacyEventMessage(type, message),
	});
}

function formatLegacyEventMessage(
	type: string | undefined,
	message: string | undefined,
): string {
	if (type && message) return `${type}: ${message}`;
	return type ?? message ?? UNREADABLE_ERROR_MESSAGE;
}

function readLegacyDetails(
	input: unknown,
	type: string | undefined,
): Record<string, unknown> {
	const details: Record<string, unknown> = {
		legacyType: type ?? 'unknown',
	};
	const explicitDetails = readObjectField(input, 'details');
	if (explicitDetails !== undefined) {
		details.details = cloneDiagnosticValue(explicitDetails);
	}

	for (const key of readLegacyExtraDetailKeys(input)) {
		details[key] = cloneDiagnosticValue(readObjectField(input, key));
	}

	return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readLegacyExtraDetailKeys(input: unknown): string[] {
	try {
		if (
			input === null ||
			(typeof input !== 'object' && typeof input !== 'function')
		) {
			return [];
		}

		return Object.keys(input).filter(
			(key) =>
				![
					'atMs',
					'connection',
					'details',
					'elapsedMs',
					'error',
					'kind',
					'message',
					'source',
					'type',
				].includes(key),
		);
	} catch {
		return [];
	}
}

function readConnectionIdentity(
	input: unknown,
): ConnectionDiagnosticConnectionIdentity {
	return (
		normalizeConnectionIdentity(readObjectField(input, 'connection')) ?? {}
	);
}

function readConnectionDiagnosticSource(
	value: unknown,
	field: string,
): ConnectionDiagnosticSource {
	const source = readStringField(value, field);
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
	const trigger = readStringField(value, field);
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
	const status = readStringField(value, field);
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

function readStringField(value: unknown, field: string): string | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'string'
			? safeDiagnosticString(fieldValue)
			: undefined;
	} catch {
		return undefined;
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
