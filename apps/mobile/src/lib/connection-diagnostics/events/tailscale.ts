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
			};
		case 'ready':
			return {
				kind: 'ready',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'cooldown':
			return {
				kind: 'cooldown',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'notStarted':
			return {
				kind: 'notStarted',
				attempted: readiness.attempted,
				available: readiness.available,
			};
		case 'failed':
			return {
				kind: 'failed',
				attempted: readiness.attempted,
				available: readiness.available,
			};
	}
	const unreachable: never = readiness;
	return unreachable;
}

function copyTailscaleRecoverAfterFailureResult(
	recoveryResult: TailscaleRecoverAfterFailureResult,
): TailscaleRecoverAfterFailureResult {
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
			};
		case 'cooldown':
			return {
				kind: 'cooldown',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'notStarted':
			return {
				kind: 'notStarted',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'preflightReady':
			return {
				kind: 'preflightReady',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'recovered':
			return {
				kind: 'recovered',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
		case 'failed':
			return {
				kind: 'failed',
				attempted: recoveryResult.attempted,
				networkLikeFailure: recoveryResult.networkLikeFailure,
				available: recoveryResult.available,
			};
	}
	const unreachable: never = recoveryResult;
	return unreachable;
}

export const tailscaleDiagnosticEvents = {
	ensureReadyResult: (input: {
		source: ConnectionDiagnosticSource;
		platformOS: string;
		readiness: TailscaleReadyResult;
		message?: string;
	}): TailscaleEnsureReadyEvent =>
		({
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
	}): TailscaleRecoveryResultEvent =>
		({
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
