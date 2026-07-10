# Shell Activity and Notifications Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize shell focus/AppState observation and move notification
routing, visible-target acknowledgement, coalescing, invalidation, and cleanup
out of `detail.tsx`.

**Architecture:** A pure activity core publishes focused/app-active transitions,
while a thin hook owns `useIsFocused` and the single React Native AppState
subscription. A notification core consumes activity and target snapshots, owns
request generations plus one queued rerun, and composes the existing route-token
and visibility helpers; its hook binds route params, native pending events, and
bridge acknowledgement.

**Tech Stack:** TypeScript 5.9, React 19, React Navigation 7, React Native
AppState, Expo/Android notification bridge, Node `tsx --test`, pnpm.

## Global Constraints

- Start from the merged modal-controller PR and consume its lifecycle/source-key
  exports.
- Activity observes lifecycle only; it must not import or call domain
  controllers.
- Keep one AppState subscription and one navigation-focus source of truth.
- Returning active/focused must not resurrect requests invalidated while
  inactive.
- Notification acknowledgement is Android-only and best effort; it must never
  interrupt terminal input.
- Preserve route token consume/restore behavior and pending-notification
  subscription behavior.
- Move acknowledgement coalescing out of module-global variables and into the
  notification core.
- Workmux status cycling remains in keyboard code and is untouched by this PR.
- Keep other domains temporarily reacting to the activity snapshot in
  `detail.tsx`; do not recreate AppState subscriptions for them.

---

## File Structure

**Create:**

- `apps/mobile/src/lib/shell-controllers/activity-core.ts` — pure focus/AppState
  transition core.
- `apps/mobile/src/lib/shell-controllers/activity.tsx` — navigation/AppState
  hook.
- `apps/mobile/src/lib/shell-controllers/notifications-core.ts` — route and
  acknowledgement lifecycle.
- `apps/mobile/src/lib/shell-controllers/notifications.tsx` —
  route-param/native/React adapter.
- `apps/mobile/test/integration/shell-activity-controller.test.ts`
- `apps/mobile/test/integration/shell-notifications-controller.test.ts`
- `apps/mobile/test/integration/shell-activity-notifications-composition.test.ts`

**Modify:**

- `apps/mobile/src/lib/agent-notification-visibility.ts` — make visible
  acknowledgement a single guarded attempt; remove module-global coalescing.
- `apps/mobile/test/integration/agent-notification-visibility.test.ts` — retain
  pure attempt tests and move coalescing assertions to the controller test.
- `apps/mobile/src/app/shell/detail.tsx` — consume activity/notification hooks
  and remove notification refs/effects.

## Published Interfaces

```ts
export type ShellActivitySnapshot = {
	focused: boolean;
	appState: string;
	appActive: boolean;
	interactive: boolean;
	generation: number;
};

export type ShellActivityControllerCore =
	ControllerCore<ShellActivitySnapshot> & {
		setFocused(focused: boolean): void;
		setAppState(appState: string): void;
	};

export type ShellActivityControllerHandle = {
	snapshot: ShellActivitySnapshot;
	getSnapshot(): ShellActivitySnapshot;
	subscribe(listener: () => void): () => void;
};

export type ShellNotificationContext = {
	transportKey: ShellTransportKey;
	targetKey: ShellTargetKey;
	storedConnectionId: string | null;
	channelId: number;
	tmuxEnabled: boolean;
	tmuxTarget: string;
};

export type ShellNotificationRoute = {
	agentConnectionId: string | null;
	agentSession: string | null;
	agentWindowId: string | null;
	agentEventId: string | null;
	agentTapToken: string | null;
};

export type ShellNotificationsState = {
	context: ShellNotificationContext;
	handledRouteKey: string | null;
	generation: number;
	acknowledgeInFlight: boolean;
	acknowledgeQueued: boolean;
};

export type ShellNotificationsControllerHandle = {
	acknowledgeVisible(): Promise<void>;
	invalidate(reason: ControllerInvalidationReason): void;
};
```

---

### Task 1: Activity Core and Platform Hook

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/activity-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/activity.tsx`
- Test: `apps/mobile/test/integration/shell-activity-controller.test.ts`

**Interfaces:**

- Consumes: `ControllerCore`, `ControllerInvalidationReason`, and
  `createControllerPublisher` from the modal PR.
- Produces: all activity types and `useShellActivityController()` shown above.

- [ ] **Step 1: Write failing transition tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellActivityControllerCore } from '../../src/lib/shell-controllers/activity-core';

void test('activity generation advances at interactive boundaries only', () => {
	const core = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	assert.deepEqual(core.getSnapshot(), {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});
	core.setFocused(true);
	assert.equal(core.getSnapshot().generation, 0);
	core.setFocused(false);
	assert.equal(core.getSnapshot().generation, 1);
	core.setAppState('background');
	assert.equal(core.getSnapshot().generation, 1);
	core.setFocused(true);
	assert.equal(core.getSnapshot().generation, 1);
	core.setAppState('active');
	assert.equal(core.getSnapshot().generation, 2);
});

void test('activity dispose publishes a final noninteractive state once', () => {
	const core = createShellActivityControllerCore({
		focused: true,
		appState: 'active',
	});
	core.dispose();
	core.dispose();
	assert.equal(core.getSnapshot().interactive, false);
	assert.equal(core.getSnapshot().generation, 1);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-activity-controller.test.ts
```

Expected: FAIL because `activity-core.ts` is missing.

- [ ] **Step 3: Implement the activity core**

Implement `createShellActivityControllerCore({ focused, appState })`. Derive
`appActive` as `appState === 'active'` and `interactive` as
`focused && appActive`. Publish only when a field changes; increment generation
only when `interactive` changes. `invalidate('focus-lost')` calls
`setFocused(false)`, `invalidate('app-inactive')` calls
`setAppState('inactive')`, and `dispose()` publishes one final noninteractive
snapshot before disposing its publisher.

- [ ] **Step 4: Implement the platform hook**

```ts
export function useShellActivityController(): ShellActivityControllerHandle {
	const focused = useIsFocused();
	const [core] = useState(() =>
		createShellActivityControllerCore({
			focused,
			appState: AppState.currentState,
		}),
	);
	const snapshot = useSyncExternalStore(core.subscribe, core.getSnapshot);
	useLayoutEffect(() => core.setFocused(focused), [core, focused]);
	useEffect(() => {
		const subscription = AppState.addEventListener('change', core.setAppState);
		return () => subscription.remove();
	}, [core]);
	useEffect(() => () => core.dispose(), [core]);
	return useMemo(
		() => ({
			snapshot,
			getSnapshot: core.getSnapshot,
			subscribe: core.subscribe,
		}),
		[core, snapshot],
	);
}
```

Bind core methods or implement them as arrow functions so they are safe to pass
to `AppState.addEventListener`.

- [ ] **Step 5: Run tests and typecheck**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-activity-controller.test.ts && pnpm run typecheck
```

Expected: PASS and zero type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/activity-core.ts apps/mobile/src/lib/shell-controllers/activity.tsx apps/mobile/test/integration/shell-activity-controller.test.ts
git commit -m "refactor(mobile): centralize shell activity state"
```

---

### Task 2: Notification Acknowledgement Core

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/notifications-core.ts`
- Create: `apps/mobile/test/integration/shell-notifications-controller.test.ts`
- Modify: `apps/mobile/src/lib/agent-notification-visibility.ts`
- Modify: `apps/mobile/test/integration/agent-notification-visibility.test.ts`

**Interfaces:**

- Consumes: activity handle from Task 1, source keys/controller lifecycle from
  the modal PR, and existing Workmux window parsing/acknowledgement helpers.
- Produces: `ShellNotificationsControllerCore`,
  `createShellNotificationsControllerCore`, `setContext`, `acknowledgeVisible`,
  and `notifyPending`.

- [ ] **Step 1: Write failing coalescing and stale-context tests**

```ts
void test('notification core coalesces concurrent visible acknowledgements', async () => {
	const harness = createNotificationsHarness();
	const first = harness.core.acknowledgeVisible();
	const queuedA = harness.core.acknowledgeVisible();
	const queuedB = harness.core.acknowledgeVisible();
	assert.equal(harness.windowCommands.length, 1);
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await harness.tick();
	assert.equal(harness.windowCommands.length, 2);
	harness.windowCommands[1]?.resolve(buildWorkmuxWindowOutput('@13'));
	await Promise.all([first, queuedA, queuedB]);
	assert.deepEqual(harness.acknowledgedWindowIds, ['@12', '@13']);
});

void test('notification core suppresses acknowledgement after target change', async () => {
	const harness = createNotificationsHarness();
	const pending = harness.core.acknowledgeVisible();
	harness.core.setContext(harness.context({ tmuxTarget: 'other' }));
	harness.windowCommands[0]?.resolve(buildWorkmuxWindowOutput('@12'));
	await pending;
	assert.deepEqual(harness.acknowledgedWindowIds, []);
});
```

The test file defines the deferred command harness, an activity core, source
keys, `buildWorkmuxWindowOutput`, and fake acknowledgement/warn callbacks.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-notifications-controller.test.ts
```

Expected: FAIL because `notifications-core.ts` is missing.

- [ ] **Step 3: Make the visibility helper one guarded attempt**

In `agent-notification-visibility.ts`, delete `acknowledgeInFlight`,
`acknowledgeQueued`, `latestAcknowledgeOptions`, and waiter globals. Rename the
private `acknowledgeVisibleAgentNotificationOnce` body to the exported
`acknowledgeVisibleAgentNotification`; it performs one guarded Workmux window
lookup and retains all identity/current-request checks. Update its existing
tests: keep Android gating, empty output, current acknowledgement, stale
visibility, and superseded request cases; remove the module-global coalescing
test because the controller now owns that behavior.

- [ ] **Step 4: Implement controller-owned coalescing and invalidation**

Use this core surface:

```ts
export type ShellNotificationsControllerCore =
	ControllerCore<ShellNotificationsState> & {
		setContext(context: ShellNotificationContext): void;
		acknowledgeVisible(): Promise<void>;
		notifyPending(): void;
		handleRoute(route: ShellNotificationRoute): Promise<boolean>;
	};
```

For acknowledgement, keep `generation`, `inFlight`, `queued`, and one array of
queued waiters inside the core. Multiple calls during an active lookup set one
queued rerun and share its completion. `setContext` compares transport and
target keys, increments generation before publishing the new context, and does
not acknowledge by itself. Each attempt passes the core generation and
`activity.getSnapshot()` to the pure visibility helper. `notifyPending()` calls
`acknowledgeVisible()` only when activity is interactive.

- [ ] **Step 5: Run controller and helper tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-notifications-controller.test.ts \
  test/integration/agent-notification-visibility.test.ts
```

Expected: all acknowledgement, coalescing, and stale-context tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/notifications-core.ts apps/mobile/src/lib/agent-notification-visibility.ts apps/mobile/test/integration/shell-notifications-controller.test.ts apps/mobile/test/integration/agent-notification-visibility.test.ts
git commit -m "refactor(mobile): isolate notification acknowledgement lifecycle"
```

---

### Task 3: Route Handling and Notification Hook

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/notifications.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/notifications-core.ts`
- Modify: `apps/mobile/test/integration/shell-notifications-controller.test.ts`

**Interfaces:**

- Consumes: notification core from Task 2, activity handle from Task 1, route
  token store/bridge functions, and `subscribeAgentNotificationPending`.
- Produces:
  `useShellNotificationsController(input): ShellNotificationsControllerHandle`.

- [ ] **Step 1: Add failing route lifecycle tests**

```ts
void test('notification core restores consumed token when route command fails', async () => {
	const harness = createNotificationsHarness({
		routeCommandError: new Error('failed'),
	});
	const handled = await harness.core.handleRoute({
		agentConnectionId: 'saved-host',
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'event-1',
		agentTapToken: 'token-1',
	});
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
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-notifications-controller.test.ts
```

Expected: route tests FAIL until `handleRoute` owns handled-route state and
token restoration.

- [ ] **Step 3: Implement route ownership and the hook**

Have `handleRoute` call the existing `handleAgentNotificationRoute` with
core-owned `handledRouteKey`, injected token consume/restore operations, and the
current target. Mark the key only after the Workmux open command succeeds; leave
acknowledgement best effort.

`useShellNotificationsController` accepts parsed route values, notification
context, activity, the Workmux command port, and logger. It creates the core,
updates context in a layout effect, calls `handleRoute` when route inputs
change, calls `acknowledgeVisible` after an interactive context update and on
transitions to interactive, subscribes to `subscribeAgentNotificationPending` on
Android, and disposes on unmount. Bind consume/restore/acknowledge to the
existing route-store exports.

- [ ] **Step 4: Run notification suites and typecheck**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-notifications-controller.test.ts \
  test/integration/agent-notification-visibility.test.ts \
  test/integration/agent-notification-route.test.ts \
  test/integration/agent-notification-route-store.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/notifications-core.ts apps/mobile/src/lib/shell-controllers/notifications.tsx apps/mobile/test/integration/shell-notifications-controller.test.ts
git commit -m "refactor(mobile): add shell notification controller hook"
```

---

### Task 4: Integrate Activity and Notifications into the Shell Screen

**Files:**

- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Create:
  `apps/mobile/test/integration/shell-activity-notifications-composition.test.ts`

**Interfaces:**

- Consumes: activity/notification hooks from Tasks 1-3 and source keys from
  PR 1.
- Produces: shared activity inputs used by terminal, scrollback, and keyboard
  plans.

- [ ] **Step 1: Write the failing composition guard**

```ts
void test('shell detail delegates activity and notification lifecycle', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.match(source, /useShellActivityController\(\)/);
	assert.match(source, /useShellNotificationsController\(\{/);
	for (const legacyRef of [
		'agentNotificationAckRequestIdRef',
		'handledAgentAlertRouteRef',
		'acknowledgeVisibleAgentNotificationRef',
		'isFocusedRef',
		'isAppActiveRef',
		'visibleConnectionIdRef',
		'visibleChannelIdRef',
		'visibleTmuxTargetRef',
	]) {
		assert.doesNotMatch(source, new RegExp(legacyRef));
	}
});
```

Include `assert`, `readFileSync`, `join`, and `test` imports in the file.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-activity-notifications-composition.test.ts
```

Expected: FAIL because the hooks are not composed and legacy refs remain.

- [ ] **Step 3: Replace lifecycle/notification refs and effects**

Call `useShellActivityController()` once near route parsing. Pass its handle to
`useShellNotificationsController` with the current source keys, stored
connection ID, channel ID, tmux enabled/target, route params, Workmux command
port, and logger.

Remove the route effect, visible acknowledgement callback/effects, pending
subscription effect, notification refs, `useIsFocused`, and the direct AppState
subscription. For domains not extracted in this PR, use one layout effect keyed
by `activity.snapshot.generation` to invoke their existing invalidation and
resume behavior. Read current activity with `activity.getSnapshot()` inside
callbacks. This effect must not own another AppState listener and must not
contain notification logic.

- [ ] **Step 4: Run focused verification**

```bash
cd apps/mobile && pnpm exec prettier --write \
  src/lib/shell-controllers/activity-core.ts \
  src/lib/shell-controllers/activity.tsx \
  src/lib/shell-controllers/notifications-core.ts \
  src/lib/shell-controllers/notifications.tsx \
  src/app/shell/detail.tsx \
  test/integration/shell-activity-controller.test.ts \
  test/integration/shell-notifications-controller.test.ts \
  test/integration/shell-activity-notifications-composition.test.ts && \
pnpm exec tsx --test \
  test/integration/shell-activity-controller.test.ts \
  test/integration/shell-notifications-controller.test.ts \
  test/integration/shell-activity-notifications-composition.test.ts \
  test/integration/agent-notification-visibility.test.ts \
  test/integration/agent-notification-route.test.ts \
  test/integration/agent-notification-route-store.test.ts \
  test/integration/shell-scrollback-policy.test.ts \
  test/integration/keyboard-actions.test.ts && \
pnpm run lint:check && pnpm run typecheck
```

Expected: all tests PASS and formatting/lint/typecheck exit zero.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/app/shell/detail.tsx \
  apps/mobile/src/lib/shell-controllers/activity-core.ts \
  apps/mobile/src/lib/shell-controllers/activity.tsx \
  apps/mobile/src/lib/shell-controllers/notifications-core.ts \
  apps/mobile/src/lib/shell-controllers/notifications.tsx \
  apps/mobile/src/lib/agent-notification-visibility.ts \
  apps/mobile/test/integration/agent-notification-visibility.test.ts \
  apps/mobile/test/integration/shell-activity-notifications-composition.test.ts
git commit -m "refactor(mobile): compose shell activity and notifications"
```

## PR 2 Completion Check

- [ ] `detail.tsx` has no direct notification request/route refs or AppState
      subscription.
- [ ] Exactly one focus/AppState source publishes the shared activity snapshot.
- [ ] Notification coalescing is per controller instance, not module-global.
- [ ] Route token restore and stale acknowledgement suppression pass.
- [ ] Existing keyboard and scrollback inactivity behavior remains passing
      through the shared activity adapter.
