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

export type ReconnectDestination = 'terminal' | 'hostPage';
export type ReconnectCompletionOutcome =
	| 'connected'
	| 'needsAttention'
	| 'failedNetwork'
	| 'failedAuth'
	| 'failedTmuxAttach'
	| 'timeout'
	| 'aborted'
	| 'cleanupFailed';

export type ReconnectShellDroppedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.shell-dropped';
	connectionId?: string;
	channelId?: number;
	networkDisappeared?: boolean;
};

export type ReconnectTransportInvalidatedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'reconnect.transport.invalidated';
		connectionId?: string;
		channelId?: number;
		hadShell: boolean;
		bridgeDisposed: boolean;
		bridgeRequestInFlight: boolean;
	};

export type ReconnectCompletedEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.completed';
	outcome: ReconnectCompletionOutcome;
	destination: ReconnectDestination;
};

export type ReconnectStaleInputEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.stale-input';
	connectionId?: string;
	channelId?: number;
};

export type ReconnectUiTransitionEvent = ConnectionDiagnosticEventBase & {
	kind: 'reconnect.ui.transition';
	from: 'terminalOverlay' | 'terminal' | 'hostPage' | 'hidden';
	to: 'terminalOverlay' | 'terminal' | 'hostPage' | 'hidden';
};

export type ReconnectEvent =
	| ReconnectStartedEvent
	| ReconnectStoppedEvent
	| ReconnectStartBlockedEvent
	| ReconnectRetryScheduledEvent
	| ReconnectAttemptStartedEvent
	| ReconnectAttemptConnectedEvent
	| ReconnectAttemptFailedEvent
	| ReconnectTimeoutEvent
	| ReconnectShellDroppedEvent
	| ReconnectTransportInvalidatedEvent
	| ReconnectCompletedEvent
	| ReconnectStaleInputEvent
	| ReconnectUiTransitionEvent;

export const reconnectEventKinds = [
	'reconnect.started',
	'reconnect.stopped',
	'reconnect.start.blocked',
	'reconnect.retry.scheduled',
	'reconnect.attempt.started',
	'reconnect.attempt.connected',
	'reconnect.attempt.failed',
	'reconnect.timeout',
	'reconnect.shell-dropped',
	'reconnect.transport.invalidated',
	'reconnect.completed',
	'reconnect.stale-input',
	'reconnect.ui.transition',
] as const satisfies readonly ReconnectEvent['kind'][];

export const reconnectEvents = {
	started: (input: {
		source: ConnectionDiagnosticSource;
		reason: string;
		windowMs: number;
		message?: string;
	}): ReconnectStartedEvent => ({
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
	}): ReconnectStoppedEvent => ({
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
	}): ReconnectStartBlockedEvent => ({
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
	}): ReconnectRetryScheduledEvent => ({
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
	}): ReconnectAttemptStartedEvent => ({
		kind: 'reconnect.attempt.started',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
	}),
	attemptConnected: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptConnectedEvent => ({
		kind: 'reconnect.attempt.connected',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
	}),
	attemptFailed: (input: {
		source: ConnectionDiagnosticSource;
		reconnectElapsedMs: number;
		message?: string;
	}): ReconnectAttemptFailedEvent => ({
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
	}): ReconnectTimeoutEvent => ({
		kind: 'reconnect.timeout',
		source: input.source,
		message: input.message,
		reconnectElapsedMs: input.reconnectElapsedMs,
		windowMs: input.windowMs,
	}),
	shellDropped: (input: {
		source: ConnectionDiagnosticSource;
		connectionId?: string;
		channelId?: number;
		networkDisappeared?: boolean;
		message?: string;
	}): ReconnectShellDroppedEvent => ({
		kind: 'reconnect.shell-dropped',
		source: input.source,
		message: input.message,
		connectionId: input.connectionId,
		channelId: input.channelId,
		networkDisappeared: input.networkDisappeared,
	}),
	transportInvalidated: (input: {
		source: ConnectionDiagnosticSource;
		connectionId?: string;
		channelId?: number;
		hadShell: boolean;
		bridgeDisposed: boolean;
		bridgeRequestInFlight: boolean;
		message?: string;
	}): ReconnectTransportInvalidatedEvent => ({
		kind: 'reconnect.transport.invalidated',
		source: input.source,
		message: input.message,
		connectionId: input.connectionId,
		channelId: input.channelId,
		hadShell: input.hadShell,
		bridgeDisposed: input.bridgeDisposed,
		bridgeRequestInFlight: input.bridgeRequestInFlight,
	}),
	completed: (input: {
		source: ConnectionDiagnosticSource;
		outcome: ReconnectCompletionOutcome;
		destination: ReconnectDestination;
		message?: string;
	}): ReconnectCompletedEvent => ({
		kind: 'reconnect.completed',
		source: input.source,
		message: input.message,
		outcome: input.outcome,
		destination: input.destination,
	}),
	staleInput: (input: {
		source: ConnectionDiagnosticSource;
		connectionId?: string;
		channelId?: number;
		message?: string;
	}): ReconnectStaleInputEvent => ({
		kind: 'reconnect.stale-input',
		source: input.source,
		message: input.message,
		connectionId: input.connectionId,
		channelId: input.channelId,
	}),
	uiTransition: (input: {
		source: ConnectionDiagnosticSource;
		from: ReconnectUiTransitionEvent['from'];
		to: ReconnectUiTransitionEvent['to'];
		message?: string;
	}): ReconnectUiTransitionEvent => ({
		kind: 'reconnect.ui.transition',
		source: input.source,
		message: input.message,
		from: input.from,
		to: input.to,
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
		case 'reconnect.shell-dropped':
			return [
				...(event.connectionId
					? [`connectionId=${safeDiagnosticString(event.connectionId)}`]
					: []),
				...(typeof event.channelId === 'number'
					? [`channelId=${event.channelId}`]
					: []),
				...(typeof event.networkDisappeared === 'boolean'
					? [`networkDisappeared=${String(event.networkDisappeared)}`]
					: []),
			];
		case 'reconnect.transport.invalidated':
			return [
				...(event.connectionId
					? [`connectionId=${safeDiagnosticString(event.connectionId)}`]
					: []),
				...(typeof event.channelId === 'number'
					? [`channelId=${event.channelId}`]
					: []),
				`hadShell=${String(event.hadShell)}`,
				`bridgeDisposed=${String(event.bridgeDisposed)}`,
				`bridgeRequestInFlight=${String(event.bridgeRequestInFlight)}`,
			];
		case 'reconnect.completed':
			return [
				`outcome=${safeDiagnosticString(event.outcome)}`,
				`destination=${safeDiagnosticString(event.destination)}`,
			];
		case 'reconnect.stale-input':
			return [
				...(event.connectionId
					? [`connectionId=${safeDiagnosticString(event.connectionId)}`]
					: []),
				...(typeof event.channelId === 'number'
					? [`channelId=${event.channelId}`]
					: []),
			];
		case 'reconnect.ui.transition':
			return [
				`from=${safeDiagnosticString(event.from)}`,
				`to=${safeDiagnosticString(event.to)}`,
			];
	}
	const unreachable: never = event;
	return unreachable;
}
