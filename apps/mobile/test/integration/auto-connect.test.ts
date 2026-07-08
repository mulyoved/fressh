import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildPendingReconnectContext,
	pickLatestSavedReconnectConnection,
} from '../../src/lib/auto-connect-manager-helpers';
import {
	getAutoConnectLaunchActionForUrl,
	shouldSkipInitialAutoConnectForUrl,
} from '../../src/lib/auto-connect-launch';

function createSavedEntry({
	metadata,
	value,
}: {
	metadata: {
		createdAtMs: number;
		modifiedAtMs: number;
		priority: number;
	};
	value: {
		username: string;
		host: string;
		port: number;
		useTmux: boolean;
		tmuxSessionName: string;
		autoConnect: boolean;
		security: { type: 'key'; keyId: string };
	};
}) {
	return {
		id: `${value.username}-${value.host}-${value.port}`.replaceAll('.', '_'),
		metadata,
		value,
	};
}

void test('e2e launch URL can suppress the initial auto-connect attempt', () => {
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=1',
		),
		true,
	);
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=true',
		),
		true,
	);
});

void test('normal launch URLs do not suppress initial auto-connect', () => {
	assert.equal(shouldSkipInitialAutoConnectForUrl(null), false);
	assert.equal(shouldSkipInitialAutoConnectForUrl('fressh:///'), false);
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=0',
		),
		false,
	);
	assert.equal(shouldSkipInitialAutoConnectForUrl('not a url'), false);
});

void test('e2e launch URL routes warm launches back to the connection form', () => {
	assert.deepEqual(
		getAutoConnectLaunchActionForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=1',
		),
		{
			routeToConnectionForm: true,
			skipAutoConnect: true,
		},
	);
});

void test('shell-drop reconnect context preserves dropped shell identity for reconnect attempts', () => {
	const context = buildPendingReconnectContext({
		pathname: '/shell/detail',
		shells: [
			{
				connectionId: 'conn-older',
				channelId: 2,
				createdAtMs: 10,
			},
			{
				connectionId: 'conn-dropped',
				channelId: 7,
				createdAtMs: 20,
			},
		],
		connections: {
			'conn-dropped': {
				connectionDetails: {
					username: 'muly',
					host: '100.64.0.10',
					port: 22,
				},
			},
		},
	});

	assert.deepEqual(context, {
		trigger: 'reconnect',
		pathname: '/shell/detail',
		droppedConnectionId: 'conn-dropped',
		droppedChannelId: 7,
		droppedStoredConnectionId: 'muly-100_64_0_10-22',
	});
});

void test('reconnect fallback can choose the latest saved entry even when auto-connect is disabled', () => {
	const selected = pickLatestSavedReconnectConnection([
		createSavedEntry({
			metadata: {
				createdAtMs: 1,
				modifiedAtMs: 10,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.11',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: true,
				security: { type: 'key', keyId: 'key-1' },
			},
		}),
		createSavedEntry({
			metadata: {
				createdAtMs: 2,
				modifiedAtMs: 20,
				priority: 0,
			},
			value: {
				username: 'muly',
				host: '100.64.0.10',
				port: 22,
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
				security: { type: 'key', keyId: 'key-2' },
			},
		}),
	]);

	assert.equal(selected?.value.autoConnect, false);
	assert.equal(selected?.value.host, '100.64.0.10');
});
