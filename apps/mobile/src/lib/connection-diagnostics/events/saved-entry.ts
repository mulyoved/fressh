import { copyConnectionIdentity } from './identity';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type SavedEntrySelectedEvent = ConnectionDiagnosticEventBase & {
	kind: 'saved-entry.selected';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SavedEntryMissingEvent = ConnectionDiagnosticEventBase & {
	kind: 'saved-entry.missing';
};

export type SavedEntryInvalidTmuxSettingsEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'saved-entry.invalid-tmux-settings';
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
	};

export type KeyResolvedEvent = ConnectionDiagnosticEventBase & {
	kind: 'key.resolved';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type KeyMissingEvent = ConnectionDiagnosticEventBase & {
	kind: 'key.missing';
	connection: ConnectionDiagnosticConnectionIdentity;
};

export type SavedEntryEvent =
	| SavedEntrySelectedEvent
	| SavedEntryMissingEvent
	| SavedEntryInvalidTmuxSettingsEvent
	| KeyResolvedEvent
	| KeyMissingEvent;

export const savedEntryEventKinds = [
	'saved-entry.selected',
	'saved-entry.missing',
	'saved-entry.invalid-tmux-settings',
	'key.resolved',
	'key.missing',
] as const satisfies readonly SavedEntryEvent['kind'][];

const withSource = <T extends SavedEntryEvent>(event: T): T => event;

export const savedEntryEvents = {
	selected: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): SavedEntrySelectedEvent =>
		withSource({
			kind: 'saved-entry.selected',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	missing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): SavedEntryMissingEvent =>
		withSource({
			kind: 'saved-entry.missing',
			source: input.source,
			message: input.message,
		}),
	invalidTmuxSettings: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		useTmuxType: string;
		tmuxSessionNameType: string;
	}): SavedEntryInvalidTmuxSettingsEvent =>
		withSource({
			kind: 'saved-entry.invalid-tmux-settings',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
			useTmuxType: input.useTmuxType,
			tmuxSessionNameType: input.tmuxSessionNameType,
		}),
	keyResolved: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): KeyResolvedEvent =>
		withSource({
			kind: 'key.resolved',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
	keyMissing: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
	}): KeyMissingEvent =>
		withSource({
			kind: 'key.missing',
			source: input.source,
			connection: copyConnectionIdentity(input.connection),
		}),
} as const;
