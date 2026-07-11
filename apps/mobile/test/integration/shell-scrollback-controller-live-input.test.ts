import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { type TerminalRuntimeKey } from '../../src/lib/shell-controllers/terminal-transport';
import {
	createDeferred,
	createScrollbackHarness,
} from './shell-scrollback-controller-test-support';

void test('scrollback core delegates remote cleanup and terminal batch completion to the live-input coordinator', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const sent: number[][][] = [];
	const lease = {
		runtimeKey: 'runtime-1' as TerminalRuntimeKey,
		writerGeneration: 1,
	};
	const executor = harness.executors[0];
	assert.ok(executor);
	Object.assign(harness.context.terminalView, {
		getRuntimeInstanceId: () => 'instance-1',
		getRuntimeKey: () => 'runtime-1' as TerminalRuntimeKey,
	});
	Object.assign(harness.context.terminalTransport, {
		captureLease: () => lease,
		isLeaseCurrent: () => true,
		sendBatch: async (
			_lease: typeof lease,
			segments: readonly Uint8Array<ArrayBufferLike>[],
		) => sent.push(segments.map((segment) => Array.from(segment))),
	});
	harness.core.onTerminalRuntimeChanged('instance-1');
	executor.reset = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.remoteCopyModeGeneration.current += 1;
	const outcome = harness.core.sendSegments([new Uint8Array([0x61])]);
	assert.deepEqual(sent, []);
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.deepEqual(sent, [[[0x61]]]);
});

void test('interactive-to-inactive transition advances freshness before one suppressing cleanup', async () => {
	const harness = createScrollbackHarness();
	const executor = harness.executors[0];
	assert.ok(executor);
	const cleanup = createDeferred<boolean>();
	let resetCount = 0;
	executor.reset = () => {
		resetCount += 1;
		return cleanup.promise;
	};
	harness.core.onActivityChanged();
	harness.setActivitySnapshot({
		appActive: false,
		focused: false,
		interactive: false,
		generation: 1,
	});
	harness.core.onActivityChanged();
	harness.core.onActivityChanged();
	assert.equal(resetCount, 1);
	cleanup.resolve(true);
	await cleanup.promise;
	assert.equal(harness.core.getSnapshot().active, false);
});

void test('scrollback core keeps live input delegated and stays within its ownership ceiling', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/scrollback-core.ts'),
		'utf8',
	);
	assert.match(source, /createScrollbackLiveInputCoordinator\(\{/);
	assert.match(source, /sendSegments: liveInputCoordinator\.sendSegments/);
	assert.ok(source.split('\n').length <= 650);
});
