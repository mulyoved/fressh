# Shell Scrollback Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put scrollback entry, local/remote state, batching, cleanup barriers,
live-input sequencing, runtime reset, and disposal behind one controller.

**Architecture:** Build one scrollback core around the existing executor, batch
accumulator, event adapters, local-exit tracker, and live-input helpers. The
core consumes terminal transport/view ports and shared activity, publishes a
small snapshot plus xterm event commands, and is adapted to React by
`useShellScrollbackController`; no scrollback refs remain in `detail.tsx`.

**Tech Stack:** TypeScript 5.9, React 19, Workmux control channel, xterm WebView
scrollback events, Node `tsx --test`, pnpm.

## Global Constraints

- Start from the merged terminal-controller PR and use its published ports;
  never access xterm or an ordered writer directly.
- Preserve remote copy-mode acknowledgement, rollback, typed enter/move/exit
  commands, and trace events.
- Preserve bounded local-exit request IDs and bounded batch coalescing.
- Every user-input payload must wait for the current scrollback cleanup barrier.
- Live input fails closed if app-owned remote copy mode cannot be exited safely.
- Source, runtime, focus, AppState, and disposal invalidation must suppress late
  acknowledgements and failures.
- Inactive cleanup uses failure policy `suppress`; current focused failures keep
  existing alert/copy behavior.
- Keep selection-mode ownership outside scrollback and read it through an
  injected getter.
- Do not move keyboard intent or payload construction in this PR.

---

## File Structure

**Create:**

- `apps/mobile/src/lib/shell-controllers/scrollback-policy.ts` — move
  shell-specific failure/inactivity policy to the controller package.
- `apps/mobile/src/lib/shell-controllers/scrollback-core.ts` — complete
  runtime/state/command controller.
- `apps/mobile/src/lib/shell-controllers/scrollback.tsx` — React hook and
  xterm/input props.
- `apps/mobile/test/integration/shell-scrollback-controller.test.ts`
- `apps/mobile/test/integration/shell-scrollback-controller-composition.test.ts`

**Modify:**

- `apps/mobile/src/app/shell/detail.tsx` — consume scrollback handle and input
  port.
- `apps/mobile/test/integration/shell-scrollback-policy.test.ts` — import moved
  policy.
- `apps/mobile/test/integration/tmux-scrollback-cleanup.test.ts` — add
  controller-level runtime/reset cases only if not covered in the new test.

**Delete:**

- `apps/mobile/src/app/shell/shell-scrollback-policy.ts`

## Published Interfaces

PR 5 consumes this exact input port and handle:

```ts
export type ShellScrollbackState = {
	active: boolean;
	phase: 'dragging' | 'active';
	runtimeInstanceId: string | null;
};

export type ShellLiveInputOptions = {
	interSegmentDelayMs?: number;
	onAccepted?: () => void;
};

export type ShellScrollbackInputPort = {
	sendSegments(
		segments: readonly Uint8Array<ArrayBuffer>[],
		options?: ShellLiveInputOptions,
	): Promise<ControllerOutcome<{ message: string }>>;
};

export type ShellScrollbackControllerHandle = {
	state: ShellScrollbackState;
	visible: boolean;
	input: ShellScrollbackInputPort;
	clear(options?: {
		failurePolicy?: 'notify' | 'suppress';
	}): Promise<boolean> | null;
	jumpToLive(): void;
	onTerminalRuntimeChanged(instanceId: string | null): void;
	xtermProps: {
		onScrollbackModeChange(event: ScrollbackModeChangeEvent): void;
		onScrollbackEnterRequested(
			event: ScrollbackEnterRequestedEvent,
		): Promise<void>;
		onScrollbackBatch(event: ScrollbackBatchEvent): void;
	};
	invalidate(reason: ControllerInvalidationReason): void;
};

export type ShellScrollbackControllerCore =
	ControllerCore<ShellScrollbackState> & {
		setContext(context: ShellScrollbackContext): void;
		onTerminalRuntimeChanged(instanceId: string | null): void;
		onScrollbackModeChange(event: ScrollbackModeChangeEvent): void;
		onScrollbackEnterRequested(
			event: ScrollbackEnterRequestedEvent,
		): Promise<void>;
		onScrollbackBatch(event: ScrollbackBatchEvent): void;
		sendSegments(
			segments: readonly Uint8Array<ArrayBuffer>[],
			options?: ShellLiveInputOptions,
		): Promise<ControllerOutcome<{ message: string }>>;
		clear(options?: {
			failurePolicy?: 'notify' | 'suppress';
		}): Promise<boolean> | null;
		jumpToLive(): void;
	};
```

Define the three event types in `scrollback-core.ts` with the exact fields
currently accepted by `detail.tsx`, including instance IDs, optional request
IDs, page step, sequence, and timestamp. Define `ShellScrollbackContext` with
the target/source identity, connection/shell/tmux availability, activity and
selection getters, terminal ports, Workmux command port, trace, feedback, and
logger dependencies listed in Task 1.

---

### Task 1: Move Policy and Establish Controller State/Runtime Reset

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/scrollback-policy.ts`
- Create: `apps/mobile/src/lib/shell-controllers/scrollback-core.ts`
- Create: `apps/mobile/test/integration/shell-scrollback-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-scrollback-policy.test.ts`
- Delete: `apps/mobile/src/app/shell/shell-scrollback-policy.ts`

**Interfaces:**

- Consumes: shared controller types, terminal view/transport ports, activity
  handle, and existing scrollback helper factories.
- Produces: `createShellScrollbackControllerCore`,
  `ShellScrollbackControllerCore`, state/event types, `setContext`, and
  `onTerminalRuntimeChanged`.

- [ ] **Step 1: Move policy imports and write failing runtime-reset tests**

Update `shell-scrollback-policy.test.ts` to import from
`../../src/lib/shell-controllers/scrollback-policy`. Add this controller test:

```ts
void test('scrollback runtime replacement clears local and remote state', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	harness.remoteCopyModeActive.current = true;
	harness.core.onTerminalRuntimeChanged('instance-2');
	assert.deepEqual(harness.core.getSnapshot(), {
		active: false,
		phase: 'active',
		runtimeInstanceId: 'instance-2',
	});
	assert.equal(harness.remoteCopyModeActive.current, false);
	assert.equal(harness.lineAccumulator.lines, 0);
});

void test('scrollback ignores mode events from a stale terminal instance', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-2');
	harness.core.onScrollbackModeChange({
		active: true,
		phase: 'active',
		instanceId: 'instance-1',
	});
	assert.equal(harness.core.getSnapshot().active, false);
});
```

The harness injects fake terminal ports, activity, executor factory,
accumulator, cleanup barrier, trace, alert, clipboard, and logger. Expose
internal test fixtures through the harness dependencies, not production core
properties.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-scrollback-policy.test.ts \
  test/integration/shell-scrollback-controller.test.ts
```

Expected: FAIL because the moved policy/core paths do not exist.

- [ ] **Step 3: Move policy verbatim and implement core construction**

Move all exports from `app/shell/shell-scrollback-policy.ts` to the new policy
file, adjusting its relative Workmux import. Delete the old file.

Create the core with one publisher snapshot, enter/live-input generations,
remote copy-mode ref/generation, bounded local-exit set and next ID, batch
accumulator, cleanup barrier, executor, and trace ID state. `setContext` accepts
`ShellTargetKey`, target name, connection/shell availability, tmux enabled,
activity getter, selection-mode getter, terminal ports, and Workmux command
port. A target change increments generations and disposes the preceding executor
before creating its replacement.

`onTerminalRuntimeChanged` increments enter/live-input generations before
clearing local state, local-exit IDs, accumulator, remote state, and the old
executor queue. It publishes the new instance ID only after cleanup begins.

- [ ] **Step 4: Run policy/controller tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-scrollback-policy.test.ts \
  test/integration/shell-scrollback-controller.test.ts \
  test/integration/tmux-scrollback-batch.test.ts \
  test/integration/tmux-scrollback-executor.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/scrollback-policy.ts apps/mobile/src/lib/shell-controllers/scrollback-core.ts apps/mobile/test/integration/shell-scrollback-controller.test.ts apps/mobile/test/integration/shell-scrollback-policy.test.ts
git rm apps/mobile/src/app/shell/shell-scrollback-policy.ts
git commit -m "refactor(mobile): establish scrollback controller runtime"
```

---

### Task 2: Entry, Mode Change, Batching, and Failure Ownership

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/scrollback-core.ts`
- Modify: `apps/mobile/test/integration/shell-scrollback-controller.test.ts`

**Interfaces:**

- Consumes: core/context from Task 1 and existing
  `handleTmuxScrollbackEnterRequested`, `handleTmuxScrollbackBatchEvent`,
  executor, and local-exit helpers.
- Produces: the three xterm event commands published above plus `clear` and
  `jumpToLive`.

- [ ] **Step 1: Add failing current/stale entry and local-exit tests**

```ts
void test('scrollback acknowledges only a current successful enter', async () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	await harness.core.onScrollbackEnterRequested({
		instanceId: 'instance-1',
		requestId: 7,
	});
	assert.deepEqual(harness.enterCommands, ['main']);
	assert.deepEqual(harness.enterAcks, [
		{ requestId: 7, instanceId: 'instance-1' },
	]);
});

void test('scrollback focus invalidation rolls back an in-flight enter without ack', async () => {
	const harness = createScrollbackHarness({ deferredEnter: true });
	harness.core.onTerminalRuntimeChanged('instance-1');
	const pending = harness.core.onScrollbackEnterRequested({
		instanceId: 'instance-1',
		requestId: 7,
	});
	harness.activity.setFocused(false);
	harness.core.invalidate('focus-lost');
	harness.resolveEnter(true);
	await pending;
	assert.deepEqual(harness.enterAcks, []);
	assert.equal(harness.exitCommands.length, 1);
});

void test('scrollback local exit request does not trigger a second remote reset', () => {
	const harness = createScrollbackHarness();
	harness.core.onTerminalRuntimeChanged('instance-1');
	harness.core.jumpToLive();
	const request = harness.localExitMessages[0];
	harness.core.onScrollbackModeChange({
		active: false,
		phase: 'active',
		instanceId: 'instance-1',
		requestId: request?.requestId,
	});
	assert.equal(harness.resetCalls, 1);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-scrollback-controller.test.ts
```

Expected: new tests FAIL until event commands are implemented.

- [ ] **Step 3: Move event orchestration into the core**

Move `clearLocalScrollbackUiState`, `clearScrollbackState`, trace creation,
failure handling, executor construction/disposal, `handleScrollbackModeChange`,
`handleScrollbackEnterRequested`, and `handleScrollbackBatch` from `detail.tsx`.
Keep existing helper calls and trace event names. Build local exit messages with
the current runtime instance and call `terminal.view.exitScrollback`.

Focused/current command failures retain the existing alert with Copy Message;
inactive/superseded failures log and suppress alerts. A Workmux scroll
not-in-mode response clears remote/local state without a recursive exit.

- [ ] **Step 4: Run controller and all event/executor suites**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-scrollback-controller.test.ts \
  test/integration/shell-scrollback-policy.test.ts \
  test/integration/tmux-scrollback-events.test.ts \
  test/integration/tmux-scrollback-cleanup.test.ts \
  test/integration/tmux-scrollback-executor.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/scrollback-core.ts apps/mobile/test/integration/shell-scrollback-controller.test.ts
git commit -m "refactor(mobile): move scrollback event orchestration"
```

---

### Task 3: Guarded Live Input, Activity Cleanup, and Hook

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/scrollback-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/scrollback.tsx`
- Modify: `apps/mobile/test/integration/shell-scrollback-controller.test.ts`

**Interfaces:**

- Consumes: terminal lease transport, activity, and core from Tasks 1-2.
- Produces: `ShellScrollbackInputPort`, `ShellScrollbackControllerHandle`, and
  `useShellScrollbackController`.

- [ ] **Step 1: Add failing cleanup barrier and stale-lease tests**

```ts
void test('scrollback live input waits for cleanup before terminal send', async () => {
	const harness = createScrollbackHarness({ remoteCopyModeActive: true });
	const pending = harness.core.sendSegments([new Uint8Array([0x61])]);
	assert.deepEqual(harness.sentSegments, []);
	harness.resolveCleanup(true);
	assert.deepEqual(await pending, { status: 'completed' });
	assert.deepEqual(harness.sentSegments, [[0x61]]);
});

void test('scrollback live input fails closed after unsuccessful cleanup', async () => {
	const harness = createScrollbackHarness({ remoteCopyModeActive: true });
	const pending = harness.core.sendSegments([new Uint8Array([0x61])]);
	harness.resolveCleanup(false);
	assert.deepEqual(await pending, { status: 'unavailable' });
	assert.deepEqual(harness.sentSegments, []);
});

void test('scrollback live input suppresses payload after terminal runtime replacement', async () => {
	const harness = createScrollbackHarness({ remoteCopyModeActive: true });
	const pending = harness.core.sendSegments([new Uint8Array([0x61])]);
	harness.terminal.replaceRuntime('instance-2');
	harness.resolveCleanup(true);
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.sentSegments, []);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-scrollback-controller.test.ts
```

Expected: live-input tests FAIL until the input port is implemented.

- [ ] **Step 3: Implement the live-input command and lifecycle**

Move the current `sendLiveInputSegments` orchestration into `sendSegments`.
Capture terminal lease, runtime instance, live-input generation, activity
generation, and current cleanup before awaiting. Reuse
`buildWorkmuxScrollbackLiveInputSendPlan` and
`runWorkmuxScrollbackLiveInputSendPlan`; forward via
`terminal.transport.sendBatch(lease, segments, options)`. Return `completed`
only when `onAccepted` runs, `superseded` when any captured identity is stale,
and `unavailable` when current cleanup fails or no lease exists. A current
terminal send exception returns
`{ status: 'failed', failure: { message: getErrorMessage(error) } }`; the same
exception after invalidation returns `superseded`.

On transition from interactive to inactive, call
`clear({ failurePolicy: 'suppress' })` and invalidate enter/live-input
generations before waiting. `dispose` starts remote rollback, clears all local
state, disposes the executor, and does not show active-screen alerts.

- [ ] **Step 4: Implement the React hook**

The hook creates the core, uses `useSyncExternalStore`, updates target and
availability context in layout effects, forwards terminal runtime changes,
reacts to activity generation, and disposes on unmount. Return one memoized
`input` object and one memoized `xtermProps` object with the published method
names. `jumpToLive` fires `clear()` without awaiting and logs rejected cleanup.

- [ ] **Step 5: Run controller and live-input suites**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-scrollback-controller.test.ts \
  test/integration/workmux-scrollback-live-input.test.ts \
  test/integration/tmux-scrollback-cleanup.test.ts \
  test/integration/tmux-scrollback-executor.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/scrollback-core.ts apps/mobile/src/lib/shell-controllers/scrollback.tsx apps/mobile/test/integration/shell-scrollback-controller.test.ts
git commit -m "refactor(mobile): add guarded scrollback input controller"
```

---

### Task 4: Compose Scrollback and Remove Inline Ownership

**Files:**

- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Create:
  `apps/mobile/test/integration/shell-scrollback-controller-composition.test.ts`

**Interfaces:**

- Consumes: `useShellScrollbackController` and terminal/activity ports.
- Produces: `scrollback.input`, used as the only user-input transport by PR 5.

- [ ] **Step 1: Write the failing composition guard**

```ts
void test('shell detail delegates all scrollback workflow ownership', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.match(source, /useShellScrollbackController\(\{/);
	assert.match(source, /\.\.\.scrollback\.xtermProps/);
	for (const legacy of [
		'scrollbackActiveRef',
		'scrollbackPhaseRef',
		'scrollbackEnterRequestGenerationRef',
		'localScrollbackExitRequestIdsRef',
		'scrollbackCleanupBarrierRef',
		'tmuxRemoteScrollbackCopyModeActiveRef',
		'tmuxScrollbackLineAccumulatorRef',
		'workmuxScrollbackCommandExecutorRef',
	]) {
		assert.doesNotMatch(source, new RegExp(legacy));
	}
});
```

Add standard Node imports.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-scrollback-controller-composition.test.ts
```

Expected: FAIL because scrollback workflow remains inline.

- [ ] **Step 3: Replace inline scrollback code and wire all input callers**

Construct `useShellScrollbackController` from terminal/activity ports,
target/source identity, connection/shell/tmux availability, selection-mode
getter, Workmux control channel, trace, Alert, Clipboard, and logger. Pass
`scrollback.xtermProps` to `XtermJsWebView`, render the jump-to-live button from
`scrollback.visible`, and call `scrollback.onTerminalRuntimeChanged` from the
terminal runtime callback.

Replace `sendBytesRaw`, `sendLiteralInputSegments`, and WebView input sends with
small adapters over `scrollback.input.sendSegments`; keep payload construction
and modifier/selection behavior inline until PR 5. Remove every scrollback
state/ref/effect/callback/executor from `detail.tsx` and remove now-unused
scrollback imports.

- [ ] **Step 4: Run full scrollback-focused verification**

```bash
cd apps/mobile && pnpm exec prettier --write \
  src/lib/shell-controllers/scrollback-policy.ts \
  src/lib/shell-controllers/scrollback-core.ts \
  src/lib/shell-controllers/scrollback.tsx \
  src/app/shell/detail.tsx \
  test/integration/shell-scrollback-*.test.ts && \
pnpm exec tsx --test \
  test/integration/shell-scrollback-controller.test.ts \
  test/integration/shell-scrollback-controller-composition.test.ts \
  test/integration/shell-scrollback-policy.test.ts \
  test/integration/tmux-scrollback-batch.test.ts \
  test/integration/tmux-scrollback-cleanup.test.ts \
  test/integration/tmux-scrollback-events.test.ts \
  test/integration/tmux-scrollback-executor.test.ts \
  test/integration/workmux-scrollback-live-input.test.ts \
  test/integration/shell-terminal-controller-composition.test.ts \
  test/integration/terminal-input-payloads.test.ts && \
pnpm run lint:check && pnpm run typecheck
```

Expected: all tests PASS and formatting/lint/typecheck exit zero.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/app/shell/detail.tsx \
  apps/mobile/test/integration/shell-scrollback-controller-composition.test.ts
git commit -m "refactor(mobile): compose shell scrollback controller"
```

## PR 4 Completion Check

- [ ] `detail.tsx` contains no scrollback state/ref/generation/executor
      ownership.
- [ ] Every user-originated shell send currently in the screen routes through
      `scrollback.input`.
- [ ] Enter acknowledgement, stale instance filtering, batching, rollback, and
      failure policies pass.
- [ ] Focus/AppState/source/runtime/disposal invalidation suppresses late work.
- [ ] Failed cleanup blocks payload transmission.
