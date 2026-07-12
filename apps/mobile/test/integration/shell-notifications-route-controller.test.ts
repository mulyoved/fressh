import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildWorkmuxWindowOutput,
	createNotificationsHarness,
} from './shell-notifications-test-support';

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

void test('visible acknowledgement between unmount and route replay preserves adoption', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = harness.validRoute();
	let handledPublications = 0;
	harness.core.subscribe(() => {
		if (harness.core.getSnapshot().handledRouteKey) handledPublications += 1;
	});
	const original = harness.core.handleRoute(route);
	harness.core.invalidate('unmount');
	const visibleAcknowledgement = harness.core.acknowledgeVisible();
	assert.equal(harness.windowCommands.length, 1);
	const replay = harness.core.handleRoute(route);

	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@99'));
	await visibleAcknowledgement;
	assert.equal(
		harness.acknowledgements.filter(({ windowId }) => windowId === '@99')
			.length,
		1,
	);
	harness.routeCommands[0]?.resolve('');
	assert.deepEqual(await Promise.all([original, replay]), [false, true]);
	assert.deepEqual(harness.restoredTokens, []);
	assert.equal(handledPublications, 1);
	assert.equal(
		harness.acknowledgements.filter(({ windowId }) => windowId === '@12')
			.length,
		1,
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

			assert.deepEqual(harness.consumedTokens, ['token-1']);
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

function routeWithExplicitSession(
	harness: ReturnType<typeof createNotificationsHarness>,
) {
	return harness.validRoute();
}

void test('restored stale route token retries once under the latest context', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = routeWithExplicitSession(harness);
	const original = harness.core.handleRoute(route);
	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	const replacement = harness.core.handleRoute(route);
	const duplicateReplacement = harness.core.handleRoute(route);

	assert.equal(duplicateReplacement, replacement);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.reject(new Error('old context failed'));
	await harness.tick();
	assert.equal(harness.routeCommands.length, 2);
	assert.deepEqual(harness.routeCommands[1]?.argv, [
		'tmux',
		'app',
		'notification',
		'open',
		'--session',
		'main',
		'--window-id',
		'@12',
	]);
	harness.routeCommands[1]?.resolve('');

	assert.deepEqual(
		await Promise.all([original, replacement, duplicateReplacement]),
		[false, true, true],
	);
	assert.deepEqual(harness.consumedTokens, ['token-1', 'token-1']);
	assert.deepEqual(harness.restoredTokens, ['token-1']);
	assert.equal(harness.acknowledgements.length, 1);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('failed token restoration settles queued route without retrying', async (t) => {
	for (const options of [
		{ name: 'false', restoreTokenResult: false },
		{
			name: 'throw',
			restoreTokenError: new Error('restore failed'),
			warnError: new Error('warning failed'),
		},
	]) {
		await t.test(options.name, async () => {
			const harness = createNotificationsHarness({
				deferRouteCommands: true,
				...options,
			});
			const route = routeWithExplicitSession(harness);
			const original = harness.core.handleRoute(route);
			harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
			const replacement = harness.core.handleRoute(route);
			harness.routeCommands[0]?.reject(new Error('old context failed'));

			assert.deepEqual(await Promise.all([original, replacement]), [
				false,
				false,
			]);
			assert.equal(harness.routeCommands.length, 1);
			assert.deepEqual(harness.consumedTokens, ['token-1']);
			assert.deepEqual(harness.restoredTokens, ['token-1']);
			assert.equal(harness.core.getSnapshot().handledRouteKey, null);
			assert.deepEqual(harness.acknowledgements, []);
		});
	}
});

void test('stale successful route leaves queued replacement unauthorized', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = routeWithExplicitSession(harness);
	const original = harness.core.handleRoute(route);
	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	const replacement = harness.core.handleRoute(route);
	harness.routeCommands[0]?.resolve('');

	assert.deepEqual(await Promise.all([original, replacement]), [false, false]);
	assert.equal(harness.routeCommands.length, 1);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.deepEqual(harness.restoredTokens, []);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
});

void test('only the newest queued context retries after token restoration', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = routeWithExplicitSession(harness);
	const original = harness.core.handleRoute(route);
	harness.core.setContext(harness.context({ tmuxTarget: 'intermediate' }));
	const intermediate = harness.core.handleRoute(route);
	harness.core.setContext(harness.context({ tmuxTarget: 'latest' }));
	const latest = harness.core.handleRoute(route);
	harness.routeCommands[0]?.reject(new Error('old context failed'));
	await harness.tick();

	assert.equal(harness.routeCommands.length, 2);
	assert.equal(harness.routeCommands[1]?.argv[5], 'main');
	assert.equal(harness.core.getSnapshot().context.tmuxTarget, 'latest');
	harness.routeCommands[1]?.resolve('');
	assert.deepEqual(await Promise.all([original, intermediate, latest]), [
		false,
		false,
		true,
	]);
	assert.deepEqual(harness.consumedTokens, ['token-1', 'token-1']);
	assert.deepEqual(harness.restoredTokens, ['token-1']);
	assert.equal(harness.acknowledgements.length, 1);
});

void test('invalidation or disposal prevents a queued restoration retry', async (t) => {
	for (const action of ['invalidate', 'dispose'] as const) {
		await t.test(action, async () => {
			const harness = createNotificationsHarness({ deferRouteCommands: true });
			const route = routeWithExplicitSession(harness);
			const original = harness.core.handleRoute(route);
			harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
			const replacement = harness.core.handleRoute(route);
			if (action === 'invalidate') {
				harness.core.invalidate('runtime-reset');
			} else {
				harness.core.dispose();
			}
			harness.routeCommands[0]?.reject(new Error('old context failed'));

			assert.deepEqual(await Promise.all([original, replacement]), [
				false,
				false,
			]);
			assert.equal(harness.routeCommands.length, 1);
			assert.deepEqual(harness.consumedTokens, ['token-1']);
			assert.deepEqual(harness.restoredTokens, ['token-1']);
			assert.equal(harness.core.getSnapshot().handledRouteKey, null);
			assert.deepEqual(harness.acknowledgements, []);
		});
	}
});

void test('fallback session change cannot queue behind a different authorization identity', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = { ...harness.validRoute(), agentSession: null };
	const original = harness.core.handleRoute(route);
	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	const replacement = harness.core.handleRoute(route);
	let replacementSettled = false;
	void replacement.then(() => {
		replacementSettled = true;
	});
	await harness.tick();

	assert.equal(replacementSettled, false);
	assert.deepEqual(harness.consumedRouteIdentities, [
		'["saved-host","main","@12","event-1","token-1"]',
	]);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.reject(new Error('old context failed'));
	assert.deepEqual(await Promise.all([original, replacement]), [false, false]);
	assert.deepEqual(harness.consumedRouteIdentities, [
		'["saved-host","main","@12","event-1","token-1"]',
		'["saved-host","other","@12","event-1","token-1"]',
	]);
	assert.deepEqual(harness.restoredTokens, ['token-1']);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
});

void test('fallback connection change cannot queue behind a different authorization identity', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = { ...harness.validRoute(), agentConnectionId: null };
	const original = harness.core.handleRoute(route);
	const initial = harness.core.getSnapshot().context;
	harness.core.setContext({
		...initial,
		storedConnectionId: 'replacement-host',
	});
	const replacement = harness.core.handleRoute(route);
	let replacementSettled = false;
	void replacement.then(() => {
		replacementSettled = true;
	});
	await harness.tick();

	assert.equal(replacementSettled, false);
	assert.deepEqual(harness.consumedRouteIdentities, [
		'["saved-host","main","@12","event-1","token-1"]',
	]);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.reject(new Error('old context failed'));
	assert.deepEqual(await Promise.all([original, replacement]), [false, false]);
	assert.deepEqual(harness.consumedRouteIdentities, [
		'["saved-host","main","@12","event-1","token-1"]',
		'["replacement-host","main","@12","event-1","token-1"]',
	]);
	assert.deepEqual(harness.restoredTokens, ['token-1']);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
});

void test('equivalent explicit and fallback route fields share authorization identity', async (t) => {
	for (const entry of [
		{
			name: 'session',
			original: { agentSession: null },
			replacement: { agentSession: 'main' },
		},
		{
			name: 'connection',
			original: { agentConnectionId: null },
			replacement: { agentConnectionId: 'saved-host' },
		},
	]) {
		await t.test(entry.name, async () => {
			const harness = createNotificationsHarness({ deferRouteCommands: true });
			const originalRoute = { ...harness.validRoute(), ...entry.original };
			const replacementRoute = {
				...originalRoute,
				...entry.replacement,
			};
			const original = harness.core.handleRoute(originalRoute);
			const context = harness.core.getSnapshot().context;
			harness.core.setContext({ ...context, channelId: context.channelId + 1 });
			const replacement = harness.core.handleRoute(replacementRoute);

			assert.deepEqual(harness.consumedTokens, ['token-1']);
			harness.routeCommands[0]?.reject(new Error('old context failed'));
			await harness.tick();
			assert.equal(harness.routeCommands.length, 2);
			harness.routeCommands[1]?.resolve('');
			assert.deepEqual(await Promise.all([original, replacement]), [
				false,
				true,
			]);
			assert.deepEqual(harness.consumedTokens, ['token-1', 'token-1']);
			assert.deepEqual(harness.restoredTokens, ['token-1']);
			assert.equal(harness.acknowledgements.length, 1);
		});
	}
});

void test('same-context equivalent authorization callers share one physical attempt', async (t) => {
	const cases = [
		{
			name: 'session fallback to explicit',
			first: { agentSession: null },
			second: { agentSession: 'main' },
		},
		{
			name: 'session explicit to fallback',
			first: { agentSession: 'main' },
			second: { agentSession: null },
		},
		{
			name: 'connection fallback to explicit',
			first: { agentConnectionId: null },
			second: { agentConnectionId: 'saved-host' },
		},
		{
			name: 'connection explicit to fallback',
			first: { agentConnectionId: 'saved-host' },
			second: { agentConnectionId: null },
		},
	];

	for (const entry of cases) {
		await t.test(entry.name, async () => {
			const harness = createNotificationsHarness({ deferRouteCommands: true });
			let handledPublications = 0;
			harness.core.subscribe(() => {
				if (harness.core.getSnapshot().handledRouteKey) {
					handledPublications += 1;
				}
			});
			const first = harness.core.handleRoute({
				...harness.validRoute(),
				...entry.first,
			});
			const second = harness.core.handleRoute({
				...harness.validRoute(),
				...entry.second,
			});

			assert.deepEqual(harness.consumedTokens, ['token-1']);
			assert.equal(harness.routeCommands.length, 1);
			harness.routeCommands[0]?.resolve('');
			assert.deepEqual(await Promise.all([first, second]), [true, true]);
			assert.equal(handledPublications, 1);
			assert.equal(harness.acknowledgements.length, 1);
		});
	}
});

function authorizationIdentity(
	windowId: string,
	eventId: string,
	tapToken: string,
): string {
	return JSON.stringify(['saved-host', 'main', windowId, eventId, tapToken]);
}

function secondAuthorizedRoute(
	harness: ReturnType<typeof createNotificationsHarness>,
) {
	return {
		...harness.validRoute(),
		agentWindowId: '@13',
		agentEventId: 'event-2',
		agentTapToken: 'token-2',
	};
}

function createMultiIdentityHarness() {
	return createNotificationsHarness({
		deferRouteCommands: true,
		authorizedRouteIdentities: [
			authorizationIdentity('@12', 'event-1', 'token-1'),
			authorizationIdentity('@13', 'event-2', 'token-2'),
		],
	});
}

void test('distinct authorized routes serialize physical commands in request order', async () => {
	const harness = createMultiIdentityHarness();
	const first = harness.core.handleRoute(harness.validRoute());
	const second = harness.core.handleRoute(secondAuthorizedRoute(harness));

	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.resolve('');
	await harness.tick();
	assert.equal(harness.routeCommands.length, 2);
	assert.deepEqual(harness.consumedTokens, ['token-1', 'token-2']);
	harness.routeCommands[1]?.resolve('');

	assert.deepEqual(await Promise.all([first, second]), [false, true]);
	assert.deepEqual(harness.restoredTokens, []);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@13' },
	]);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@13","event-2"]',
	);
});

void test('newest active-equivalent route displaces a distinct queued route', async () => {
	const harness = createMultiIdentityHarness();
	const routeA = harness.validRoute();
	const originalA = harness.core.handleRoute(routeA);
	const queuedB = harness.core.handleRoute(secondAuthorizedRoute(harness));
	let queuedBResult: boolean | null = null;
	void queuedB.then((handled) => {
		queuedBResult = handled;
	});
	const newestA = harness.core.handleRoute({ ...routeA });
	await harness.tick();

	assert.equal(queuedBResult, false);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.resolve('');

	assert.deepEqual(await Promise.all([originalA, queuedB, newestA]), [
		true,
		false,
		true,
	]);
	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	]);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('queued route snapshots caller-owned fields before promotion', async () => {
	const harness = createMultiIdentityHarness();
	const first = harness.core.handleRoute(harness.validRoute());
	const queuedRoute = secondAuthorizedRoute(harness);
	const second = harness.core.handleRoute(queuedRoute);

	queuedRoute.agentConnectionId = 'mutated-host';
	queuedRoute.agentSession = 'mutated-session';
	queuedRoute.agentWindowId = '@99';
	queuedRoute.agentEventId = 'mutated-event';
	queuedRoute.agentTapToken = 'mutated-token';
	harness.routeCommands[0]?.resolve('');
	await harness.tick();

	assert.equal(harness.routeCommands.length, 2);
	assert.deepEqual(harness.routeCommands[1]?.argv, [
		'tmux',
		'app',
		'notification',
		'open',
		'--session',
		'main',
		'--window-id',
		'@13',
	]);
	harness.routeCommands[1]?.resolve('');
	assert.deepEqual(await Promise.all([first, second]), [false, true]);
	assert.deepEqual(harness.consumedRouteIdentities, [
		authorizationIdentity('@12', 'event-1', 'token-1'),
		authorizationIdentity('@13', 'event-2', 'token-2'),
	]);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@13' },
	]);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@13","event-2"]',
	);
});

void test('context subscriber can enqueue the new revision before old route settles', async () => {
	const harness = createMultiIdentityHarness();
	const first = harness.core.handleRoute(harness.validRoute());
	let second: Promise<boolean> | null = null;
	let observedRevision = 0;
	const unsubscribe = harness.core.subscribe(() => {
		const snapshot = harness.core.getSnapshot();
		if (snapshot.contextRevision === 1 && !second) {
			observedRevision = snapshot.contextRevision;
			second = harness.core.handleRoute(secondAuthorizedRoute(harness));
		}
	});
	const context = harness.core.getSnapshot().context;
	harness.core.setContext({ ...context, channelId: context.channelId + 1 });
	assert.equal(observedRevision, 1);
	assert.ok(second);

	harness.routeCommands[0]?.resolve('');
	await harness.tick();
	assert.equal(harness.routeCommands.length, 2);
	harness.routeCommands[1]?.resolve('');
	assert.deepEqual(await Promise.all([first, second]), [false, true]);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@13' },
	]);
	unsubscribe();
});

void test('unmount replay refreshes sequence after a distinct queue was cancelled', async () => {
	const harness = createMultiIdentityHarness();
	const route = harness.validRoute();
	const original = harness.core.handleRoute(route);
	const queued = harness.core.handleRoute(secondAuthorizedRoute(harness));
	harness.core.invalidate('unmount');
	const replay = harness.core.handleRoute(route);

	assert.deepEqual(harness.consumedTokens, ['token-1']);
	assert.equal(harness.routeCommands.length, 1);
	harness.routeCommands[0]?.resolve('');
	assert.deepEqual(await Promise.all([original, queued, replay]), [
		false,
		false,
		true,
	]);
	assert.equal(harness.routeCommands.length, 1);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	]);
	assert.equal(
		harness.core.getSnapshot().handledRouteKey,
		'["saved-host","main","@12","event-1"]',
	);
});

void test('invalidation or disposal settles a distinct serialized route queue', async (t) => {
	for (const action of ['invalidate', 'dispose'] as const) {
		await t.test(action, async () => {
			const harness = createMultiIdentityHarness();
			const first = harness.core.handleRoute(harness.validRoute());
			const second = harness.core.handleRoute(secondAuthorizedRoute(harness));
			if (action === 'invalidate') {
				harness.core.invalidate('runtime-reset');
			} else {
				harness.core.dispose();
			}
			harness.routeCommands[0]?.resolve('');

			assert.deepEqual(await Promise.all([first, second]), [false, false]);
			assert.deepEqual(harness.consumedTokens, ['token-1']);
			assert.equal(harness.routeCommands.length, 1);
			assert.deepEqual(harness.acknowledgements, []);
		});
	}
});

void test('restoration retry budget cannot fund a third same-lease command', async () => {
	const harness = createNotificationsHarness({ deferRouteCommands: true });
	const route = harness.validRoute();
	const original = harness.core.handleRoute(route);
	const contextA = harness.core.getSnapshot().context;
	harness.core.setContext({ ...contextA, channelId: 8 });
	const contextB = harness.core.handleRoute(route);
	harness.routeCommands[0]?.reject(new Error('context A failed'));
	await harness.tick();
	assert.equal(harness.routeCommands.length, 2);

	const current = harness.core.getSnapshot().context;
	harness.core.setContext({ ...current, channelId: 9 });
	const contextC = harness.core.handleRoute(route);
	harness.routeCommands[1]?.reject(new Error('context B failed'));

	assert.deepEqual(await Promise.all([original, contextB, contextC]), [
		false,
		false,
		false,
	]);
	assert.equal(harness.routeCommands.length, 2);
	assert.deepEqual(harness.consumedTokens, ['token-1', 'token-1']);
	assert.deepEqual(harness.restoredTokens, ['token-1', 'token-1']);
	assert.equal(harness.core.getSnapshot().handledRouteKey, null);
	assert.deepEqual(harness.acknowledgements, []);
});

void test('distinct authorization queued during restoration retry runs independently', async () => {
	const harness = createMultiIdentityHarness();
	const firstRoute = harness.validRoute();
	const original = harness.core.handleRoute(firstRoute);
	const context = harness.core.getSnapshot().context;
	harness.core.setContext({ ...context, channelId: 8 });
	const restorationRetry = harness.core.handleRoute(firstRoute);
	harness.routeCommands[0]?.reject(new Error('original failed'));
	await harness.tick();
	assert.equal(harness.routeCommands.length, 2);

	const distinct = harness.core.handleRoute(secondAuthorizedRoute(harness));
	harness.routeCommands[1]?.reject(new Error('restoration retry failed'));
	await harness.tick();
	assert.equal(harness.routeCommands.length, 3);
	harness.routeCommands[2]?.resolve('');

	assert.deepEqual(await Promise.all([original, restorationRetry, distinct]), [
		false,
		false,
		true,
	]);
	assert.deepEqual(harness.consumedTokens, ['token-1', 'token-1', 'token-2']);
	assert.deepEqual(harness.restoredTokens, ['token-1', 'token-1']);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@13' },
	]);
});
