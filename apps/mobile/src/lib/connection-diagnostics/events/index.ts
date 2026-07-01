import { type AutoConnectEvent, autoConnectEventKinds } from './auto-connect';
import {
	type ManualDiagnosticEvent,
	manualDiagnosticEventKinds,
} from './manual';
import { type ReconnectEvent, reconnectEventKinds } from './reconnect';
import { type SavedEntryEvent, savedEntryEventKinds } from './saved-entry';
import { type SshDiagnosticEvent, sshDiagnosticEventKinds } from './ssh';
import {
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
