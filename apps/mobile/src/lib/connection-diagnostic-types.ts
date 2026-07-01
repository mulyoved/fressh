import {
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticStatus,
	type ConnectionDiagnosticTrace,
	type ConnectionDiagnosticTraceHandleOf,
} from './connection-diagnostics/events';

export type * from './connection-diagnostics/events';
export type {
	ActiveConnectionEvent,
	SavedEntryConnectEvent,
} from './connection-diagnostic-events';

export type ConnectionDiagnosticTraceHandle =
	ConnectionDiagnosticTraceHandleOf<ConnectionDiagnosticEvent>;

export type ConnectionDiagnosticRecorder = {
	startTrace: (input: {
		trigger: ConnectionDiagnosticTrace['trigger'];
		reason: string;
	}) => ConnectionDiagnosticTraceHandle;
	getLatestTrace: () => ConnectionDiagnosticTrace | null;
	getHistory: () => ConnectionDiagnosticTrace[];
	clear: () => void;
};

export type ConnectionDiagnosticFinishedStatus = Exclude<
	ConnectionDiagnosticStatus,
	'running'
>;
