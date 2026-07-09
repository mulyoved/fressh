import { NativeModules, Platform } from 'react-native';
import { rootLogger } from './logger';
import {
	type NetworkPreflightSnapshot,
	type NetworkTransport,
} from './network-preflight-core';

type NetworkPreflightNativeModule = {
	getNetworkSnapshot?: () => Promise<unknown>;
};

const nativeModule = NativeModules.FresshConnectivity as
	| NetworkPreflightNativeModule
	| undefined;
const logger = rootLogger.extend('NetworkPreflight');

function isTransport(value: unknown): value is NetworkTransport {
	return (
		value === 'wifi' ||
		value === 'cellular' ||
		value === 'ethernet' ||
		value === 'vpn' ||
		value === 'bluetooth' ||
		value === 'other'
	);
}

function normalizeSnapshot(value: unknown): NetworkPreflightSnapshot | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const transports = Array.isArray(record.transports)
		? record.transports.filter(isTransport)
		: [];
	const validated =
		typeof record.validated === 'boolean' ? record.validated : null;

	return {
		connected: record.connected === true,
		internetCapable: record.internetCapable === true,
		validated,
		wifiConnected: record.wifiConnected === true,
		transports,
	};
}

export async function getNetworkPreflightSnapshot(): Promise<NetworkPreflightSnapshot | null> {
	if (Platform.OS !== 'android') return null;
	if (!nativeModule?.getNetworkSnapshot) return null;

	try {
		return normalizeSnapshot(await nativeModule.getNetworkSnapshot());
	} catch (error) {
		logger.warn('network preflight snapshot failed', error);
		return null;
	}
}
