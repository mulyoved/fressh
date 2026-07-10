import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';
import { createShellTerminalTransport } from '../../src/lib/shell-controllers/terminal-transport';
import { bytes } from './shell-terminal-transport-test-support';

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
void test('terminal transport rejects unauthenticated leases at sendBatch', async () => {
	const writes: number[] = [];
	const key = createShellTransportKey('conn', 7);
	const send = async (segment: Uint8Array<ArrayBufferLike>) => {
		writes.push(segment[0] ?? -1);
	};
	const owner = createShellTerminalTransport({ onSendFailure: () => {} });
	const foreign = createShellTerminalTransport({ onSendFailure: () => {} });
	for (const transport of [owner, foreign]) {
		transport.setShell(key, send);
		transport.setRuntimeInstance('instance');
	}
	const lease = owner.captureLease();
	assert.ok(lease);
	const foreignLease = foreign.captureLease();
	assert.ok(foreignLease);
	const clone = { ...lease };
	const forged = {
		runtimeKey: lease.runtimeKey,
		writerGeneration: lease.writerGeneration,
	};

	await Promise.all([
		owner.sendBatch(clone, [bytes(1)]),
		owner.sendBatch(forged, [bytes(2)]),
		owner.sendBatch(foreignLease, [bytes(3)]),
	]);
	owner.dispose();
	await Promise.all([
		owner.sendBatch(lease, [bytes(4)]),
		foreign.sendBatch(lease, [bytes(5)]),
	]);
	assert.deepEqual(writes, []);
});
