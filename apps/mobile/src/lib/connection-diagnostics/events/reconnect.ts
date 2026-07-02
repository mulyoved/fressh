import { safeDiagnosticString } from './snapshot';
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type ReconnectStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.started';
	reason: string;
	windowMs: number;
};

export type ReconnectStoppedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.stopped';
	reason: string;
};

export type ReconnectStartBlockedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.start.blocked';
	reason: string;
	isAutoConnecting?: boolean;
	isReconnecting?: boolean;
	resetInFlight?: boolean;
};

export type ReconnectRetryScheduledEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.retry.scheduled';
	attemptIndex: number;
	delayMs: number;
};

export type ReconnectAttemptStartedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.started';
	reconnectElapsedMs: number;
};

export type ReconnectAttemptConnectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.connected';
	reconnectElapsedMs: number;
};

export type ReconnectAttemptFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.attempt.failed';
	reconnectElapsedMs: number;
};

export type ReconnectTimeoutEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.timeout';
	reconnectElapsedMs: number;
	windowMs: number;
};

export type ReconnectEvent =
	| ReconnectStartedEvent
	| ReconnectStoppedEvent
	| ReconnectStartBlockedEvent
	| ReconnectRetryScheduledEvent
	| ReconnectAttemptStartedEvent
	| ReconnectAttemptConnectedEvent
	| ReconnectAttemptFailedEvent
	| ReconnectTimeoutEvent;

export const reconnectEventKinds = [
	'reconnect.started',
	'reconnect.stopped',
	'reconnect.start.blocked',
	'reconnect.retry.scheduled',
	'reconnect.attempt.started',
	'reconnect.attempt.connected',
	'reconnect.attempt.failed',
	'reconnect.timeout',
] as const satisfies readonly ReconnectEvent['kind'][];

export const reconnectEvents = {
	started: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		windowMs: number;
		message?: string;
	}): ReconnectStartedEvent =>
		({
			kind: 'reconnect.started',
			source: input.source,
			message: input.message,
			reason: input.reason,
			windowMs: input.windowMs,
		}),
	stopped: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		message?: string;
	}): ReconnectStoppedEvent =>
		({
			kind: 'reconnect.stopped',
			source: input.source,
			message: input.message,
			reason: input.reason,
		}),
	startBlocked: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		isAutoConnecting?: boolean;
		isReconnecting?: boolean;
		resetInFlight?: boolean;
		message?: string;
	}): ReconnectStartBlockedEvent =>
		({
			kind: 'reconnect.start.blocked',
			source: input.source,
			message: input.message,
			reason: input.reason,
			isAutoConnecting: input.isAutoConnecting,
			isReconnecting: input.isReconnecting,
			resetInFlight: input.resetInFlight,
		}),
	retryScheduled: (input: {
		source: ConnectionDiagnosticSource;
		attemptIndex: number;
		delayMs: number;
		message?: string;
	}): ReconnectRetryScheduledEvent =>
		({
			kind: 'reconnect.retry.scheduled',
			source: input.source,
			message: input.message,
			attemptIndex: input.attemptIndex,
			delayMs: input.delayMs,
		}),
	attemptStarted: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptStartedEvent =>
		({
			kind: 'reconnect.attempt.started',
			source: input.source,
			message: input.message,
			reconnectElapsedMs: input.reconnectElapsedMs,
		}),
	attemptConnected: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptConnectedEvent =>
		({
			kind: 'reconnect.attempt.connected',
			source: input.source,
			message: input.message,
			reconnectElapsedMs: input.reconnectElapsedMs,
		}),
	attemptFailed: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptFailedEvent =>
		({
			kind: 'reconnect.attempt.failed',
			source: input.source,
			message: input.message,
			reconnectElapsedMs: input.reconnectElapsedMs,
		}),
	timeout: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		windowMs: number;
		message?: string;
	}): ReconnectTimeoutEvent =>
		({
			kind: 'reconnect.timeout',
			source: input.source,
			message: input.message,
			reconnectElapsedMs: input.reconnectElapsedMs,
			windowMs: input.windowMs,
		}),
} as const;

export function formatReconnectEventFields(event: ReconnectEvent): string[] {
	switch (event.kind) {
		case 'reconnect.started':
			return [
				`reason=${safeDiagnosticString(event.reason)}`,
				`windowMs=${event.windowMs}`,
			];
		case 'reconnect.stopped':
			return [`reason=${safeDiagnosticString(event.reason)}`];
		case 'reconnect.start.blocked':
			return [
				`reason=${safeDiagnosticString(event.reason)}`,
				...(typeof event.isAutoConnecting === 'boolean'
					? [`isAutoConnecting=${String(event.isAutoConnecting)}`]
					: []),
				...(typeof event.isReconnecting === 'boolean'
					? [`isReconnecting=${String(event.isReconnecting)}`]
					: []),
				...(typeof event.resetInFlight === 'boolean'
					? [`resetInFlight=${String(event.resetInFlight)}`]
					: []),
			];
		case 'reconnect.retry.scheduled':
			return [`attemptIndex=${event.attemptIndex}`, `delayMs=${event.delayMs}`];
		case 'reconnect.attempt.started':
		case 'reconnect.attempt.connected':
		case 'reconnect.attempt.failed':
			return [`reconnectElapsedMs=${event.reconnectElapsedMs}`];
		case 'reconnect.timeout':
			return [
				`reconnectElapsedMs=${event.reconnectElapsedMs}`,
				`windowMs=${event.windowMs}`,
			];
	}
	const unreachable: never = event;
	return unreachable;
}
