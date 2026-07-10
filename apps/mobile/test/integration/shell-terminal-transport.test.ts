import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createShellTerminalTransport,
	type TerminalInputLease,
} from '../../src/lib/shell-controllers/terminal-transport';

const bytes = (value: number) => new Uint8Array([value]);

const deferred = <T = void>() => {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
};

const wait = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

void test('terminal transport writes an ordered current lease', async () => {
	const writes: number[][] = [];
	const transport = createShellTerminalTransport({
		onSendFailure: () => {},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (bytes) => {
		writes.push(Array.from(bytes));
	});
	transport.setRuntimeInstance('instance-1');
	const lease = transport.captureLease();
	assert.ok(lease);
	await transport.sendBatch(lease, [new Uint8Array([1]), new Uint8Array([2])]);
	assert.deepEqual(writes, [[1], [2]]);
});

void test('terminal transport suppresses a lease after runtime replacement', async () => {
	const writes: number[][] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (bytes) => {
		writes.push(Array.from(bytes));
	});
	transport.setRuntimeInstance('instance-1');
	const staleLease = transport.captureLease();
	assert.ok(staleLease);
	transport.setRuntimeInstance('instance-2');
	await transport.sendBatch(staleLease, [new Uint8Array([1])]);
	assert.deepEqual(writes, []);
});

void test('terminal transport stops delayed segments after runtime replacement', async () => {
	const writes: number[][] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(Array.from(segment));
		transport.setRuntimeInstance('instance-2');
	});
	transport.setRuntimeInstance('instance-1');
	const lease = transport.captureLease();
	assert.ok(lease);

	await transport.sendBatch(lease, [bytes(1), bytes(2)], {
		interSegmentDelayMs: 1,
	});

	assert.deepEqual(writes, [[1]]);
});

void test('terminal transport stales leases when shell identity changes', async () => {
	const firstWrites: number[][] = [];
	const secondWrites: number[][] = [];
	const firstSend = async (segment: Uint8Array<ArrayBufferLike>) => {
		firstWrites.push(Array.from(segment));
	};
	const secondSend = async (segment: Uint8Array<ArrayBufferLike>) => {
		secondWrites.push(Array.from(segment));
	};
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), firstSend);
	transport.setRuntimeInstance('instance');
	const firstLease = transport.captureLease();
	assert.ok(firstLease);

	transport.setShell(createShellTransportKey('conn', 8), secondSend);
	await transport.sendBatch(firstLease, [bytes(1)]);
	const secondLease = transport.captureLease();
	assert.ok(secondLease);
	await transport.sendBatch(secondLease, [bytes(2)]);

	assert.deepEqual(firstWrites, []);
	assert.deepEqual(secondWrites, [[2]]);
	assert.notEqual(firstLease.runtimeKey, secondLease.runtimeKey);
});

void test('terminal transport stales leases when send changes under the same shell key', async () => {
	const writes: number[][] = [];
	const key = createShellTransportKey('conn', 7);
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(key, async () => {});
	transport.setRuntimeInstance('instance');
	const staleLease = transport.captureLease();
	assert.ok(staleLease);

	transport.setShell(key, async (segment) => {
		writes.push(Array.from(segment));
	});
	await transport.sendBatch(staleLease, [bytes(1)]);

	assert.deepEqual(writes, []);
});

void test('terminal transport preserves leases for idempotent shell and runtime updates', async () => {
	const writes: number[][] = [];
	const key = createShellTransportKey('conn', 7);
	const send = async (segment: Uint8Array<ArrayBufferLike>) => {
		writes.push(Array.from(segment));
	};
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(key, send);
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);

	transport.setShell(key, send);
	transport.setRuntimeInstance('instance');

	assert.equal(transport.isLeaseCurrent(lease), true);
	await transport.sendBatch(lease, [bytes(1)]);
	assert.deepEqual(writes, [[1]]);
});

void test('terminal transport clear and invalidation operations stale leases', () => {
	const key = createShellTransportKey('conn', 7);
	const createReadyTransport = () => {
		const transport = createShellTerminalTransport({ onSendFailure: () => {} });
		transport.setShell(key, async () => {});
		transport.setRuntimeInstance('instance');
		const lease = transport.captureLease();
		assert.ok(lease);
		return { lease, transport };
	};

	const shell = createReadyTransport();
	shell.transport.clearShell();
	assert.equal(shell.transport.isLeaseCurrent(shell.lease), false);
	assert.equal(shell.transport.captureLease(), null);

	const runtime = createReadyTransport();
	runtime.transport.clearRuntime();
	assert.equal(runtime.transport.isLeaseCurrent(runtime.lease), false);
	assert.equal(runtime.transport.captureLease(), null);

	const invalidated = createReadyTransport();
	invalidated.transport.invalidate('runtime-reset');
	assert.equal(invalidated.transport.isLeaseCurrent(invalidated.lease), false);
});

void test('terminal transport disposal is permanent and idempotent', async () => {
	const writes: number[][] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(Array.from(segment));
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);

	transport.dispose();
	transport.dispose();
	transport.setShell(createShellTransportKey('conn', 8), async (segment) => {
		writes.push(Array.from(segment));
	});
	transport.setRuntimeInstance('replacement');
	await transport.sendBatch(lease, [bytes(1)]);

	assert.equal(transport.captureLease(), null);
	assert.deepEqual(writes, []);
});

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

void test('terminal transport reports a current failure and preserves the send error', async () => {
	const sendError = new Error('send failed');
	const failures: unknown[] = [];
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => {
			failures.push(error);
			throw new Error('feedback failed');
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async () => {
		throw sendError;
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);

	await assert.rejects(transport.sendBatch(lease, [bytes(1)]), (error) => {
		assert.equal(error, sendError);
		return true;
	});
	assert.deepEqual(failures, [sendError]);
});

void test('terminal transport suppresses failure feedback when a rejection becomes stale', async () => {
	const pendingSend = deferred();
	const sendStarted = deferred();
	const failures: unknown[] = [];
	const sendError = new Error('send failed');
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
	});
	transport.setShell(createShellTransportKey('conn', 7), () => {
		sendStarted.resolve();
		return pendingSend.promise;
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const batch = transport.sendBatch(lease, [bytes(1)]);
	await sendStarted.promise;

	transport.invalidate('runtime-reset');
	pendingSend.reject(sendError);
	await assert.rejects(batch, sendError);
	assert.deepEqual(failures, []);
});

void test('terminal transport continues queued writes after a rejected batch', async () => {
	const writes: number[] = [];
	let attempts = 0;
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		attempts += 1;
		if (attempts === 1) throw new Error('first failed');
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);

	await assert.rejects(transport.sendBatch(lease, [bytes(1)]));
	await transport.sendBatch(lease, [bytes(2)]);

	assert.deepEqual(writes, [2]);
});

void test('terminal runtime key encodes transport and runtime instance only', () => {
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	const firstTransport = createShellTransportKey('conn', 7);
	transport.setShell(firstTransport, async () => {});
	transport.setRuntimeInstance('instance');
	const firstLease = transport.captureLease();
	assert.ok(firstLease);
	assert.deepEqual(JSON.parse(firstLease.runtimeKey), [
		firstTransport,
		'instance',
	]);

	const secondTransport = createShellTransportKey('conn', 8);
	transport.setShell(secondTransport, async () => {});
	const secondLease = transport.captureLease();
	assert.ok(secondLease);
	assert.deepEqual(JSON.parse(secondLease.runtimeKey), [
		secondTransport,
		'instance',
	]);
});

void test('terminal leases are owned by their creating controller', () => {
	const key = createShellTransportKey('conn', 7);
	const first = createShellTerminalTransport({ onSendFailure: () => {} });
	const second = createShellTerminalTransport({ onSendFailure: () => {} });
	const send = async () => {};
	for (const transport of [first, second]) {
		transport.setShell(key, send);
		transport.setRuntimeInstance('instance');
	}
	const lease = first.captureLease();
	assert.ok(lease);

	assert.equal(first.isLeaseCurrent(lease), true);
	assert.equal(second.isLeaseCurrent(lease), false);
	assert.equal(second.isLeaseCurrent({ ...lease }), false);
});

void test('terminal leases are frozen and caller mutation cannot change currentness', () => {
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async () => {});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const originalRuntimeKey = lease.runtimeKey;
	const originalGeneration = lease.writerGeneration;

	assert.equal(Object.isFrozen(lease), true);
	assert.equal(Reflect.set(lease, 'runtimeKey', 'forged'), false);
	assert.equal(Reflect.set(lease, 'writerGeneration', 999), false);
	assert.equal(lease.runtimeKey, originalRuntimeKey);
	assert.equal(lease.writerGeneration, originalGeneration);
	assert.equal(transport.isLeaseCurrent(lease), true);
});

void test('disposed controller leases cannot replay into a replacement controller', () => {
	const key = createShellTransportKey('conn', 7);
	const send = async () => {};
	const original = createShellTerminalTransport({ onSendFailure: () => {} });
	original.setShell(key, send);
	original.setRuntimeInstance('instance');
	const lease = original.captureLease();
	assert.ok(lease);
	original.dispose();

	const replacement = createShellTerminalTransport({ onSendFailure: () => {} });
	replacement.setShell(key, send);
	replacement.setRuntimeInstance('instance');
	assert.equal(replacement.isLeaseCurrent(lease), false);
});

void test('terminal failure feedback uses combined caller and lease freshness', async () => {
	const pendingSend = deferred();
	const sendStarted = deferred();
	const sendError = new Error('send failed');
	const failures: unknown[] = [];
	let callerCurrent = true;
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
	});
	transport.setShell(createShellTransportKey('conn', 7), () => {
		sendStarted.resolve();
		return pendingSend.promise;
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const batch = transport.sendBatch(lease, [bytes(1)], {
		isCurrent: () => callerCurrent,
	});
	await sendStarted.promise;

	callerCurrent = false;
	pendingSend.reject(sendError);
	await assert.rejects(batch, sendError);
	assert.deepEqual(failures, []);
});

void test('throwing freshness is stale and cannot mask send rejection', async () => {
	const pendingSend = deferred();
	const sendStarted = deferred();
	const sendError = new Error('send failed');
	const failures: unknown[] = [];
	let throwFreshness = false;
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
	});
	transport.setShell(createShellTransportKey('conn', 7), () => {
		sendStarted.resolve();
		return pendingSend.promise;
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const batch = transport.sendBatch(lease, [bytes(1)], {
		isCurrent: () => {
			if (throwFreshness) throw new Error('freshness failed');
			return true;
		},
	});
	await sendStarted.promise;

	throwFreshness = true;
	pendingSend.reject(sendError);
	await assert.rejects(batch, sendError);
	assert.deepEqual(failures, []);
});

void test('async failure feedback rejection is contained and queue stays live', async () => {
	const sendError = new Error('send failed');
	const writes: number[] = [];
	let attempt = 0;
	const transport = createShellTerminalTransport({
		onSendFailure: async () => {
			throw new Error('feedback failed');
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		attempt += 1;
		if (attempt === 1) throw sendError;
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);

	await assert.rejects(transport.sendBatch(lease, [bytes(1)]), sendError);
	await transport.sendBatch(lease, [bytes(2)]);
	await Promise.resolve();
	assert.deepEqual(writes, [2]);
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

type DelayTransition = {
	name: string;
	transition(
		transport: ReturnType<typeof createShellTerminalTransport>,
		send: (segment: Uint8Array<ArrayBufferLike>) => Promise<void>,
	): TerminalInputLease | null;
};

for (const scenario of [
	{
		name: 'runtime replacement',
		transition: (transport) => {
			transport.setRuntimeInstance('replacement');
			return transport.captureLease();
		},
	},
	{
		name: 'shell replacement',
		transition: (transport, send) => {
			transport.setShell(createShellTransportKey('conn', 8), send);
			return transport.captureLease();
		},
	},
	{
		name: 'shell clear and restore',
		transition: (transport, send) => {
			transport.clearShell();
			transport.setShell(createShellTransportKey('conn', 7), send);
			return transport.captureLease();
		},
	},
	{
		name: 'runtime clear and restore',
		transition: (transport) => {
			transport.clearRuntime();
			transport.setRuntimeInstance('replacement');
			return transport.captureLease();
		},
	},
	{
		name: 'explicit invalidation',
		transition: (transport) => {
			transport.invalidate('runtime-reset');
			return transport.captureLease();
		},
	},
] satisfies DelayTransition[]) {
	void test(`terminal transport interrupts stale delay after ${scenario.name}`, async () => {
		const writes: number[] = [];
		const firstWrite = deferred();
		const transport = createShellTerminalTransport({ onSendFailure: () => {} });
		const send = async (segment: Uint8Array<ArrayBufferLike>) => {
			writes.push(segment[0] ?? -1);
			if (segment[0] === 1) firstWrite.resolve();
		};
		transport.setShell(createShellTransportKey('conn', 7), send);
		transport.setRuntimeInstance('instance');
		const oldLease = transport.captureLease();
		assert.ok(oldLease);
		const staleBatch = transport.sendBatch(oldLease, [bytes(1), bytes(9)], {
			interSegmentDelayMs: 10_000,
		});
		await firstWrite.promise;

		const newLease = scenario.transition(transport, send);
		assert.ok(newLease);
		const replacement = transport.sendBatch(newLease, [bytes(2)]);
		await Promise.race([
			Promise.all([staleBatch, replacement]),
			wait(200).then(() => {
				throw new Error('stale delay was not interrupted');
			}),
		]);
		assert.deepEqual(writes, [1, 2]);
	});
}

void test('terminal transport interrupts stale delay on disposal', async () => {
	const firstWrite = deferred();
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
		firstWrite.resolve();
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const batch = transport.sendBatch(lease, [bytes(1), bytes(9)], {
		interSegmentDelayMs: 10_000,
	});
	await firstWrite.promise;

	transport.dispose();
	await Promise.race([
		batch,
		wait(200).then(() => {
			throw new Error('dispose did not interrupt stale delay');
		}),
	]);
	assert.deepEqual(writes, [1]);
});

void test('terminal runtime identity updates and setup order support fresh leases', async () => {
	const writes: number[] = [];
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setRuntimeInstance('instance-1');
	assert.equal(transport.captureLease(), null);
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
	});
	const firstLease = transport.captureLease();
	assert.ok(firstLease);
	assert.equal(JSON.parse(firstLease.runtimeKey)[1], 'instance-1');

	transport.setRuntimeInstance('instance-2');
	const secondLease = transport.captureLease();
	assert.ok(secondLease);
	assert.equal(JSON.parse(secondLease.runtimeKey)[1], 'instance-2');
	assert.equal(transport.isLeaseCurrent(firstLease), false);
	await transport.sendBatch(secondLease, [bytes(1)]);
	assert.deepEqual(writes, [1]);
});

void test('terminal clear and restoration keeps pre-clear leases stale', async () => {
	const writes: number[] = [];
	const key = createShellTransportKey('conn', 7);
	const send = async (segment: Uint8Array<ArrayBufferLike>) => {
		writes.push(segment[0] ?? -1);
	};
	const transport = createShellTerminalTransport({ onSendFailure: () => {} });
	transport.setShell(key, send);
	transport.setRuntimeInstance('instance');
	const beforeShellClear = transport.captureLease();
	assert.ok(beforeShellClear);
	transport.clearShell();
	transport.setShell(key, send);
	const afterShellRestore = transport.captureLease();
	assert.ok(afterShellRestore);
	assert.equal(transport.isLeaseCurrent(beforeShellClear), false);

	transport.clearRuntime();
	transport.setRuntimeInstance('instance');
	const afterRuntimeRestore = transport.captureLease();
	assert.ok(afterRuntimeRestore);
	assert.equal(transport.isLeaseCurrent(beforeShellClear), false);
	assert.equal(transport.isLeaseCurrent(afterShellRestore), false);
	await transport.sendBatch(afterRuntimeRestore, [bytes(1)]);
	assert.deepEqual(writes, [1]);
});
