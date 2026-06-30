import { normalizeTimedConnectionDiagnosticEvent } from './connection-diagnostic-normalization';
import {
	cloneDiagnosticValue,
	safeDiagnosticString,
} from './connection-diagnostic-redaction';
import {
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticRecorder,
	type ConnectionDiagnosticRecorderOptions,
	type ConnectionDiagnosticTimedEvent,
	type ConnectionDiagnosticTrace,
} from './connection-diagnostic-types';

type HistoryEntry = {
	order: number;
	trace: ConnectionDiagnosticTrace;
};

const DEFAULT_MAX_HISTORY = 20;

let traceSequence = 0;

function nextTraceId(now: number): string {
	traceSequence += 1;
	return `connection-diagnostic-${now}-${traceSequence}`;
}

function cloneTrace(
	trace: ConnectionDiagnosticTrace,
): ConnectionDiagnosticTrace {
	return {
		...trace,
		id: safeDiagnosticString(trace.id),
		reason: safeDiagnosticString(trace.reason),
		events: trace.events.map((event) => cloneDiagnosticValue(event)),
	};
}

function timestampEvent(input: {
	event: ConnectionDiagnosticEvent;
	startedAtMs: number;
	atMs: number;
}): ConnectionDiagnosticTimedEvent {
	return normalizeTimedConnectionDiagnosticEvent({
		event: input.event,
		startedAtMs: input.startedAtMs,
		atMs: input.atMs,
		elapsedMs: input.atMs - input.startedAtMs,
	});
}

export function createConnectionDiagnosticRecorder(
	options: ConnectionDiagnosticRecorderOptions = {},
): ConnectionDiagnosticRecorder {
	const now = options.now ?? Date.now;
	const maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
	let latestTrace: ConnectionDiagnosticTrace | null = null;
	let history: HistoryEntry[] = [];
	let recorderGeneration = 0;
	let traceOrderSequence = 0;

	return {
		startTrace: ({ trigger, reason }) => {
			const startedAtMs = now();
			const traceGeneration = recorderGeneration;
			traceOrderSequence += 1;
			const traceOrder = traceOrderSequence;
			const trace: ConnectionDiagnosticTrace = {
				id: nextTraceId(startedAtMs),
				trigger,
				reason: safeDiagnosticString(reason),
				status: 'running',
				startedAtMs,
				events: [],
			};
			latestTrace = trace;
			let finished = false;

			return {
				get trace() {
					return cloneTrace(trace);
				},
				event: (input) => {
					const event = timestampEvent({
						event: input,
						startedAtMs: trace.startedAtMs,
						atMs: now(),
					});
					if (!finished) {
						trace.events.push(event);
					}
					return cloneDiagnosticValue(event);
				},
				finish: (status) => {
					if (finished) {
						return;
					}
					finished = true;
					trace.status = status;
					trace.finishedAtMs = now();
					if (traceGeneration === recorderGeneration) {
						history = [
							...history.filter((entry) => entry.trace.id !== trace.id),
							{ order: traceOrder, trace: cloneTrace(trace) },
						]
							.sort((left, right) => left.order - right.order)
							.slice(-maxHistory);
					}
				},
			};
		},
		getLatestTrace: () => (latestTrace ? cloneTrace(latestTrace) : null),
		getHistory: () => history.map((entry) => cloneTrace(entry.trace)),
		clear: () => {
			recorderGeneration += 1;
			latestTrace = null;
			history = [];
		},
	};
}

export const connectionDiagnosticRecorder =
	createConnectionDiagnosticRecorder();
