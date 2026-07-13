import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeSecretsManagerServices } from '../../src/lib/secrets-manager-initialization';

function deferred() {
	let resolve: (() => void) | undefined;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return {
		promise,
		resolve: () => resolve?.(),
	};
}

void test('recovery loads the journal only after both startup migrations settle', async () => {
	const events: string[] = [];
	const secureStorage = deferred();
	const connections = deferred();

	const initialization = initializeSecretsManagerServices({
		initializeSecureStorage: async () => {
			events.push('secureStorage.initialize started');
			await secureStorage.promise;
			events.push('secureStorage.initialize settled');
		},
		ensureConnectionsReady: async () => {
			events.push('connectionStorage.ensureReady started');
			await connections.promise;
			events.push('connectionStorage.ensureReady settled');
		},
		recoverPendingRestore: async () => {
			events.push('restoreJournal.load');
			events.push('recoverPendingRestore replaceAllKeys');
			events.push('recoverPendingRestore replaceAllConnections');
			return 'recovered';
		},
	});

	await Promise.resolve();
	assert.deepEqual(events, [
		'secureStorage.initialize started',
		'connectionStorage.ensureReady started',
	]);

	secureStorage.resolve();
	await Promise.resolve();
	assert.deepEqual(events, [
		'secureStorage.initialize started',
		'connectionStorage.ensureReady started',
		'secureStorage.initialize settled',
	]);

	connections.resolve();
	assert.equal(await initialization, 'recovered');
	assert.deepEqual(events, [
		'secureStorage.initialize started',
		'connectionStorage.ensureReady started',
		'secureStorage.initialize settled',
		'connectionStorage.ensureReady settled',
		'restoreJournal.load',
		'recoverPendingRestore replaceAllKeys',
		'recoverPendingRestore replaceAllConnections',
	]);
});
