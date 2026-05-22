import assert from 'node:assert/strict';
import test from 'node:test';
import {
	acknowledgeVisibleAgentNotification,
	notifyAgentNotificationPending,
	subscribeAgentNotificationPending,
	type VisibleAgentNotificationSnapshot,
} from '../../src/lib/agent-notification-visibility';

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

function waitForMicrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness() {
	let requestId = 0;
	let visibility: VisibleAgentNotificationSnapshot = {
		isFocused: true,
		isAppActive: true,
		connectionId: 'conn-1',
		channelId: 7,
		tmuxTarget: 'main',
	};
	const commands: { command: string; timeoutMs: number }[] = [];
	const acknowledgements: { connectionId: string; windowId: string }[] = [];
	const warnings: unknown[] = [];

	return {
		commands,
		acknowledgements,
		warnings,
		setVisibility(next: Partial<VisibleAgentNotificationSnapshot>) {
			visibility = { ...visibility, ...next };
			requestId += 1;
		},
		invalidateRequest() {
			requestId += 1;
		},
		options(
			runCommand: (command: string, timeoutMs: number) => Promise<string>,
		) {
			return {
				platformOS: 'android',
				connectionId: 'conn-1',
				channelId: 7,
				tmuxEnabled: true,
				tmuxTarget: 'main',
				getVisibility: () => visibility,
				nextRequestId: () => {
					requestId += 1;
					return requestId;
				},
				isCurrentRequest: (id: number) => id === requestId,
				runCommand: async (command: string, timeoutMs: number) => {
					commands.push({ command, timeoutMs });
					return runCommand(command, timeoutMs);
				},
				acknowledge: (connectionId: string, windowId: string) => {
					acknowledgements.push({ connectionId, windowId });
				},
				warn: (_message: string, error: unknown) => {
					warnings.push(error);
				},
			};
		},
	};
}

void test('acknowledgeVisibleAgentNotification acknowledges current visible window', async () => {
	const harness = createHarness();

	await acknowledgeVisibleAgentNotification(
		harness.options(async () => 'ignored\n@12\n'),
	);

	assert.deepEqual(harness.commands, [
		{
			command: "tmux display-message -p -t 'main:' '#{window_id}'",
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'conn-1', windowId: '@12' },
	]);
});

void test('acknowledgeVisibleAgentNotification skips invisible or unsupported states', async () => {
	const states = [
		{ platformOS: 'ios' },
		{ connectionId: null },
		{ tmuxEnabled: false },
		{ visibility: { isFocused: false } },
		{ visibility: { isAppActive: false } },
	];

	for (const state of states) {
		const harness = createHarness();
		if (state.visibility) harness.setVisibility(state.visibility);

		await acknowledgeVisibleAgentNotification({
			...harness.options(async () => '@12'),
			...state,
		});

		assert.deepEqual(harness.commands, []);
		assert.deepEqual(harness.acknowledgements, []);
	}
});

void test('acknowledgeVisibleAgentNotification ignores stale async results', async () => {
	const staleCases: Partial<VisibleAgentNotificationSnapshot>[] = [
		{ isFocused: false },
		{ isAppActive: false },
		{ connectionId: 'conn-2' },
		{ channelId: 8 },
		{ tmuxTarget: 'other' },
	];

	for (const staleVisibility of staleCases) {
		const harness = createHarness();
		const deferred = createDeferred<string>();
		const pending = acknowledgeVisibleAgentNotification(
			harness.options(async () => deferred.promise),
		);

		harness.setVisibility(staleVisibility);
		deferred.resolve('@12');
		await pending;

		assert.deepEqual(harness.acknowledgements, []);
	}
});

void test('acknowledgeVisibleAgentNotification ignores superseded requests without visibility changes', async () => {
	const harness = createHarness();
	const deferred = createDeferred<string>();
	const pending = acknowledgeVisibleAgentNotification(
		harness.options(async () => deferred.promise),
	);

	harness.invalidateRequest();
	deferred.resolve('@12');
	await pending;

	assert.deepEqual(harness.acknowledgements, []);
});

void test('acknowledgeVisibleAgentNotification coalesces concurrent requests into one queued rerun', async () => {
	const harness = createHarness();
	const first = createDeferred<string>();
	const second = createDeferred<string>();
	let commandCount = 0;
	const runCommand = async () => {
		commandCount += 1;
		return commandCount === 1 ? first.promise : second.promise;
	};

	const firstPending = acknowledgeVisibleAgentNotification(
		harness.options(runCommand),
	);
	const queuedA = acknowledgeVisibleAgentNotification(
		harness.options(runCommand),
	);
	const queuedB = acknowledgeVisibleAgentNotification(
		harness.options(runCommand),
	);
	await waitForMicrotask();

	assert.equal(commandCount, 1);
	first.resolve('@12');
	await waitForMicrotask();
	assert.equal(commandCount, 2);
	second.resolve('@12');
	await Promise.all([firstPending, queuedA, queuedB]);

	assert.equal(commandCount, 2);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'conn-1', windowId: '@12' },
		{ connectionId: 'conn-1', windowId: '@12' },
	]);
});

void test('acknowledgeVisibleAgentNotification ignores empty command output', async () => {
	const harness = createHarness();

	await acknowledgeVisibleAgentNotification(
		harness.options(async () => '  \n\n'),
	);

	assert.deepEqual(harness.acknowledgements, []);
});

void test('pending notification subscribers are notified until unsubscribed', () => {
	let calls = 0;
	const unsubscribe = subscribeAgentNotificationPending(() => {
		calls += 1;
	});

	notifyAgentNotificationPending();
	unsubscribe();
	notifyAgentNotificationPending();

	assert.equal(calls, 1);
});
