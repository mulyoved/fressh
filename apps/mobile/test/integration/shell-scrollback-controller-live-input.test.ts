import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import { type TerminalRuntimeKey } from '../../src/lib/shell-controllers/terminal-transport';
import {
	createDeferred,
	createScrollbackHarness,
} from './shell-scrollback-controller-test-support';

function configureCurrentTerminal(
	harness: ReturnType<typeof createScrollbackHarness>,
	sendBatch: (
		segments: readonly Uint8Array<ArrayBufferLike>[],
	) => void | Promise<void> = () => {},
) {
	const lease = {
		runtimeKey: 'runtime-1' as TerminalRuntimeKey,
		writerGeneration: 1,
	};
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
		) => sendBatch(segments),
	});
	return lease;
}

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

void test('equivalent context commit preserves blocked input authority and refreshes dependencies', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const sent: number[][][] = [];
	configureCurrentTerminal(harness, (segments) => {
		sent.push(segments.map((segment) => Array.from(segment)));
	});
	harness.core.onTerminalRuntimeChanged('instance-1');
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	harness.remoteCopyModeActive.current = true;
	harness.remoteCopyModeGeneration.current += 1;
	const outcome = harness.core.sendSegments([new Uint8Array([1])]);
	let latestActivityReads = 0;
	harness.core.setContext({
		...harness.context,
		getActivitySnapshot: () => {
			latestActivityReads += 1;
			return harness.context.getActivitySnapshot();
		},
		getErrorMessage: () => 'latest formatter',
		logger: { warn: () => {} },
	});
	assert.equal(harness.executors.length, 1);
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.deepEqual(sent, [[[1]]]);
	assert.ok(latestActivityReads > 0);
});

void test('genuine target and authority-port replacements supersede blocked input', async () => {
	for (const replacement of [
		'target',
		'workmux',
		'transport',
		'view',
	] as const) {
		const harness = createScrollbackHarness();
		const cleanup = createDeferred<boolean>();
		configureCurrentTerminal(harness);
		harness.core.onTerminalRuntimeChanged('instance-1');
		const executor = harness.executors[0];
		assert.ok(executor);
		executor.reset = () => cleanup.promise;
		harness.remoteCopyModeActive.current = true;
		harness.remoteCopyModeGeneration.current += 1;
		const outcome = harness.core.sendSegments([new Uint8Array([1])]);
		const next = { ...harness.context };
		if (replacement === 'target') {
			next.targetKey = createShellTargetKey('replacement' as never, 'main');
		} else if (replacement === 'workmux') {
			next.workmuxScroll = { ...harness.context.workmuxScroll };
		} else if (replacement === 'transport') {
			next.terminalTransport = { ...harness.context.terminalTransport };
		} else {
			next.terminalView = { ...harness.context.terminalView };
		}
		harness.core.setContext(next);
		cleanup.resolve(true);
		assert.deepEqual(await outcome, { status: 'superseded' }, replacement);
	}
});

void test('availability transitions in either direction supersede blocked input', async () => {
	for (const field of [
		'connectionAvailable',
		'shellAvailable',
		'tmuxEnabled',
	] as const) {
		for (const initial of [true, false]) {
			const harness = createScrollbackHarness();
			harness.core.setContext({ ...harness.context, [field]: initial });
			const cleanup = createDeferred<boolean>();
			const sent: number[][][] = [];
			configureCurrentTerminal(harness, (segments) => {
				sent.push(segments.map((segment) => Array.from(segment)));
			});
			harness.core.onTerminalRuntimeChanged('instance-1');
			const executor = harness.executors[0];
			assert.ok(executor);
			executor.reset = () => cleanup.promise;
			harness.remoteCopyModeActive.current = true;
			harness.remoteCopyModeGeneration.current += 1;
			const outcome = harness.core.sendSegments([new Uint8Array([1])]);
			harness.core.setContext({
				...harness.context,
				[field]: !initial,
			});
			cleanup.resolve(true);
			assert.deepEqual(
				await outcome,
				{ status: 'superseded' },
				`${field}:${initial}`,
			);
			assert.deepEqual(sent, []);
		}
	}
});

void test('availability change supersedes a blocked enter without acknowledgement', async () => {
	const harness = createScrollbackHarness();
	const enter = createDeferred<boolean>();
	harness.core.onTerminalRuntimeChanged('instance-1');
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.runEnterCommand = () => enter.promise;
	const pending = harness.core.onScrollbackEnterRequested({
		instanceId: 'instance-1',
		requestId: 1,
	});
	harness.core.setContext({
		...harness.context,
		connectionAvailable: false,
	});
	enter.resolve(true);
	await pending;
	assert.deepEqual(harness.enterAcks, []);
});

void test('controller pins inactive-empty and active cleanup-only outcomes', async () => {
	const harness = createScrollbackHarness();
	const sent: number[][][] = [];
	configureCurrentTerminal(harness, (segments) => {
		sent.push(segments.map((segment) => Array.from(segment)));
	});
	harness.core.onTerminalRuntimeChanged('instance-1');
	let accepted = 0;
	assert.deepEqual(
		await harness.core.sendSegments([new Uint8Array([])], {
			onAccepted: () => {
				accepted += 1;
			},
		}),
		{ status: 'unavailable' },
	);
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	const cleanup = createDeferred<boolean>();
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => cleanup.promise;
	const outcome = harness.core.sendSegments([new Uint8Array([])], {
		onAccepted: () => {
			accepted += 1;
		},
	});
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'completed' });
	assert.equal(accepted, 1);
	assert.deepEqual(sent, []);
});

void test('cleanup callback reentry cannot adopt newer mode and remote acquisition', async () => {
	const harness = createScrollbackHarness();
	const cleanup = createDeferred<boolean>();
	const sent: number[][][] = [];
	let accepted = 0;
	configureCurrentTerminal(harness, (segments) => {
		sent.push(segments.map((segment) => Array.from(segment)));
	});
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	const executor = harness.executors[0];
	assert.ok(executor);
	executor.reset = () => {
		harness.remoteCopyModeGeneration.current += 1;
		harness.remoteCopyModeActive.current = true;
		harness.core.onScrollbackModeChange({
			active: true,
			phase: 'active',
			instanceId: 'instance-1',
		});
		return cleanup.promise;
	};
	const outcome = harness.core.sendSegments([new Uint8Array([1])], {
		onAccepted: () => {
			accepted += 1;
		},
	});
	cleanup.resolve(true);
	assert.deepEqual(await outcome, { status: 'superseded' });
	assert.equal(accepted, 0);
	assert.deepEqual(sent, []);
});

void test('scrollback core keeps live input delegated and stays within its ownership ceiling', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/scrollback-core.ts'),
		'utf8',
	);
	assert.match(source, /createScrollbackLiveInputCoordinator\(\{/);
	assert.match(source, /sendSegments: liveInputCoordinator\.sendSegments/);
	assert.ok(source.split('\n').length <= 650);
	const coordinator = readFileSync(
		join(
			process.cwd(),
			'src/lib/shell-controllers/scrollback-live-input-coordinator.ts',
		),
		'utf8',
	);
	assert.doesNotMatch(coordinator, /\+\s*1/);
});
