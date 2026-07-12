import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import { createShellTerminalTransport } from '../../src/lib/shell-controllers/terminal-transport';
import { bytes, deferred, wait } from './shell-terminal-transport-test-support';

void test('terminal transport composes caller freshness with lease freshness', async () => {
	const writes: number[][] = [];
	let callerCurrent = true;
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(Array.from(segment));
		callerCurrent = false;
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);

	await transport.sendBatch(lease, [bytes(1), bytes(2)], {
		isCurrent: () => callerCurrent,
	});

	assert.deepEqual(writes, [[1]]);
});

void test('terminal transport serializes batches across shell replacement', async () => {
	const firstWriteStarted = deferred();
	const releaseFirstWrite = deferred();
	const events: string[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async () => {
		events.push('first-start');
		firstWriteStarted.resolve();
		await releaseFirstWrite.promise;
		events.push('first-end');
	});
	transport.setRuntimeInstance('instance');
	const firstLease = transport.captureLease();
	assert.ok(firstLease);
	const firstBatch = transport.sendBatch(firstLease, [bytes(1)]);
	await firstWriteStarted.promise;

	transport.setShell(createShellTransportKey('conn', 8), async () => {
		events.push('second');
	});
	const secondLease = transport.captureLease();
	assert.ok(secondLease);
	const secondBatch = transport.sendBatch(secondLease, [bytes(2)]);
	await Promise.resolve();
	assert.deepEqual(events, ['first-start']);

	releaseFirstWrite.resolve();
	await Promise.all([firstBatch, secondBatch]);
	assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

void test('terminal transport drops stale queued work without interleaving batches', async () => {
	const firstWriteStarted = deferred();
	const releaseFirstWrite = deferred();
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
		if (segment[0] === 1) {
			firstWriteStarted.resolve();
			await releaseFirstWrite.promise;
		}
	});
	transport.setRuntimeInstance('instance');
	const oldLease = transport.captureLease();
	assert.ok(oldLease);
	const firstBatch = transport.sendBatch(oldLease, [bytes(1)]);
	await firstWriteStarted.promise;
	const staleQueuedBatch = transport.sendBatch(oldLease, [bytes(2)]);

	transport.setShell(createShellTransportKey('conn', 8), async (segment) => {
		writes.push(segment[0] ?? -1);
	});
	const newLease = transport.captureLease();
	assert.ok(newLease);
	const newBatch = transport.sendBatch(newLease, [bytes(3)]);

	releaseFirstWrite.resolve();
	await Promise.all([firstBatch, staleQueuedBatch, newBatch]);
	assert.deepEqual(writes, [1, 3]);
});

void test('terminal transport prunes a large stale pending backlog immediately', async () => {
	const activeStarted = deferred();
	const releaseActive = deferred();
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
		if (segment[0] === 1) {
			activeStarted.resolve();
			await releaseActive.promise;
		}
	});
	transport.setRuntimeInstance('instance');
	const oldLease = transport.captureLease();
	assert.ok(oldLease);
	const active = transport.sendBatch(oldLease, [bytes(1)]);
	await activeStarted.promise;
	const backlog = Array.from({ length: 2_000 }, (_, index) =>
		transport.sendBatch(oldLease, [bytes((index % 200) + 20)]),
	);

	transport.setRuntimeInstance('replacement');
	const newLease = transport.captureLease();
	assert.ok(newLease);
	const replacement = transport.sendBatch(newLease, [bytes(2)]);
	await Promise.race([
		Promise.all(backlog),
		wait(100).then(() => {
			throw new Error('stale backlog did not settle immediately');
		}),
	]);
	assert.deepEqual(writes, [1]);

	releaseActive.resolve();
	await Promise.all([active, replacement]);
	assert.deepEqual(writes, [1, 2]);
});

void test('terminal transport snapshots pending segment bytes at ingress', async () => {
	const activeStarted = deferred();
	const releaseActive = deferred();
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
		if (segment[0] === 1) {
			activeStarted.resolve();
			await releaseActive.promise;
		}
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const active = transport.sendBatch(lease, [bytes(1)]);
	await activeStarted.promise;
	const mutable = bytes(2);
	const pending = transport.sendBatch(lease, [mutable]);
	mutable[0] = 99;

	releaseActive.resolve();
	await Promise.all([active, pending]);
	assert.deepEqual(writes, [1, 2]);
});
type ReentrantTransition = {
	name: string;
	transition(
		transport: ReturnType<typeof createShellTerminalTransport>,
		send: (segment: Uint8Array<ArrayBufferLike>) => Promise<void>,
	): void;
};

const reentrantTransitions = [
	{
		name: 'invalidation',
		transition: (transport) => transport.invalidate('runtime-reset'),
	},
	{
		name: 'shell replacement',
		transition: (transport, send) =>
			transport.setShell(createShellTransportKey('conn', 8), send),
	},
	{
		name: 'runtime replacement',
		transition: (transport) => transport.setRuntimeInstance('replacement'),
	},
	{
		name: 'shell clear',
		transition: (transport) => transport.clearShell(),
	},
	{
		name: 'runtime clear',
		transition: (transport) => transport.clearRuntime(),
	},
	{
		name: 'disposal',
		transition: (transport) => transport.dispose(),
	},
] satisfies ReentrantTransition[];

for (const scenario of reentrantTransitions) {
	void test(`terminal transport rechecks lease after reentrant ${scenario.name} before write`, async () => {
		const writes: number[] = [];
		const transport = createShellTerminalTransport({ onSendFailure: () => {} });
		const send = async (segment: Uint8Array<ArrayBufferLike>) => {
			writes.push(segment[0] ?? -1);
		};
		transport.setShell(createShellTransportKey('conn', 7), send);
		transport.setRuntimeInstance('instance');
		const lease = transport.captureLease();
		assert.ok(lease);
		let freshnessChecks = 0;

		await transport.sendBatch(lease, [bytes(1)], {
			isCurrent: () => {
				freshnessChecks += 1;
				if (freshnessChecks >= 2) scenario.transition(transport, send);
				return true;
			},
		});

		assert.deepEqual(writes, []);
	});

	void test(`terminal transport rechecks lease after reentrant ${scenario.name} before failure feedback`, async () => {
		const sendError = new Error('send failed');
		const sendStarted = deferred();
		const pendingSend = deferred();
		const failures: unknown[] = [];
		let sendHasStarted = false;
		const transport = createShellTerminalTransport({
			onSendFailure: (error) => failures.push(error),
		});
		const send = async () => {
			sendHasStarted = true;
			sendStarted.resolve();
			return pendingSend.promise;
		};
		transport.setShell(createShellTransportKey('conn', 7), send);
		transport.setRuntimeInstance('instance');
		const lease = transport.captureLease();
		assert.ok(lease);
		const batch = transport.sendBatch(lease, [bytes(1)], {
			isCurrent: () => {
				if (sendHasStarted) scenario.transition(transport, send);
				return true;
			},
		});
		await sendStarted.promise;

		pendingSend.reject(sendError);
		await assert.rejects(batch, sendError);
		assert.deepEqual(failures, []);
	});
}

for (const stalePredicate of [
	{ name: 'false', check: () => false },
	{
		name: 'throwing',
		check: () => {
			throw new Error('stale');
		},
	},
]) {
	void test(`terminal queue skips ${stalePredicate.name} caller-stale head and runs successor`, async () => {
		const activeStarted = deferred();
		const releaseActive = deferred();
		const writes: number[] = [];
		const transport = createShellTerminalTransport({ onSendFailure: () => {} });
		transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
			writes.push(segment[0] ?? -1);
			if (segment[0] === 1) {
				activeStarted.resolve();
				await releaseActive.promise;
			}
		});
		transport.setRuntimeInstance('instance');
		const lease = transport.captureLease();
		assert.ok(lease);
		const active = transport.sendBatch(lease, [bytes(1)]);
		await activeStarted.promise;
		const stale = transport.sendBatch(lease, [bytes(2)], {
			isCurrent: stalePredicate.check,
		});
		const successor = transport.sendBatch(lease, [bytes(3)]);

		releaseActive.resolve();
		await Promise.all([active, stale, successor]);
		assert.deepEqual(writes, [1, 3]);
	});
}

void test('terminal queue runs a queued successor after active rejection', async () => {
	const activeStarted = deferred();
	const rejectActive = deferred();
	const sendError = new Error('send failed');
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		if (segment[0] === 1) {
			activeStarted.resolve();
			return rejectActive.promise;
		}
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const active = transport.sendBatch(lease, [bytes(1)]);
	await activeStarted.promise;
	const successor = transport.sendBatch(lease, [bytes(2)]);

	rejectActive.reject(sendError);
	await assert.rejects(active, sendError);
	await successor;
	assert.deepEqual(writes, [2]);
});

void test('terminal queue drains a large current backlog in order', async () => {
	const activeStarted = deferred();
	const releaseActive = deferred();
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		const value = ((segment[0] ?? 0) << 8) | (segment[1] ?? 0);
		writes.push(value);
		if (value === 0) {
			activeStarted.resolve();
			await releaseActive.promise;
		}
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const active = transport.sendBatch(lease, [new Uint8Array([0, 0])]);
	await activeStarted.promise;
	const backlog = Array.from({ length: 2_000 }, (_, offset) => {
		const value = offset + 1;
		return transport.sendBatch(lease, [
			new Uint8Array([value >> 8, value & 0xff]),
		]);
	});

	releaseActive.resolve();
	await Promise.all([active, ...backlog]);
	assert.deepEqual(
		writes,
		Array.from({ length: 2_001 }, (_, value) => value),
	);
});

void test('terminal queue reserves outer entry before reentrant enqueue', async () => {
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	let nested: Promise<void> | null = null;
	let didEnqueue = false;

	const outer = transport.sendBatch(lease, [bytes(1)], {
		isCurrent: () => {
			if (!didEnqueue) {
				didEnqueue = true;
				nested = transport.sendBatch(lease, [bytes(2)]);
			}
			return true;
		},
	});
	await outer;
	assert.ok(nested);
	await nested;
	assert.deepEqual(writes, [1, 2]);
});

void test('terminal queue keeps reentrant delayed owner abortable', async () => {
	const nestedFirstWrite = deferred();
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
		if (segment[0] === 2) nestedFirstWrite.resolve();
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	let nested: Promise<void> | null = null;
	let didEnqueue = false;

	const outer = transport.sendBatch(lease, [bytes(1)], {
		isCurrent: () => {
			if (!didEnqueue) {
				didEnqueue = true;
				nested = transport.sendBatch(lease, [bytes(2), bytes(3)], {
					interSegmentDelayMs: 10_000,
				});
			}
			return true;
		},
	});
	await nestedFirstWrite.promise;
	transport.invalidate('runtime-reset');
	const freshLease = transport.captureLease();
	assert.ok(freshLease);
	const fresh = transport.sendBatch(freshLease, [bytes(4)]);

	assert.ok(nested);
	await Promise.race([
		Promise.all([outer, nested, fresh]),
		wait(200).then(() => {
			throw new Error('reentrant delayed owner did not settle promptly');
		}),
	]);
	assert.deepEqual(writes, [1, 2, 4]);
});

for (const staleResult of [
	{ name: 'false', run: () => false },
	{
		name: 'throw',
		run: () => {
			throw new Error('stale');
		},
	},
]) {
	void test(`terminal queue preserves nested FIFO when reserved outer returns ${staleResult.name}`, async () => {
		const writes: number[] = [];
		const transport = createShellTerminalTransport({ onSendFailure: () => {} });
		transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
			writes.push(segment[0] ?? -1);
		});
		transport.setRuntimeInstance('instance');
		const lease = transport.captureLease();
		assert.ok(lease);
		let nested: Promise<void> | null = null;
		let didEnqueue = false;

		const outer = transport.sendBatch(lease, [bytes(1)], {
			isCurrent: () => {
				if (!didEnqueue) {
					didEnqueue = true;
					nested = transport.sendBatch(lease, [bytes(2)]);
				}
				return staleResult.run();
			},
		});
		await outer;
		assert.ok(nested);
		await nested;
		assert.deepEqual(writes, [2]);
	});
}

for (const transition of [
	{
		name: 'shell replacement',
		run: (
			transport: ReturnType<typeof createShellTerminalTransport>,
			send: (segment: Uint8Array<ArrayBufferLike>) => Promise<void>,
		) => transport.setShell(createShellTransportKey('conn', 8), send),
		canContinue: true,
	},
	{
		name: 'runtime replacement',
		run: (transport: ReturnType<typeof createShellTerminalTransport>) =>
			transport.setRuntimeInstance('replacement'),
		canContinue: true,
	},
	{
		name: 'disposal',
		run: (transport: ReturnType<typeof createShellTerminalTransport>) =>
			transport.dispose(),
		canContinue: false,
	},
]) {
	void test(`terminal queue survives reentrant ${transition.name} without slot corruption`, async () => {
		const writes: number[] = [];
		const failures: unknown[] = [];
		const transport = createShellTerminalTransport({
			onSendFailure: (error) => failures.push(error),
		});
		const send = async (segment: Uint8Array<ArrayBufferLike>) => {
			writes.push(segment[0] ?? -1);
		};
		transport.setShell(createShellTransportKey('conn', 7), send);
		transport.setRuntimeInstance('instance');
		const lease = transport.captureLease();
		assert.ok(lease);
		let nested: Promise<void> | null = null;
		let didTransition = false;

		const outer = transport.sendBatch(lease, [bytes(1)], {
			isCurrent: () => {
				if (!didTransition) {
					didTransition = true;
					nested = transport.sendBatch(lease, [bytes(2)]);
					transition.run(transport, send);
				}
				return true;
			},
		});
		await outer;
		assert.ok(nested);
		await nested;
		if (transition.canContinue) {
			const freshLease = transport.captureLease();
			assert.ok(freshLease);
			await transport.sendBatch(freshLease, [bytes(3)]);
		}
		assert.deepEqual(writes, transition.canContinue ? [3] : []);
		assert.deepEqual(failures, []);
	});
}
