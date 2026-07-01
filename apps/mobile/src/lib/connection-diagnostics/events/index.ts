import { type SavedEntryEvent, savedEntryEventKinds } from './saved-entry';
import {
	type ConnectionDiagnosticTraceOf,
	type TimedConnectionDiagnosticEvent,
} from './types';

export * from './identity';
export * from './prompt-format';
export * from './saved-entry';
export * from './snapshot';
export * from './types';

export type ConnectionDiagnosticEvent = SavedEntryEvent;
export type ConnectionDiagnosticTimedEvent =
	TimedConnectionDiagnosticEvent<ConnectionDiagnosticEvent>;
export type ConnectionDiagnosticTrace =
	ConnectionDiagnosticTraceOf<ConnectionDiagnosticEvent>;

export const connectionDiagnosticEventKinds = [
	...savedEntryEventKinds,
] as const satisfies readonly ConnectionDiagnosticEvent['kind'][];
