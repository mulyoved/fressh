import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TMUX_PROJECT_METADATA_CACHE_VERSION,
	buildTmuxNavProjectCommand,
	buildTmuxPaneProjectCommand,
	createTmuxProjectMetadataCache,
	parseTmuxProjectMetadataOutput,
	type TmuxProjectMetadata,
	type TmuxProjectMetadataCacheStorage,
} from '../../src/lib/tmux-project-metadata';

const stableConnectionId = 'connection.1';
const tmuxSessionName = 'main';

const metadata: TmuxProjectMetadata = {
	sessionName: 'main',
	windowId: '@3',
	windowIndex: 3,
	windowName: 'mobile',
	paneId: '%12',
	panePath: '/home/muly/fressh/apps/mobile',
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
};

function createMemoryStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
	const storage: TmuxProjectMetadataCacheStorage = {
		getString: (key) => entries.get(key),
		set: (key, value) => {
			entries.set(key, value);
		},
		delete: (key) => {
			entries.delete(key);
		},
	};
	return { entries, storage };
}

void test('parseTmuxProjectMetadataOutput extracts the final metadata JSON object', () => {
	const output = [
		"mdev tmux pane project 'main:'",
		JSON.stringify(metadata),
	].join('\n');

	assert.deepEqual(parseTmuxProjectMetadataOutput(output), metadata);
});

void test('parseTmuxProjectMetadataOutput rejects malformed metadata', () => {
	assert.equal(parseTmuxProjectMetadataOutput('not json'), null);
	assert.equal(
		parseTmuxProjectMetadataOutput(
			JSON.stringify({ ...metadata, windowIndex: '3' }),
		),
		null,
	);
	assert.equal(
		parseTmuxProjectMetadataOutput(
			JSON.stringify({ ...metadata, projectRoot: '' }),
		),
		null,
	);
});

void test('tmux project command builders use mdev and shell-quote targets', () => {
	assert.equal(
		buildTmuxPaneProjectCommand("main'quoted"),
		"mdev tmux pane project 'main'\\''quoted:'",
	);
	assert.equal(buildTmuxNavProjectCommand('next'), 'mdev tmux nav next');
	assert.equal(buildTmuxNavProjectCommand('prev-all'), 'mdev tmux nav prev-all');
});

void test('tmux project metadata cache writes active and window records', () => {
	const { storage } = createMemoryStorage();
	const cache = createTmuxProjectMetadataCache({
		storage,
		now: () => '2026-05-27T10:00:00.000Z',
	});

	const record = cache.writeActive({
		stableConnectionId,
		tmuxSessionName,
		metadata,
	});

	assert.deepEqual(record, {
		version: TMUX_PROJECT_METADATA_CACHE_VERSION,
		stableConnectionId,
		tmuxSessionName,
		metadata,
		updatedAt: '2026-05-27T10:00:00.000Z',
	});
	assert.deepEqual(
		cache.readActive({ stableConnectionId, tmuxSessionName }),
		record,
	);
	assert.deepEqual(
		cache.readWindow({
			stableConnectionId,
			tmuxSessionName,
			windowId: metadata.windowId,
		}),
		record,
	);
});

void test('tmux project metadata cache deletes malformed active records', () => {
	const { entries, storage } = createMemoryStorage({
		'tmuxProjectMetadataActive.v1.connection%2E1.main': JSON.stringify({
			version: TMUX_PROJECT_METADATA_CACHE_VERSION,
			stableConnectionId,
			tmuxSessionName,
			metadata: { ...metadata, panePath: null },
			updatedAt: '2026-05-27T10:00:00.000Z',
		}),
	});
	const cache = createTmuxProjectMetadataCache({ storage });

	assert.equal(cache.readActive({ stableConnectionId, tmuxSessionName }), null);
	assert.equal(
		entries.has('tmuxProjectMetadataActive.v1.connection%2E1.main'),
		false,
	);
});
