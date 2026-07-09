import { type SavedEntryTailscaleRecovery } from './auto-connect-saved-entry';
import {
	networkDiagnosticEvents,
	tailscaleDiagnosticEvents,
	type ConnectionDiagnosticEvent,
} from './connection-diagnostics/events';
import {
	getNetworkPreflightAttentionMessage,
	isNetworkPreflightUsable,
	type NetworkPreflightSnapshot,
} from './network-preflight-core';

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

function emitNetworkPreflight(
	emit: (event: ConnectionDiagnosticEvent) => void,
	network: NetworkPreflightSnapshot | undefined,
) {
	if (!network) return;
	safeEmit(
		emit,
		networkDiagnosticEvents.preflightChecked({
			source: 'network-preflight',
			snapshot: network,
			usable: isNetworkPreflightUsable(network),
			message: getNetworkPreflightAttentionMessage(network) ?? undefined,
		}),
	);
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
		resetCooldown: recovery.resetCooldown
			? () => {
					recovery.resetCooldown?.();
				}
			: undefined,
		ensureReady: async () => {
			const readiness = await recovery.ensureReady();
			emitNetworkPreflight(
				emit,
				'network' in readiness ? readiness.network : undefined,
			);
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
			emitNetworkPreflight(
				emit,
				'network' in recoveryResult ? recoveryResult.network : undefined,
			);
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
