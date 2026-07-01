import {
	type ConnectionDiagnosticEvent,
	type diagnosticEvents,
} from '../../src/lib/connection-diagnostic-events';
import {
	type ActiveConnectionEvent,
	type SavedEntryConnectEvent,
} from '../../src/lib/connection-diagnostic-types';

type DiagnosticEventConstructorKind = ReturnType<
	(typeof diagnosticEvents)[keyof typeof diagnosticEvents]
>['kind'];

type ExactDiagnosticEventConstructorCoverage = [
	Exclude<ConnectionDiagnosticEvent['kind'], DiagnosticEventConstructorKind>,
	Exclude<DiagnosticEventConstructorKind, ConnectionDiagnosticEvent['kind']>,
] extends [never, never]
	? true
	: false;

const assertExactDiagnosticEventConstructorCoverage: ExactDiagnosticEventConstructorCoverage = true;
const assertGroupedTypeAliases:
	| Extract<
			ActiveConnectionEvent,
			{ kind: 'auto-connect.active-connection.selected' }
	  >
	| Extract<
			SavedEntryConnectEvent,
			{ kind: 'auto-connect.saved-entry.connect.started' }
	  >
	| null = null;

void assertExactDiagnosticEventConstructorCoverage;
void assertGroupedTypeAliases;
