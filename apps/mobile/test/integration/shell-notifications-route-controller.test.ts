import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationsHarness } from './shell-notifications-test-support';

void test('notification core restores consumed token when route command fails', async () => {
	const harness = createNotificationsHarness({
		routeCommandError: new Error('failed'),
	});
	const handled = await harness.core.handleRoute(harness.validRoute());

	assert.equal(handled, false);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, ['token-1']);
});

void test('notification core handles an authorized route only once', async () => {
	const harness = createNotificationsHarness();
	const route = harness.validRoute();

	assert.equal(await harness.core.handleRoute(route), true);
	assert.equal(await harness.core.handleRoute(route), false);
	assert.equal(harness.routeCommands.length, 1);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('notification route acknowledgement remains best effort after selection', async () => {
	const failure = new Error('bridge failed');
	const harness = createNotificationsHarness({ acknowledgeError: failure });

	assert.equal(await harness.core.handleRoute(harness.validRoute()), true);
	assert.deepEqual(harness.restoredTokens, []);
	assert.deepEqual(harness.warnings, [failure]);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

async function assertStaleSuccessfulRoute(
	mutate: (harness: ReturnType<typeof createNotificationsHarness>) => void,
): Promise<void> {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const pending = harness.core.handleRoute(harness.validRoute());
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	mutate(harness);
	harness.routeCommands[0]?.resolve('');

	assert.equal(await pending, false);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, []);
}

void test('semantic context change suppresses a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	});
});

void test('stored connection change suppresses a pending successful route without advancing generation', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		const before = harness.core.getSnapshot();
		harness.core.setContext({
			...before.context,
			storedConnectionId: 'replacement-host',
		});
		assert.equal(harness.core.getSnapshot().generation, before.generation);
	});
});

void test('explicit invalidation suppresses a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		harness.core.invalidate('runtime-reset');
	});
});

void test('route handling establishes a fresh explicit invalidation epoch', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	harness.core.invalidate('source-change');
	const pending = harness.core.handleRoute(harness.validRoute());
	harness.core.invalidate('runtime-reset');
	harness.routeCommands[0]?.resolve('');

	assert.equal(await pending, false);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, []);
});

void test('disposal suppresses a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		harness.core.dispose();
	});
});

void test('a newer route request supersedes a pending successful route', async () => {
	await assertStaleSuccessfulRoute((harness) => {
		void harness.core.handleRoute({
			...harness.validRoute(),
			agentTapToken: null,
		});
	});
});

void test('identical concurrent routes share one authorized attempt', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = harness.validRoute();
	let handledPublications = 0;
	harness.core.subscribe(() => {
		if (harness.core.getSnapshot().handledRouteKey) handledPublications += 1;
	});

	const first = harness.core.handleRoute(route);
	const second = harness.core.handleRoute(route);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.resolve('');

	assert.deepEqual(await Promise.all([first, second]), [true, true]);
	assert.deepEqual(harness.restoredTokens, []);
	assert.equal(handledPublications, 1);
	assert.equal(harness.acknowledgements.length, 1);
});

void test('identical route replay adopts the pending attempt after unmount invalidation', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = harness.validRoute();
	let handledPublications = 0;
	harness.core.subscribe(() => {
		if (harness.core.getSnapshot().handledRouteKey) handledPublications += 1;
	});
	const first = harness.core.handleRoute(route);
	harness.core.invalidate('unmount');
	const replay = harness.core.handleRoute(route);

	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.resolve('');
	assert.deepEqual(await Promise.all([first, replay]), [false, true]);
	assert.deepEqual(harness.restoredTokens, []);
	assert.equal(handledPublications, 1);
	assert.equal(harness.acknowledgements.length, 1);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('non-unmount invalidations never transfer a pending route operation', async (t) => {
	const cases = [
		{
			reason: 'runtime-reset' as const,
			sequence: ['unmount', 'runtime-reset'] as const,
		},
		{
			reason: 'focus-lost' as const,
			sequence: ['focus-lost', 'unmount'] as const,
		},
		{
			reason: 'app-inactive' as const,
			sequence: ['app-inactive', 'unmount'] as const,
		},
		{
			reason: 'source-change' as const,
			sequence: ['source-change', 'unmount'] as const,
		},
		{
			reason: 'closed' as const,
			sequence: ['closed', 'unmount'] as const,
		},
	];

	for (const { reason, sequence } of cases) {
		await t.test(reason, async () => {
			const harness = createNotificationsHarness({ deferRouteCommands: true });
			const route = harness.validRoute();
			const original = harness.core.handleRoute(route);
			for (const invalidation of sequence) {
				harness.core.invalidate(invalidation);
			}
			const replacement = harness.core.handleRoute(route);

			assert.deepEqual(harness.consumedTokens, ['token-1', 'token-1']);
			assert.equal(harness.routeCommands.length, 1);
			harness.routeCommands[0]?.resolve('');
			assert.deepEqual(await Promise.all([original, replacement]), [
				false,
				false,
			]);
			assert.equal(harness.core.getSnapshot().handledRouteKey, null);
			assert.deepEqual(harness.acknowledgements, []);
			assert.deepEqual(harness.restoredTokens, []);
		});
	}
});

void test('route commitment survives subscriber invalidation during handled publication', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	let invalidated = false;
	harness.core.subscribe(() => {
		if (!invalidated && harness.core.getSnapshot().handledRouteKey) {
			invalidated = true;
			harness.core.invalidate('runtime-reset');
		}
	});
	const pending = harness.core.handleRoute(harness.validRoute());
	harness.routeCommands[0]?.resolve('');

	assert.equal(await pending, true);
	assert.equal(invalidated, true);
	assert.equal(harness.acknowledgements.length, 1);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('route context revision prevents A-B-A resurrection', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const pending = harness.core.handleRoute(harness.validRoute());
	const initial = harness.core.getSnapshot();
	const changed = {
		...initial.context,
		storedConnectionId: 'replacement-host',
	};
	harness.core.setContext(changed);
	harness.core.setContext(initial.context);
	const restored = harness.core.getSnapshot();
	assert.equal(restored.generation, initial.generation);
	assert.equal(restored.contextRevision, initial.contextRevision + 2);
	harness.routeCommands[0]?.resolve('');

	assert.equal(await pending, false);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, []);
});
