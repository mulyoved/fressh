export const NETWORK_UNAVAILABLE_MESSAGE =
	'No network connection. Connect Wi-Fi, then retry.';

export type NetworkTransport =
	| 'wifi'
	| 'cellular'
	| 'ethernet'
	| 'vpn'
	| 'bluetooth'
	| 'other';

export type NetworkPreflightSnapshot = {
	connected: boolean;
	internetCapable: boolean;
	validated: boolean | null;
	wifiConnected: boolean;
	transports: NetworkTransport[];
};

export function isNetworkPreflightUsable(snapshot: NetworkPreflightSnapshot) {
	return snapshot.connected && snapshot.internetCapable;
}

export function getNetworkPreflightAttentionMessage(
	snapshot: NetworkPreflightSnapshot,
) {
	return isNetworkPreflightUsable(snapshot)
		? null
		: NETWORK_UNAVAILABLE_MESSAGE;
}

export function formatNetworkPreflightSnapshot(
	snapshot: NetworkPreflightSnapshot,
) {
	return [
		`connected=${snapshot.connected}`,
		`internetCapable=${snapshot.internetCapable}`,
		`validated=${snapshot.validated}`,
		`wifiConnected=${snapshot.wifiConnected}`,
		`transports=${
			snapshot.transports.length > 0 ? snapshot.transports.join(',') : 'none'
		}`,
	];
}
