import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	NETWORK_UNAVAILABLE_MESSAGE,
	formatNetworkPreflightSnapshot,
	getNetworkPreflightAttentionMessage,
	isNetworkPreflightUsable,
	type NetworkPreflightSnapshot,
} from '../../src/lib/network-preflight-core';

const disconnected: NetworkPreflightSnapshot = {
	connected: false,
	internetCapable: false,
	validated: false,
	wifiConnected: false,
	transports: [],
};

void test('network preflight blocks when no active internet network exists', () => {
	assert.equal(isNetworkPreflightUsable(disconnected), false);
	assert.equal(
		getNetworkPreflightAttentionMessage(disconnected),
		NETWORK_UNAVAILABLE_MESSAGE,
	);
});

void test('network preflight records disconnected Wi-Fi without blocking usable cellular', () => {
	const cellular: NetworkPreflightSnapshot = {
		connected: true,
		internetCapable: true,
		validated: true,
		wifiConnected: false,
		transports: ['cellular'],
	};

	assert.equal(isNetworkPreflightUsable(cellular), true);
	assert.equal(getNetworkPreflightAttentionMessage(cellular), null);
});

void test('network preflight formatter exposes the connectivity fields', () => {
	assert.deepEqual(formatNetworkPreflightSnapshot(disconnected), [
		'connected=false',
		'internetCapable=false',
		'validated=false',
		'wifiConnected=false',
		'transports=none',
	]);
});
