import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import {
	createShellTerminalTransport,
	type TerminalInputLease,
} from '../../src/lib/shell-controllers/terminal-transport';
import { bytes, deferred, wait } from './shell-terminal-transport-test-support';

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

void test('terminal transport allocates no abort controllers for pending or delay-free batches', async () => {
	const activeStarted = deferred();
	const releaseActive = deferred();
	let allocations = 0;
	const transport = createShellTerminalTransport({
		onSendFailure: () => {},
		createAbortController: () => {
			allocations += 1;
			return new AbortController();
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
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
	const backlog = Array.from({ length: 2_000 }, () =>
		transport.sendBatch(lease, [bytes(2)]),
	);
	assert.equal(allocations, 0);

	releaseActive.resolve();
	await Promise.all([active, ...backlog]);
	assert.equal(allocations, 0);
});

void test('terminal transport allocates and aborts controllers only for promoted delayed batches', async () => {
	const firstWrites = [deferred(), deferred()];
	let allocations = 0;
	let aborts = 0;
	const transport = createShellTerminalTransport({
		onSendFailure: () => {},
		createAbortController: () => {
			allocations += 1;
			const controller = new AbortController();
			controller.signal.addEventListener('abort', () => {
				aborts += 1;
			});
			return controller;
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		if (segment[0] === 1) firstWrites[0]?.resolve();
		if (segment[0] === 2) firstWrites[1]?.resolve();
	});
	transport.setRuntimeInstance('instance');
	const firstLease = transport.captureLease();
	assert.ok(firstLease);
	const first = transport.sendBatch(firstLease, [bytes(1), bytes(9)], {
		interSegmentDelayMs: 10_000,
	});
	await firstWrites[0]?.promise;
	assert.equal(allocations, 1);

	transport.setRuntimeInstance('replacement');
	assert.equal(aborts, 1);
	const secondLease = transport.captureLease();
	assert.ok(secondLease);
	const second = transport.sendBatch(secondLease, [bytes(2), bytes(8)], {
		interSegmentDelayMs: 10_000,
	});
	await firstWrites[1]?.promise;
	assert.equal(allocations, 2);
	transport.dispose();
	assert.equal(aborts, 2);
	await Promise.all([first, second]);
});

void test('terminal queue recovers when initial delayed abort factory throws', async () => {
	const factoryError = new Error('factory failed');
	const failures: unknown[] = [];
	const writes: number[] = [];
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
		createAbortController: () => {
			throw factoryError;
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	const failed = transport.sendBatch(lease, [bytes(1), bytes(9)], {
		interSegmentDelayMs: 10,
	});
	const successor = transport.sendBatch(lease, [bytes(2)]);

	await assert.rejects(failed, (error) => error === factoryError);
	await Promise.race([
		successor,
		wait(200).then(() => {
			throw new Error('factory failure wedged successor');
		}),
	]);
	assert.deepEqual(writes, [2]);
	assert.deepEqual(failures, []);
});

void test('terminal queue recovers when promoted pending abort factory throws', async () => {
	const activeStarted = deferred();
	const releaseActive = deferred();
	const factoryError = new Error('factory failed');
	const failures: unknown[] = [];
	const writes: number[] = [];
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
		createAbortController: () => {
			throw factoryError;
		},
	});
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
	const failed = transport.sendBatch(lease, [bytes(2), bytes(9)], {
		interSegmentDelayMs: 10,
	});
	const successor = transport.sendBatch(lease, [bytes(3)]);

	releaseActive.resolve();
	await active;
	await assert.rejects(failed, (error) => error === factoryError);
	await Promise.race([
		successor,
		wait(200).then(() => {
			throw new Error('promoted factory failure wedged successor');
		}),
	]);
	assert.deepEqual(writes, [1, 3]);
	assert.deepEqual(failures, []);
});

for (const factoryTransition of [
	{
		name: 'invalidation',
		run: (transport: ReturnType<typeof createShellTerminalTransport>) =>
			transport.invalidate('runtime-reset'),
		canContinue: true,
	},
	{
		name: 'runtime replacement',
		run: (transport: ReturnType<typeof createShellTerminalTransport>) =>
			transport.setRuntimeInstance('replacement'),
		canContinue: true,
	},
	{
		name: 'shell replacement',
		run: (
			transport: ReturnType<typeof createShellTerminalTransport>,
			send: (segment: Uint8Array<ArrayBufferLike>) => Promise<void>,
		) => transport.setShell(createShellTransportKey('conn', 8), send),
		canContinue: true,
	},
	{
		name: 'shell clear and restore',
		run: (
			transport: ReturnType<typeof createShellTerminalTransport>,
			send: (segment: Uint8Array<ArrayBufferLike>) => Promise<void>,
		) => {
			transport.clearShell();
			transport.setShell(createShellTransportKey('conn', 7), send);
		},
		canContinue: true,
	},
	{
		name: 'runtime clear and restore',
		run: (transport: ReturnType<typeof createShellTerminalTransport>) => {
			transport.clearRuntime();
			transport.setRuntimeInstance('replacement');
		},
		canContinue: true,
	},
	{
		name: 'disposal',
		run: (transport: ReturnType<typeof createShellTerminalTransport>) =>
			transport.dispose(),
		canContinue: false,
	},
]) {
	void test(`terminal abort factory tolerates reentrant enqueue and ${factoryTransition.name}`, async () => {
		const writes: number[] = [];
		const failures: unknown[] = [];
		let aborts = 0;
		let abortListenerActive = true;
		let returnedController: AbortController | null = null;
		let nested: Promise<void> | null = null;
		let lease: TerminalInputLease | null = null;
		let transport!: ReturnType<typeof createShellTerminalTransport>;
		const send = async (segment: Uint8Array<ArrayBufferLike>) => {
			writes.push(segment[0] ?? -1);
		};
		transport = createShellTerminalTransport({
			onSendFailure: (error) => failures.push(error),
			createAbortController: () => {
				assert.ok(lease);
				nested = transport.sendBatch(lease, [bytes(2)]);
				factoryTransition.run(transport, send);
				const controller = new AbortController();
				controller.signal.addEventListener(
					'abort',
					() => {
						aborts += 1;
						abortListenerActive = false;
					},
					{ once: true },
				);
				returnedController = controller;
				return controller;
			},
		});
		transport.setShell(createShellTransportKey('conn', 7), send);
		transport.setRuntimeInstance('instance');
		lease = transport.captureLease();
		assert.ok(lease);
		const stale = transport.sendBatch(lease, [bytes(1), bytes(9)], {
			interSegmentDelayMs: 10,
		});
		await stale;
		assert.ok(nested);
		await nested;
		const controllerToInspect = returnedController as AbortController | null;
		assert.ok(controllerToInspect);
		assert.equal(aborts, 1);
		assert.equal(abortListenerActive, false);
		controllerToInspect.abort();
		assert.equal(aborts, 1);
		returnedController = null;
		if (factoryTransition.canContinue) {
			const freshLease = transport.captureLease();
			assert.ok(freshLease);
			await transport.sendBatch(freshLease, [bytes(3)]);
		}
		assert.deepEqual(writes, factoryTransition.canContinue ? [3] : []);
		assert.deepEqual(failures, []);
	});
}

void test('terminal abort factory can enqueue work and throw without wedging FIFO', async () => {
	const factoryError = new Error('factory failed');
	const writes: number[] = [];
	const failures: unknown[] = [];
	let nested: Promise<void> | null = null;
	let lease: TerminalInputLease | null = null;
	let transport!: ReturnType<typeof createShellTerminalTransport>;
	transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
		createAbortController: () => {
			assert.ok(lease);
			nested = transport.sendBatch(lease, [bytes(2)]);
			throw factoryError;
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	lease = transport.captureLease();
	assert.ok(lease);
	const failed = transport.sendBatch(lease, [bytes(1), bytes(9)], {
		interSegmentDelayMs: 10,
	});
	const successor = transport.sendBatch(lease, [bytes(3)]);

	await assert.rejects(failed, (error) => error === factoryError);
	assert.ok(nested);
	await Promise.all([nested, successor]);
	assert.deepEqual(writes, [2, 3]);
	assert.deepEqual(failures, []);
});

void test('terminal queue skips delayed entry with already-aborted factory result', async () => {
	const writes: number[] = [];
	const failures: unknown[] = [];
	const transport = createShellTerminalTransport({
		onSendFailure: (error) => failures.push(error),
		createAbortController: () => {
			const controller = new AbortController();
			controller.abort();
			return controller;
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
		writes.push(segment[0] ?? -1);
	});
	transport.setRuntimeInstance('instance');
	const lease = transport.captureLease();
	assert.ok(lease);
	await transport.sendBatch(lease, [bytes(1), bytes(9)], {
		interSegmentDelayMs: 10,
	});
	await transport.sendBatch(lease, [bytes(2)]);
	assert.deepEqual(writes, [2]);
	assert.deepEqual(failures, []);
});

void test('terminal pending delayed batches allocate controllers only on promotion', async () => {
	const activeStarted = deferred();
	const releaseActive = deferred();
	let allocations = 0;
	const transport = createShellTerminalTransport({
		onSendFailure: () => {},
		createAbortController: () => {
			allocations += 1;
			return new AbortController();
		},
	});
	transport.setShell(createShellTransportKey('conn', 7), async (segment) => {
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
	const pending = Array.from({ length: 100 }, () =>
		transport.sendBatch(lease, [bytes(2)], { interSegmentDelayMs: 1 }),
	);
	assert.equal(allocations, 0);

	releaseActive.resolve();
	await Promise.all([active, ...pending]);
	assert.equal(allocations, 100);
});
