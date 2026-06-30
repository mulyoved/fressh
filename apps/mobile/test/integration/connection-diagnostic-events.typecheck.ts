import {
	type ConnectionDiagnosticEvent,
	type diagnosticEvents,
} from '../../src/lib/connection-diagnostic-events';

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

void assertExactDiagnosticEventConstructorCoverage;
