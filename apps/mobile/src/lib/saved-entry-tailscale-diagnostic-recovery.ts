import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	tailscaleDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from './connection-diagnostics/events';

function safeEmit(
	emit: (event: ConnectionDiagnosticEvent) => void,
	event: ConnectionDiagnosticEvent,
) {
	try {
		emit(event);
	} catch {
		// Diagnostic sinks must not change recovery policy outcomes.
	}
}

export function createSavedEntryTailscaleDiagnosticRecovery({
	platformOS,
	recovery,
	emit,
}: {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	emit: (event: ConnectionDiagnosticEvent) => void;
}): SavedEntryTailscaleRecovery {
	return {
		ensureReady: async () => {
			const readiness = await recovery.ensureReady();
			safeEmit(
				emit,
				tailscaleDiagnosticEvents.ensureReadyResult({
					source: 'tailscale-recovery',
					platformOS,
					readiness,
				}),
			);
			return readiness;
		},
		recoverAfterFailure: async (error) => {
			const recoveryResult = await recovery.recoverAfterFailure(error);
			safeEmit(
				emit,
				tailscaleDiagnosticEvents.recoveryResult({
					source: 'tailscale-recovery',
					recoveryResult,
				}),
			);
			return recoveryResult;
		},
	};
}
