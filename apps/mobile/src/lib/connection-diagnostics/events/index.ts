import {
	type AutoConnectEvent,
	autoConnectEventKinds,
	formatAutoConnectEventFields,
} from './auto-connect';
import {
	formatManualDiagnosticEventFields,
	type ManualDiagnosticEvent,
	manualDiagnosticEventKinds,
} from './manual';
import {
	formatReconnectEventFields,
	type ReconnectEvent,
	reconnectEventKinds,
} from './reconnect';
import {
	formatSavedEntryEventFields,
	type SavedEntryEvent,
	savedEntryEventKinds,
} from './saved-entry';
import {
	formatSshEventFields,
	type SshDiagnosticEvent,
	sshDiagnosticEventKinds,
} from './ssh';
import {
	formatTailscaleDiagnosticEventFields,
	type TailscaleDiagnosticEvent,
	tailscaleDiagnosticEventKinds,
} from './tailscale';
import {
	type ConnectionDiagnosticTraceOf,
	type TimedConnectionDiagnosticEvent,
} from './types';

export * from './auto-connect';
export * from './identity';
export * from './manual';
export * from './prompt-format';
export * from './reconnect';
export * from './saved-entry';
export * from './snapshot';
export * from './ssh';
export * from './tailscale';
export * from './types';

export type ConnectionDiagnosticEvent =
	| SavedEntryEvent
	| SshDiagnosticEvent
	| AutoConnectEvent
	| ManualDiagnosticEvent
	| TailscaleDiagnosticEvent
	| ReconnectEvent;
export type ConnectionDiagnosticTimedEvent =
	TimedConnectionDiagnosticEvent<ConnectionDiagnosticEvent>;
export type ConnectionDiagnosticTrace =
	ConnectionDiagnosticTraceOf<ConnectionDiagnosticEvent>;

export const connectionDiagnosticEventKinds = [
	...savedEntryEventKinds,
	...sshDiagnosticEventKinds,
	...autoConnectEventKinds,
	...manualDiagnosticEventKinds,
	...tailscaleDiagnosticEventKinds,
	...reconnectEventKinds,
] as const satisfies readonly ConnectionDiagnosticEvent['kind'][];

function isConnectionDiagnosticEventKind<
	Kind extends ConnectionDiagnosticEvent['kind'],
>(
	event: ConnectionDiagnosticEvent,
	kinds: readonly Kind[],
): event is Extract<ConnectionDiagnosticEvent, { kind: Kind }> {
	return (kinds as readonly string[]).includes(event.kind);
}

function assertNeverConnectionDiagnosticEvent(event: never): never {
	throw new Error(
		`Unhandled connection diagnostic event kind: ${JSON.stringify(event)}`,
	);
}

export function formatConnectionDiagnosticEventFields(
	event: ConnectionDiagnosticEvent,
): string[] {
	if (isConnectionDiagnosticEventKind(event, savedEntryEventKinds)) {
		return formatSavedEntryEventFields(event);
	}
	if (isConnectionDiagnosticEventKind(event, sshDiagnosticEventKinds)) {
		return formatSshEventFields(event);
	}
	if (isConnectionDiagnosticEventKind(event, autoConnectEventKinds)) {
		return formatAutoConnectEventFields(event);
	}
	if (isConnectionDiagnosticEventKind(event, manualDiagnosticEventKinds)) {
		return formatManualDiagnosticEventFields(event);
	}
	if (isConnectionDiagnosticEventKind(event, tailscaleDiagnosticEventKinds)) {
		return formatTailscaleDiagnosticEventFields(event);
	}
	if (isConnectionDiagnosticEventKind(event, reconnectEventKinds)) {
		return formatReconnectEventFields(event);
	}
	return assertNeverConnectionDiagnosticEvent(event);
}
