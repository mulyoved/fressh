import { safeDiagnosticString } from './snapshot';
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type MdevBridgeLifecycleStage =
	| 'stream-starting'
	| 'hello-complete'
	| 'request-started'
	| 'request-completed'
	| 'request-failed'
	| 'stream-closed'
	| 'client-disposed';

export const mdevBridgeCloseClasses = [
	'disposedByReconnect',
	'clientDisposed',
	'remoteClosed',
	'sendFailed',
	'timeout',
	'protocolError',
	'startupFailed',
] as const;

export type MdevBridgeCloseClass = (typeof mdevBridgeCloseClasses)[number];

export function isMdevBridgeCloseClass(
	value: unknown,
): value is MdevBridgeCloseClass {
	return (
		typeof value === 'string' &&
		(mdevBridgeCloseClasses as readonly string[]).includes(value)
	);
}

export type MdevBridgeLifecycleEvent = ConnectionDiagnosticEventBase & {
	kind: 'mdev-bridge.lifecycle';
	stage: MdevBridgeLifecycleStage;
	operation?: string;
	requestId?: string;
	helloComplete?: boolean;
	bridgeRequestInFlight?: boolean;
	closeClass?: MdevBridgeCloseClass;
	success?: boolean;
};

export const mdevBridgeDiagnosticEventKinds = [
	'mdev-bridge.lifecycle',
] as const satisfies readonly MdevBridgeLifecycleEvent['kind'][];

export const mdevBridgeDiagnosticEvents = {
	lifecycle: (input: {
		source: ConnectionDiagnosticSource;
		stage: MdevBridgeLifecycleStage;
		operation?: string;
		requestId?: string;
		helloComplete?: boolean;
		bridgeRequestInFlight?: boolean;
		closeClass?: MdevBridgeCloseClass;
		success?: boolean;
		message?: string;
	}): MdevBridgeLifecycleEvent => ({
		kind: 'mdev-bridge.lifecycle',
		source: input.source,
		message: input.message,
		stage: input.stage,
		operation: input.operation,
		requestId: input.requestId,
		helloComplete: input.helloComplete,
		bridgeRequestInFlight: input.bridgeRequestInFlight,
		closeClass: input.closeClass,
		...(typeof input.success === 'boolean' ? { success: input.success } : {}),
	}),
} as const;

export function formatMdevBridgeEventFields(
	event: MdevBridgeLifecycleEvent,
): string[] {
	return [
		`stage=${safeDiagnosticString(event.stage)}`,
		...(event.operation
			? [`operation=${safeDiagnosticString(event.operation)}`]
			: []),
		...(event.requestId
			? [`requestId=${safeDiagnosticString(event.requestId)}`]
			: []),
		...(typeof event.helloComplete === 'boolean'
			? [`helloComplete=${String(event.helloComplete)}`]
			: []),
		...(typeof event.bridgeRequestInFlight === 'boolean'
			? [`bridgeRequestInFlight=${String(event.bridgeRequestInFlight)}`]
			: []),
		...(event.closeClass
			? [`closeClass=${safeDiagnosticString(event.closeClass)}`]
			: []),
		...(typeof event.success === 'boolean'
			? [`success=${String(event.success)}`]
			: []),
	];
}
