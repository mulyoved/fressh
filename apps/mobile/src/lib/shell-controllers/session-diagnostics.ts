import {
	formatConnectionDiagnosticEventFields,
	type ConnectionDiagnosticEvent,
} from '../connection-diagnostics';

export type ShellDiagnosticPort = {
	event(event: ConnectionDiagnosticEvent): void;
	warn(message: string, error?: unknown): void;
};

type ShellDiagnosticTraceSink = {
	event(event: ConnectionDiagnosticEvent): unknown;
};

export type CreateShellDiagnosticPortInput = {
	readonly generation: number;
	getCurrentGeneration(): number;
	getActiveTrace(): ShellDiagnosticTraceSink | null;
	getEventDetails?(event: ConnectionDiagnosticEvent): unknown;
	logger: {
		info?(message: string, details?: unknown): void;
		warn(message: string, error?: unknown): void;
	};
};

export function createShellDiagnosticPort({
	generation,
	getCurrentGeneration,
	getActiveTrace,
	getEventDetails,
	logger,
}: CreateShellDiagnosticPortInput): ShellDiagnosticPort {
	const warn = (message: string, error?: unknown): void => {
		try {
			logger.warn(message, error);
		} catch {
			// Diagnostics must not affect the session lifecycle.
		}
	};

	return {
		event: (event) => {
			try {
				if (getCurrentGeneration() !== generation) return;
				getActiveTrace()?.event(event);
				if (getEventDetails && logger.info) {
					logger.info('Workmux diagnostic event', getEventDetails(event));
				}
			} catch (error) {
				let fields = '';
				try {
					fields = formatConnectionDiagnosticEventFields(event).join(', ');
				} catch {
					// A malformed event must not reveal arbitrary object fields.
				}
				warn(
					`Failed to record shell diagnostic event${
						fields ? ` (${fields})` : ''
					}`,
					error,
				);
			}
		},
		warn,
	};
}
