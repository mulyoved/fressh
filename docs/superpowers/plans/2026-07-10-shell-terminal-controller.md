# Shell Terminal Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ordered shell transport, WebView runtime identity, shell listener
ownership, readiness, resize, fit waiters, and terminal cleanup out of
`detail.tsx` behind narrow terminal ports.

**Architecture:** Split terminal responsibilities into three focused
cores—ordered transport, size/fit lifecycle, and WebView/listener
lifecycle—composed by one thin `useShellTerminalController` hook. The hook
publishes a render handle plus stable transport and view ports; scrollback
continues using its current screen code in this PR but is rewired to those ports
so PR 4 can extract it without reaching into terminal refs.

**Tech Stack:** TypeScript 5.9, React 19, Expo Router, React Native,
`@fressh/react-native-uniffi-russh`, `@fressh/react-native-xtermjs-webview`,
Node `tsx --test`, pnpm.

## Global Constraints

- Start from the merged activity/notifications PR.
- Preserve first attach (`readBuffer({ mode: 'head' })`) versus subsequent live
  attach behavior.
- Listener removal must use the recorded listener owner, even after the current
  shell changes.
- A tmux target change must not rebuild the shell listener; transport identity
  is connection ID plus channel ID only.
- A WebView reload must invalidate runtime-scoped work without pretending the
  SSH connection changed.
- Keep one `OrderedWriter` per current shell transport and prevent stale leases
  from writing.
- Preserve send failure logging and `router.back()` behavior.
- Preserve the 100 ms PTY resize debounce and 250 ms post-fit size wait.
- Keep system-keyboard and selection-mode user intent in screen/keyboard code
  for this PR; terminal exposes only view commands.
- Do not move scrollback state or handlers in this PR.

---

## File Structure

**Create:**

- `apps/mobile/src/lib/shell-controllers/terminal-transport.ts` — writer
  ownership, leases, and shell sends.
- `apps/mobile/src/lib/shell-controllers/terminal-size-core.ts` — resize
  debounce, latest size, and fit waiters.
- `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts` — xterm
  runtime/readiness and listener attach/detach.
- `apps/mobile/src/lib/shell-controllers/terminal.tsx` — React hook and public
  ports.
- `apps/mobile/test/integration/shell-terminal-transport.test.ts`
- `apps/mobile/test/integration/shell-terminal-size-controller.test.ts`
- `apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts`
- `apps/mobile/test/integration/shell-terminal-controller-composition.test.ts`

**Modify:**

- `apps/mobile/src/lib/terminal-shell-listener.ts` — export minimal listener
  owner/ref types if the lifecycle core reuses them.
- `apps/mobile/src/app/shell/detail.tsx` — consume terminal handle/ports and
  remove terminal refs/effects.
- `apps/mobile/test/integration/terminal-shell-listener.test.ts`
- `apps/mobile/test/integration/terminal-fit-runner.test.ts`
- `apps/mobile/test/integration/ordered-writer.test.ts`

## Published Interfaces

PR 4 and PR 5 consume these exact port names:

```ts
export type TerminalRuntimeKey = string & {
	readonly __terminalRuntimeKey: true;
};

export type TerminalInputLease = {
	runtimeKey: TerminalRuntimeKey;
	writerGeneration: number;
};

export type ShellTerminalTransportPort = {
	captureLease(): TerminalInputLease | null;
	isLeaseCurrent(lease: TerminalInputLease): boolean;
	sendBatch(
		lease: TerminalInputLease,
		segments: readonly Uint8Array<ArrayBufferLike>[],
		options?: { interSegmentDelayMs?: number; isCurrent?: () => boolean },
	): Promise<void>;
};

export type ShellTerminalTransportController = ShellTerminalTransportPort & {
	setShell(
		transportKey: ShellTransportKey,
		send: (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>,
	): void;
	clearShell(): void;
	setRuntimeInstance(instanceId: string): void;
	clearRuntime(): void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export type TerminalSizeState = {
	lastSize: TerminalFitSize | null;
};

export type TerminalSizeController = ControllerCore<TerminalSizeState> & {
	handleResize(cols: number, rows: number): void;
	waitForSizeAfterFit(): Promise<TerminalFitSize | null>;
};

export type ShellTerminalViewPort = {
	getRuntimeKey(): TerminalRuntimeKey | null;
	getRuntimeInstanceId(): string | null;
	isCurrentInstance(instanceId: string): boolean;
	fit(): void;
	setSystemKeyboardEnabled(enabled: boolean): void;
	setSelectionModeEnabled(enabled: boolean): void;
	getSelection(): Promise<string>;
	exitScrollback(message: { requestId: number; instanceId?: string }): void;
	sendScrollbackEnterAck(requestId: number, instanceId: string): void;
};

export type ShellTerminalControllerHandle = {
	xtermRef: RefObject<XtermWebViewHandle | null>;
	ready: boolean;
	hasRendered: boolean;
	runtimeKey: TerminalRuntimeKey | null;
	lastSize: TerminalFitSize | null;
	transport: ShellTerminalTransportPort;
	view: ShellTerminalViewPort;
	onLoadStart(): void;
	onInitialized(instanceId: string): void;
	onResize(cols: number, rows: number): void;
	waitForSizeAfterFit(): Promise<TerminalFitSize | null>;
	retry(): void;
};
```

---

### Task 1: Ordered Terminal Transport and Runtime Leases

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/terminal-transport.ts`
- Test: `apps/mobile/test/integration/shell-terminal-transport.test.ts`
- Modify: `apps/mobile/test/integration/ordered-writer.test.ts`

**Interfaces:**

- Consumes: `OrderedWriter`, `ControllerInvalidationReason`,
  `ShellTransportKey`, and `TerminalRuntimeKey` type declared in this file.
- Produces: `createShellTerminalTransport`, `ShellTerminalTransportController`,
  `ShellTerminalTransportPort`, and `TerminalInputLease`.

- [ ] **Step 1: Write failing lease and writer-replacement tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTerminalTransport } from '../../src/lib/shell-controllers/terminal-transport';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';

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
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-transport.test.ts
```

Expected: FAIL because `terminal-transport.ts` does not exist.

- [ ] **Step 3: Implement transport ownership**

Define `TerminalRuntimeKey` as
`JSON.stringify([transportKey, instanceId]) as TerminalRuntimeKey`. The
controller holds the current transport key, runtime key, writer generation, and
`OrderedWriter | null`. `setShell(key, send)` replaces the writer only when the
transport key or send function changes and increments generation before
replacement. `setRuntimeInstance` increments generation before changing the
runtime key. `clearRuntime`, `invalidate`, and `dispose` increment generation.

`sendBatch` calls the writer with an `isCurrent` predicate that combines
`isLeaseCurrent(lease)` and `options.isCurrent?.() !== false`. If the write
throws while the lease remains current, call injected `onSendFailure(error)` and
rethrow; stale failures do not navigate or show feedback.

- [ ] **Step 4: Run transport and writer tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-terminal-transport.test.ts \
  test/integration/ordered-writer.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/terminal-transport.ts apps/mobile/test/integration/shell-terminal-transport.test.ts apps/mobile/test/integration/ordered-writer.test.ts
git commit -m "refactor(mobile): isolate ordered terminal transport"
```

---

### Task 2: Terminal Size, Resize, and Fit Waiters

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/terminal-size-core.ts`
- Test: `apps/mobile/test/integration/shell-terminal-size-controller.test.ts`

**Interfaces:**

- Consumes: `ControllerCore`, `createControllerPublisher`, and `TerminalFitSize`
  from `terminal-fit-runner.ts`.
- Produces: `createTerminalSizeController`, `TerminalSizeController`,
  `handleResize`, `waitForSizeAfterFit`, and `dispose`.

- [ ] **Step 1: Write failing debounce/waiter/disposal tests**

```ts
void test('terminal size controller resolves fit waiters and debounces PTY resize', async () => {
	const clock = createFakeClock();
	const resized: string[] = [];
	const core = createTerminalSizeController({
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		resizePty: async (cols, rows) => resized.push(`${cols}x${rows}`),
		warn: () => {},
	});
	const waiting = core.waitForSizeAfterFit();
	core.handleResize(80, 24);
	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	core.handleResize(100, 30);
	clock.advanceBy(99);
	assert.deepEqual(resized, []);
	clock.advanceBy(1);
	await clock.settled();
	assert.deepEqual(resized, ['100x30']);
});

void test('terminal size disposal settles waiters and cancels resize', async () => {
	const clock = createFakeClock();
	const core = createTerminalSizeController(createSizeDeps(clock));
	core.handleResize(80, 24);
	const waiting = core.waitForSizeAfterFit();
	core.dispose();
	clock.advanceBy(100);
	assert.deepEqual(await waiting, { cols: 80, rows: 24 });
	assert.deepEqual(clock.pending(), []);
});
```

Define `createFakeClock` and `createSizeDeps` in the test file with
deterministic timeout IDs and a microtask `settled` helper.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-size-controller.test.ts
```

Expected: FAIL because the size controller is missing.

- [ ] **Step 3: Implement exact timing behavior**

The core stores `lastSize`, one resize timeout, and a set of fit waiters. A
resize publishes `lastSize`, resolves and removes every waiter, ignores an
unchanged size for PTY resize, clears the preceding debounce, and schedules
`resizePty(cols, rows)` at 100 ms. A fit waiter schedules a 250 ms fallback that
resolves with current `lastSize`. Disposal clears the resize timer and resolves
all remaining waiters with `lastSize` before clearing their fallback timers.
Catch `resizePty` failures and call `warn('resizePty failed', error)`.

- [ ] **Step 4: Run size and existing fit tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-terminal-size-controller.test.ts \
  test/integration/terminal-fit-runner.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/terminal-size-core.ts apps/mobile/test/integration/shell-terminal-size-controller.test.ts
git commit -m "refactor(mobile): isolate terminal size lifecycle"
```

---

### Task 3: WebView Runtime and Shell Listener Lifecycle

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/terminal.tsx`
- Create:
  `apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts`
- Modify: `apps/mobile/src/lib/terminal-shell-listener.ts`
- Modify: `apps/mobile/test/integration/terminal-shell-listener.test.ts`

**Interfaces:**

- Consumes: terminal transport from Task 1, size core from Task 2, and existing
  xterm/listener types.
- Produces: `useShellTerminalController`, `ShellTerminalControllerHandle`, and
  the transport/view ports published above.

- [ ] **Step 1: Write failing first/live attach and owner-detach tests**

```ts
void test('terminal lifecycle replays head buffer on first attach then uses live cursor', async () => {
	const harness = createTerminalLifecycleHarness();
	harness.core.setShell(harness.shellA);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	assert.deepEqual(harness.shellA.readModes, ['head']);
	assert.deepEqual(harness.shellA.listenerCursors, [{ mode: 'seq', seq: 9 }]);
	assert.deepEqual(harness.xterm.writes, [[1, 2]]);

	harness.core.detach();
	await harness.core.attach();
	assert.deepEqual(harness.shellA.listenerCursors[1], { mode: 'live' });
});

void test('terminal lifecycle removes listener from recorded owner after shell replacement', async () => {
	const harness = createTerminalLifecycleHarness();
	harness.core.setShell(harness.shellA);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();
	harness.core.setShell(harness.shellB);
	assert.deepEqual(harness.shellA.removedListenerIds, [1n]);
	assert.deepEqual(harness.shellB.removedListenerIds, []);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-lifecycle-controller.test.ts
```

Expected: FAIL because the lifecycle core is missing.

- [ ] **Step 3: Implement lifecycle core**

Move listener refs, readiness state, first-attach state, load-start,
initialization, attach, detach, output-write, and cleanup from `detail.tsx` into
the core. Inject `getXterm`, transport, size core, platform OS, logger, and
`onRuntimeChanged(runtimeKey)`. `handleInitialized` must clear old attachment,
set transport runtime, publish ready/has-rendered, and notify the runtime
callback. `handleLoadStart` invalidates transport runtime before detaching and
publishing `ready: false`.

During attach, apply current system-keyboard and selection-mode values to xterm.
On Android preserve the current initial system keyboard enable; on iOS call
`focus()` after listener attachment. Keep dropped-listener-event logging.

- [ ] **Step 4: Implement the React hook and ports**

`useShellTerminalController` owns `xtermRef`, creates the three cores once,
updates shell/transport and view-mode dependencies in layout effects, calls
`attach()` whenever ready/shell changes, and disposes on unmount. Bind send
failure to current `logger.warn('sendData failed', error)` plus `router.back()`.
Bind `retry` to `router.back()`.

Implement every method in `ShellTerminalViewPort` as a guarded call to
`xtermRef.current`. Its `getRuntimeKey` delegates to the lifecycle core. Return
the exact handle shape in Published Interfaces.

- [ ] **Step 5: Run lifecycle/listener tests and typecheck**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/terminal-shell-listener.test.ts \
  test/integration/shell-terminal-transport.test.ts \
  test/integration/shell-terminal-size-controller.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts apps/mobile/src/lib/shell-controllers/terminal.tsx apps/mobile/src/lib/terminal-shell-listener.ts apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts apps/mobile/test/integration/terminal-shell-listener.test.ts
git commit -m "refactor(mobile): isolate terminal runtime lifecycle"
```

---

### Task 4: Compose the Terminal Controller in `detail.tsx`

**Files:**

- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Create:
  `apps/mobile/test/integration/shell-terminal-controller-composition.test.ts`

**Interfaces:**

- Consumes: `useShellTerminalController` and ports from Tasks 1-3.
- Produces: the terminal ports consumed by PR 4 scrollback and PR 5 keyboard.

- [ ] **Step 1: Write the failing composition guard**

```ts
void test('shell detail delegates terminal refs and lifecycle', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.match(source, /useShellTerminalController\(\{/);
	assert.match(source, /ref=\{terminal\.xtermRef\}/);
	for (const legacy of [
		'listenerIdRef',
		'listenerOwnerRef',
		'attachedShellKeyRef',
		'hasAttachedOnceRef',
		'resizeTimeoutRef',
		'lastSizeRef',
		'terminalFitSizeWaitersRef',
		'writerRef',
	]) {
		assert.doesNotMatch(source, new RegExp(legacy));
	}
});
```

Add standard Node assert/fs/path/test imports.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-controller-composition.test.ts
```

Expected: FAIL because terminal state and refs remain inline.

- [ ] **Step 3: Replace inline terminal lifecycle with the hook**

Construct the terminal hook after shell/connection are available. Pass shell,
transport key, platform, current system-keyboard/selection-mode values, logger,
router, and an `onRuntimeChanged` callback that invokes the current inline
scrollback reset. Replace JSX callbacks with `terminal.onLoadStart`,
`terminal.onResize`, and `terminal.onInitialized`; replace the xterm ref and
terminal crash retry. Use `terminal.lastSize`, `terminal.view.fit()`, and
`terminal.waitForSizeAfterFit()` in the manual fit runner.

Adapt the existing inline scrollback live-input function to capture a terminal
lease and call `terminal.transport.sendBatch`. Remove ordered-writer creation,
send-to-shell, listener, readiness, initialization, resize, fit-waiter, and
terminal cleanup refs/effects. Keep `resumeDismissTimeoutRef` because it belongs
to keyboard activity behavior and moves in PR 5.

- [ ] **Step 4: Run terminal, scrollback, and shell composition suites**

```bash
cd apps/mobile && pnpm exec prettier --write \
  src/lib/shell-controllers/terminal-transport.ts \
  src/lib/shell-controllers/terminal-size-core.ts \
  src/lib/shell-controllers/terminal-lifecycle-core.ts \
  src/lib/shell-controllers/terminal.tsx \
  src/app/shell/detail.tsx \
  test/integration/shell-terminal-*.test.ts && \
pnpm exec tsx --test \
  test/integration/shell-terminal-transport.test.ts \
  test/integration/shell-terminal-size-controller.test.ts \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/shell-terminal-controller-composition.test.ts \
  test/integration/terminal-shell-listener.test.ts \
  test/integration/terminal-fit-runner.test.ts \
  test/integration/ordered-writer.test.ts \
  test/integration/tmux-scrollback-cleanup.test.ts \
  test/integration/workmux-scrollback-live-input.test.ts && \
pnpm run lint:check && pnpm run typecheck
```

Expected: all tests PASS and formatting/lint/typecheck exit zero.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/app/shell/detail.tsx \
  apps/mobile/test/integration/shell-terminal-controller-composition.test.ts
git commit -m "refactor(mobile): compose shell terminal controller"
```

## PR 3 Completion Check

- [ ] Terminal attach/detach, runtime, writer, resize, and fit waiters have one
      owner.
- [ ] Target changes leave the current shell listener intact.
- [ ] WebView reload invalidates stale transport leases and size waiters.
- [ ] Scrollback sends only through `terminal.transport` and uses no writer ref.
- [ ] `detail.tsx` contains no listener owner/ID, writer, resize timer, or
      terminal runtime ref.
