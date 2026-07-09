import {
	formatNetworkPreflightSnapshot,
	type NetworkPreflightSnapshot,
} from '../../network-preflight-core';
import {
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type NetworkPreflightCheckedEvent = ConnectionDiagnosticEventBase & {
	kind: 'network.preflight.checked';
	snapshot: NetworkPreflightSnapshot;
	usable: boolean;
};

export type NetworkDiagnosticEvent = NetworkPreflightCheckedEvent;

export const networkDiagnosticEventKinds = [
	'network.preflight.checked',
] as const satisfies readonly NetworkDiagnosticEvent['kind'][];

function copyNetworkPreflightSnapshot(
	snapshot: NetworkPreflightSnapshot,
): NetworkPreflightSnapshot {
	return {
		connected: snapshot.connected,
		internetCapable: snapshot.internetCapable,
		validated: snapshot.validated,
		wifiConnected: snapshot.wifiConnected,
		transports: [...snapshot.transports],
	};
}

export const networkDiagnosticEvents = {
	preflightChecked: (input: {
		source: ConnectionDiagnosticSource;
		snapshot: NetworkPreflightSnapshot;
		usable: boolean;
		message?: string;
	}): NetworkPreflightCheckedEvent => ({
		kind: 'network.preflight.checked',
		source: input.source,
		message: input.message,
		snapshot: copyNetworkPreflightSnapshot(input.snapshot),
		usable: input.usable,
	}),
} as const;

export function formatNetworkDiagnosticEventFields(
	event: NetworkDiagnosticEvent,
): string[] {
	return [
		...formatNetworkPreflightSnapshot(event.snapshot),
		`usable=${event.usable}`,
	];
}
