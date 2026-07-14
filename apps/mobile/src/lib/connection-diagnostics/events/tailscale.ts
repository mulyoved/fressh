import { type NetworkPreflightSnapshot } from '../../network-preflight-core';
import {
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from '../../tailscale-recovery-core';
import { formatDiagnosticJsonInline } from './prompt-format';
import { safeDiagnosticString } from './snapshot';
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type TailscaleEnsureReadyEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.ensure-ready.result';
	platformOS: string;
	readiness: TailscaleReadyResult;
};

export type TailscaleRecoveryResultEvent = ConnectionDiagnosticEventBase & {
	kind: 'tailscale.recovery.result';
	recoveryResult: TailscaleRecoverAfterFailureResult;
};

export type TailscaleDiagnosticEvent =
	| TailscaleEnsureReadyEvent
	| TailscaleRecoveryResultEvent;

export const tailscaleDiagnosticEventKinds = [
	'tailscale.ensure-ready.result',
	'tailscale.recovery.result',
] as const satisfies readonly TailscaleDiagnosticEvent['kind'][];

function copyTailscaleReadyResult(
	readiness: TailscaleReadyResult,
): TailscaleReadyResult {
	const network = copyOptionalNetwork(
		'network' in readiness ? readiness.network : undefined,
	);
	switch (readiness.kind) {
		case 'unsupported':
			return {
				kind: 'unsupported',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'unavailable':
			return {
				kind: 'unavailable',
				attempted: readiness.attempted,
				available: readiness.available,
				...(network ? { network } : {}),
			};
		case 'networkUnavailable':
			return {
				kind: 'networkUnavailable',
				attempted: readiness.attempted,
				available: readiness.available,
				network: network ?? readiness.network,
			};
		case 'ready':
			return {
				kind: 'ready',
				attempted: readiness.attempted,
				available: readiness.available,
				...(network ? { network } : {}),
			};
		case 'cooldown':
			return {
				kind: 'cooldown',
				attempted: readiness.attempted,
				available: readiness.available,
				...(network ? { network } : {}),
			};
		case 'notStarted':
			return {
				kind: 'notStarted',
				attempted: readiness.attempted,
				available: readiness.available,
				...(network ? { network } : {}),
			};
		case 'failed':
			return {
				kind: 'failed',
				attempted: readiness.attempted,
				available: readiness.available,
				...(network ? { network } : {}),
			};
	}
	const unreachable: never = readiness;
	return unreachable;
}

function copyTailscaleRecoverAfterFailureResult(
	recoveryResult: TailscaleRecoverAfterFailureResult,
): TailscaleRecoverAfterFailureResult {
	const network = copyOptionalNetwork(
		'network' in recoveryResult ? recoveryResult.network : undefined,
	);
	switch (recoveryResult.kind) {
		case 'nonNetworkFailure':
			return {
				kind: 'nonNetworkFailure',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'unsupported':
			return {
				kind: 'unsupported',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'unavailable':
			return {
				kind: 'unavailable',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				...(network ? { network } : {}),
			};
		case 'networkUnavailable':
			return {
				kind: 'networkUnavailable',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				network: network ?? recoveryResult.network,
			};
		case 'cooldown':
			return {
				kind: 'cooldown',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				...(network ? { network } : {}),
			};
		case 'notStarted':
			return {
				kind: 'notStarted',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				...(network ? { network } : {}),
			};
		case 'preflightReady':
			return {
				kind: 'preflightReady',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				...(network ? { network } : {}),
			};
		case 'recovered':
			return {
				kind: 'recovered',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				...(network ? { network } : {}),
			};
		case 'failed':
			return {
				kind: 'failed',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
				...(network ? { network } : {}),
			};
	}
	const unreachable: never = recoveryResult;
	return unreachable;
}

function copyOptionalNetwork(
	network: NetworkPreflightSnapshot | undefined,
): NetworkPreflightSnapshot | undefined {
	if (!network) return undefined;
	return {
		connected: network.connected,
		internetCapable: network.internetCapable,
		validated: network.validated,
		wifiConnected: network.wifiConnected,
		transports: [...network.transports],
	};
}

export const tailscaleDiagnosticEvents = {
	ensureReadyResult: (input: {
		source: ConnectionDiagnosticSource;
		platformOS: string;
		readiness: TailscaleReadyResult;
		message?: string;
	}): TailscaleEnsureReadyEvent => ({
		kind: 'tailscale.ensure-ready.result',
		source: input.source,
		message: input.message,
		platformOS: input.platformOS,
		readiness: copyTailscaleReadyResult(input.readiness),
	}),
	recoveryResult: (input: {
		source: ConnectionDiagnosticSource;
		recoveryResult: TailscaleRecoverAfterFailureResult;
		message?: string;
	}): TailscaleRecoveryResultEvent => ({
		kind: 'tailscale.recovery.result',
		source: input.source,
		message: input.message,
		recoveryResult: copyTailscaleRecoverAfterFailureResult(
			input.recoveryResult,
		),
	}),
} as const;

export function formatTailscaleDiagnosticEventFields(
	event: TailscaleDiagnosticEvent,
): string[] {
	switch (event.kind) {
		case 'tailscale.ensure-ready.result':
			return [
				`platformOS=${safeDiagnosticString(event.platformOS)}`,
				`readiness=${formatDiagnosticJsonInline(event.readiness)}`,
			];
		case 'tailscale.recovery.result':
			return [
				`recoveryResult=${formatDiagnosticJsonInline(event.recoveryResult)}`,
			];
	}
	const unreachable: never = event;
	return unreachable;
}
