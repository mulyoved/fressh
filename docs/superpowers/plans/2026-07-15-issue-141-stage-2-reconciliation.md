# Issue 141 Stage 2 Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct the completed ShellDetail and Wispr ownership work on a
fresh branch from current `dev`, preserving all newer accepted shell behavior
and producing reviewable test-first evidence for issue 141 Stage 2.

**Architecture:** Treat `source-quality-stage-2` as immutable reference
evidence, not as branch history to preserve. Rebuild the final behavior in
vertical slices: route/session, typed ports, Wispr, rendering, native authority,
and Worktree Workspace adaptation; current `dev` wins every public-contract or
behavior conflict.

**Tech Stack:** TypeScript 5.9, React 19, Expo 54, React Native 0.81, Zustand,
Node `tsx --test`, Jest with `jest-expo`, React Native Testing Library,
pnpm/Turbo, Prettier, ESLint, EAS local Android preview.

## Global Constraints

- At execution time, invoke `superpowers:using-git-worktrees` and create a fresh
  branch named `source-quality-stage-2-reconciled` from the latest accepted
  `dev`; do not execute on the old `source-quality-stage-2` branch.
- Keep `source-quality-stage-2` unchanged until the replacement Stage 2 pull
  request is accepted.
- Before production edits, confirm current `origin/dev` contains this plan and
  record its commit plus `source-quality-stage-2` commit `0d54b653` in the
  evidence file. If `origin/dev` has advanced, refresh filenames and contracts
  in this plan before continuing.
- Start every behavior change with a failing test and record the exact RED and
  GREEN command/output summaries in
  `docs/run/issue-141-stage-2-reconciliation-evidence.md`.
- Current `dev` is authoritative for Expo/Jest configuration, component-test
  layout, terminal-listener ownership, output diagnostics, Worktree Workspace,
  the advanced mdev submenu, secure storage, and public contracts.
- Do not change `apps/mobile/jest.config.cjs`, Jest versions, Expo versions, the
  mdev menu hierarchy, `apps/mobile/config/shell-config.json`, secure-storage
  formats, generated bindings, or Android signing.
- Preserve current shell, terminal, scrollback, keyboard, Workmux,
  notifications, modal, Worktree Workspace, and Wispr behavior except that an
  invalid shell route renders a recoverable Back screen.
- The SSH store remains the only owner that creates or destroys live SSH
  connections and shells. Screen unmount must not disconnect them.
- The session owner creates, retires, and disposes every Workmux channel.
- Scrollback remains the only user-originated terminal-input gate.
- Wispr owns every native request, timer, request ID, deferred start, pending
  close, and native-control lease for the valid shell-screen session.
- Controllers communicate through typed generation-bound ports, never another
  controller's ref, a raw SSH connection, or a raw `WorkmuxControlChannel`.
- Do not add Redux, XState, an event bus, a barrel file, a combined
  `ShellRuntime`, compatibility wrappers, pass-through facades, or no-op
  dependencies.
- Do not preserve render-time assignments to mutable refs. React commit work
  belongs in layout/passive effects; controller state belongs in controller
  cores.
- `ShellDetail` may parse, construct controllers, wire narrow ports, select a
  view state, and render. It may not own workflow state, timers, queues,
  generations, cleanup order, native calls, SSH/Workmux calls, or diagnostic
  event construction.
- Keep `ShellDetail` below 300 physical lines and
  `apps/mobile/src/app/shell/detail.tsx` below 650 nonblank lines.
- Keep each new session or Wispr core/hook below 350 nonblank lines; split by
  owned protocol before reaching the limit.
- Do not start Stage 3 controller canonicalization or shared modal chrome. Keep
  the current Worktree Workspace public handle and custom modal.
- Never clear `com.finalapp.vibe2` data, run `test:e2e:clear-state`, publish an
  OTA update, use Metro as the normal workflow, or change signing lanes.
- Run the thermo-nuclear maintainability review after automated verification and
  resolve every blocker before opening the final pull request.

---

## File Structure

### Evidence

- Create: `docs/run/issue-141-stage-2-reconciliation-evidence.md`
  - Baselines, per-task RED/GREEN results, old-to-new commit mapping, full
    gates, maintainability review, preview evidence, and rollback confirmation.

### Route and rendering

- Create: `apps/mobile/src/app/shell/shell-route.ts`
- Create: `apps/mobile/src/app/shell/components/ShellRouteErrorScreen.tsx`
- Create: `apps/mobile/src/app/shell/ShellScreenOverlays.tsx`
- Create: `apps/mobile/src/app/shell/ShellScreenStates.tsx`
- Create: `apps/mobile/src/app/shell/ShellScreenView.tsx`
- Create: `apps/mobile/src/app/shell/use-manual-terminal-fit.ts`
- Create: `apps/mobile/src/app/shell/use-shell-route-ready.ts`
- Create: `apps/mobile/src/app/shell/use-shell-terminal-view-policy.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Delete: `apps/mobile/src/app/shell/shell-keyboard-composition.ts`

### Session ownership and ports

- Create: `apps/mobile/src/lib/shell-controllers/session-contracts.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-diagnostics.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-source.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-target-owner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-tmux-resolution.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-transport-owner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-workmux.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session.tsx`
- Create: `apps/mobile/src/lib/shell-controllers/terminal-contracts.ts`
- Modify: focused controller, adapter, lifecycle, terminal-fit, diagnostics, and
  action files listed in Tasks 3 and 5.

### Wispr ownership

- Create: `apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-core.ts`
- Create:
  `apps/mobile/src/lib/shell-controllers/wispr-native-control-authority.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-tap-runner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-timer-owner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr.tsx`
- Modify: `apps/mobile/src/lib/wispr-automation.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/simple-modals.tsx`

### Worktree Workspace adaptation

- Modify: `apps/mobile/src/lib/shell-controllers/worktree-workspace-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/worktree-workspace.tsx`
- Modify: `apps/mobile/src/app/shell/ShellScreenView.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify:
  `apps/mobile/test/integration/shell-worktree-workspace-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-detail-boundary.test.ts`
- Modify: `apps/mobile/test/components/worktree-workspace-modal.test.tsx`

### Test ownership

- Node behavior and architecture tests remain under
  `apps/mobile/test/integration/**/*.test.ts` and run with `tsx --test`.
- React render tests move to `apps/mobile/test/components/**/*.test.tsx` and run
  through the existing `jest-expo` configuration with
  `pnpm run test:components`.
- Do not introduce `.render.test.tsx` files under `test/integration`; that was
  the obsolete Stage 2 branch's separate Jest lane.

## Source-Commit Map

| Replacement task               | Immutable source evidence             |
| ------------------------------ | ------------------------------------- |
| Route boundary                 | `597a3b9c`, `f4ad565a`                |
| Session and Workmux            | `68e60f0f` through `52347f98`         |
| Typed controller ports         | `a7a291b7` through `a7da6ebc`         |
| Wispr controller               | `ad219e88` through `5dc97c87`         |
| Rendering and boundary cleanup | `8751a1d0` through `73c7a20a`         |
| Wispr native authority         | `f91c2090` through `0d54b653`         |
| Worktree Workspace adaptation  | New reconciliation work based on #139 |

### Task 1: Baseline Evidence and Typed Route Boundary

**Files:**

- Create: `docs/run/issue-141-stage-2-reconciliation-evidence.md`
- Create: `apps/mobile/src/app/shell/shell-route.ts`
- Create: `apps/mobile/src/app/shell/components/ShellRouteErrorScreen.tsx`
- Create: `apps/mobile/test/integration/shell-route.test.ts`
- Create: `apps/mobile/test/components/shell-route-error-screen.test.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

**Interfaces:**

- Consumes: Expo route string parameters and router Back.
- Produces: `parseShellRoute(params): ShellRouteResult`, `ShellRouteRequest`,
  `ShellRouteError`, and `ShellRouteErrorScreen`.

- [ ] **Step 1: Record immutable baselines**

Create the evidence file with the actual hashes substituted from the two
commands; the headings and table columns are fixed:

```bash
git rev-parse HEAD
git rev-parse source-quality-stage-2
```

```markdown
# Issue 141 Stage 2 Reconciliation Evidence

## Baselines

- Source branch expected final implementation: `0d54b653`

## Slice Evidence

| Task | RED command and failure | GREEN command and result | Source commits | Replacement commit |
| ---- | ----------------------- | ------------------------ | -------------- | ------------------ |

## Full Verification

## Thermo-Nuclear Review

## Android Preview

## Rollback
```

Use `apply_patch` immediately after creating the file to add `Replacement base:`
and `Immutable source:` bullets under `## Baselines`, copying the two literal
40-character hashes printed by the commands. Expected: the replacement base is a
descendant of the plan commit, the source hash is `0d54b653` or a descendant
containing it, and `git status --short` lists only the evidence file.

- [ ] **Step 2: Add the route tests before production files**

Use `apps/mobile/test/integration/shell-route.test.ts` from `f4ad565a` as the
behavior source. Create the component test in the current test lane with this
contract:

```tsx
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShellRouteErrorScreen } from '@/app/shell/components/ShellRouteErrorScreen';

jest.mock('@/lib/theme', () => {
	const actual = jest.requireActual('@/lib/theme') as {
		darkTheme: { colors: Record<string, string> };
	};
	return { ...actual, useTheme: jest.fn(() => actual.darkTheme) };
});

test('renders the typed route error and invokes Back once', () => {
	const onBack = jest.fn();
	render(
		<ShellRouteErrorScreen
			error={{
				code: 'invalid-channel-id',
				message: 'This shell link has an invalid channel.',
			}}
			onBack={onBack}
		/>,
	);
	fireEvent.press(screen.getByRole('button', { name: 'Back' }));
	expect(screen.getByText('Shell link unavailable')).toBeOnTheScreen();
	expect(onBack).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run route tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-route.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-route-error-screen.test.tsx
```

Expected: both commands FAIL because `shell-route.ts` and
`ShellRouteErrorScreen.tsx` do not exist. Record both failures in the Task 1
table row.

- [ ] **Step 4: Implement the typed route boundary**

Implement the exact public result shape from source commit `597a3b9c`:

```ts
export type ShellRouteResult =
	| { status: 'valid'; request: ShellRouteRequest }
	| { status: 'invalid'; error: ShellRouteError };

export type ShellRouteError = {
	code: 'missing-connection-id' | 'invalid-channel-id';
	message: string;
};

export function parseShellRoute(params: ShellRouteParams): ShellRouteResult;
```

Keep whitespace normalization, safe non-negative integer channel parsing,
optional agent fields, default tmux session `main`, and typed attach failure
exactly as asserted in the tests. Split `detail.tsx` into hook-free
`ShellDetailRoute` and valid-only `ShellDetail`; render `ShellRouteErrorScreen`
for the invalid result so hook order never depends on route validity.

- [ ] **Step 5: Run route tests and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-route.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-route-error-screen.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all four commands exit 0. Record source commits `597a3b9c, f4ad565a`
and the command summaries.

- [ ] **Step 6: Commit the route slice**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/app/shell/shell-route.ts apps/mobile/src/app/shell/components/ShellRouteErrorScreen.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-route.test.ts apps/mobile/test/components/shell-route-error-screen.test.tsx
git commit -m "Rebuild shell route boundary"
```

Write the new commit hash into the Task 1 evidence row.

### Task 2: Screen Session, Workmux, and Diagnostic Ownership

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/session-contracts.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-diagnostics.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-workmux.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session.tsx`
- Create: `apps/mobile/test/integration/shell-session-controller.test.ts`
- Create: `apps/mobile/test/integration/shell-session-workmux.test.ts`
- Create: `apps/mobile/test/components/shell-session-controller.test.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Delete:
  `apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts`

**Interfaces:**

- Consumes: `ShellRouteRequest`, connection/shell observation, tmux resolution,
  activity, router navigation, and the existing Workmux channel factory.
- Produces: `ShellSessionSnapshot`, `ShellSessionPorts`, `ShellSessionCore`,
  `ShellWorkmuxPort`, `ShellDiagnosticPort`, and `useShellSessionController()`.

- [ ] **Step 1: Add pure session and Workmux tests**

Transfer the final test cases from `shell-session-controller.test.ts` and
`shell-session-workmux.test.ts` at `52347f98`. Keep these required transition
and ownership cases:

```ts
assert.deepEqual(core.getSnapshot(), {
	status: 'waiting',
	reason: 'auto-connect',
	generation: 0,
});

core.update({ status: 'reconnect-failed', destination: 'hostPage' });
assert.deepEqual(navigationCalls, ['editHost:saved-1']);

const first = owner.replace(firstInput);
const second = owner.replace(secondInput);
assert.equal(first.port.key === second.port.key, false);
await first.disposed;
assert.deepEqual(events, ['first:cleanup', 'first:dispose']);
```

Move the old rendered hook cases into
`test/components/shell-session-controller.test.tsx`; use the existing
`jest-expo` imports and mocks rather than the obsolete Stage 2 Jest config.

- [ ] **Step 2: Run session tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-session-controller.test.ts test/integration/shell-session-workmux.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-session-controller.test.tsx
```

Expected: FAIL because the session modules do not exist. Record the missing
module errors.

- [ ] **Step 3: Implement the session contracts and pure core**

Use these exact public contracts, retaining the full method signatures from
`52347f98`:

```ts
export type ShellSessionSnapshot =
	| {
			status: 'waiting';
			reason: 'auto-connect' | 'reconnect';
			generation: number;
	  }
	| {
			status: 'attach-error';
			failureReason?: string;
			sessionName: string;
			generation: number;
	  }
	| { status: 'ready'; storedConnectionId?: string; generation: number }
	| { status: 'leaving'; generation: number };

export type ShellSessionPorts = {
	terminalSource: ShellTerminalSourcePort;
	hostCommands: ShellHostCommandPort;
	workmux: ShellWorkmuxPort;
	diagnostics: ShellDiagnosticPort;
	activity: ShellActivityPort;
};

export type ShellWorkmuxFailure = {
	message: string;
	failureClass?: WorkmuxControlCommandResult['failureClass'];
};

export type ShellWorkmuxOutcome = ControllerOutcome<ShellWorkmuxFailure> & {
	output?: string;
};
```

The pure core owns state transitions and navigation decisions only. It cannot
import React, Zustand, the SSH store, or the Workmux channel implementation.

- [ ] **Step 4: Implement sole Workmux and React/store ownership**

Implement `session-workmux.ts` so active ports expose only:

```ts
export type ShellWorkmuxPort = {
	readonly key: ShellTargetKey;
	command(
		argv: string[],
		options?: { timeoutMs?: number },
	): Promise<ShellWorkmuxOutcome>;
	operation(
		request: MdevBridgeOperationRequest,
		options?: { timeoutMs?: number },
	): Promise<ShellWorkmuxOutcome>;
	scroll: ShellWorkmuxScrollPort;
	registerBeforeDispose(
		owner: string,
		cleanup: (port: RetiringWorkmuxCleanupPort) => Promise<void>,
	): () => void;
};
```

Only `session-workmux.ts` imports `createWorkmuxControlChannel`. On replacement,
mark the old owner retiring, run registered cleanup once, settle cleanup even
when it throws, dispose the channel, then expose the successor. `session.tsx`
adapts the SSH store and React lifecycle to the pure core and ports; cleanup
must never call disconnect or destroy shell.

- [ ] **Step 5: Run session tests and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-session-controller.test.ts test/integration/shell-session-workmux.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-session-controller.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all commands exit 0. Record source commits `68e60f0f` through
`52347f98`.

- [ ] **Step 6: Commit the session slice**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/app/shell/detail.tsx apps/mobile/src/lib/shell-controllers/session-contracts.ts apps/mobile/src/lib/shell-controllers/session-core.ts apps/mobile/src/lib/shell-controllers/session-diagnostics.ts apps/mobile/src/lib/shell-controllers/session-workmux.ts apps/mobile/src/lib/shell-controllers/session.tsx apps/mobile/test/integration/shell-session-controller.test.ts apps/mobile/test/integration/shell-session-workmux.test.ts apps/mobile/test/components/shell-session-controller.test.tsx apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts
git commit -m "Rebuild shell session ownership"
```

### Task 3: Generation-Bound Controller Ports

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/terminal-contracts.ts`
- Create:
  `apps/mobile/test/integration/shell-terminal-runtime-publication.test.ts`
- Create: `apps/mobile/test/components/shell-activity-port-consumers.test.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal-hook-runtime.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/scrollback-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/scrollback.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-hook-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-remote-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/browser-actions-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/browser-actions.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/notifications.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/skill-selector-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/skill-selector.tsx`
- Modify: `apps/mobile/src/lib/terminal-fit-runner.ts`
- Modify: affected integration tests named by the production files above.

**Interfaces:**

- Consumes: `ShellSessionPorts` from Task 2 and the accepted current-listener
  implementation on `dev`.
- Produces: `ShellTerminalViewPort`, port-based controller inputs, and direct
  observable terminal runtime/mode/size publication.

- [ ] **Step 1: Change controller tests to typed ports first**

Replace raw connection/channel fixtures with these shapes:

```ts
const terminalSource: ShellTerminalSourcePort = {
	key: transportKey,
	generation: 1,
	connectionId: 'connection-1',
	channelId: 7,
	isAvailable: () => true,
	readBuffer,
	addListener,
	removeListener,
	sendData,
	resizePty,
};

const remoteTarget = {
	targetKey,
	tmuxEnabled: true,
	sessionName: 'main',
	connectionId: 'connection-1',
	channelId: 7,
	workmux: sessionPorts.workmux,
	hostCommands: sessionPorts.hostCommands,
};
```

Add assertions that terminal runtime publication does not replace the accepted
current listener on WebView-handle refresh, and that stale port generations
return `superseded` without sending input.

- [ ] **Step 2: Run affected controller tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-terminal-hook-runtime.test.ts test/integration/shell-terminal-lifecycle-controller.test.ts test/integration/shell-terminal-listener-ownership.test.ts test/integration/shell-terminal-runtime-publication.test.ts test/integration/shell-scrollback-controller.test.ts test/integration/shell-keyboard-remote-controller.test.ts test/integration/shell-browser-actions-controller.test.ts test/integration/shell-notifications-lifecycle.test.ts test/integration/shell-skill-selector-controller.test.ts
```

Expected: FAIL at compile time because controller inputs still require raw
connections/channels or because `ShellTerminalViewPort` is absent.

- [ ] **Step 3: Migrate terminal and scrollback**

Define the canonical React-free view contract in `terminal-contracts.ts`:

```ts
export type ShellTerminalViewPort = {
	getRuntimeKey(): TerminalRuntimeKey | null;
	getRuntimeInstanceId(): string | null;
	getSelectionModeEnabled(): boolean;
	isCurrentInstance(instanceId: string): boolean;
	fit(): void;
	setSystemKeyboardEnabled(enabled: boolean): void;
	setSelectionModeEnabled(enabled: boolean): void;
	getSelection(): Promise<string>;
	exitScrollback(message: { requestId: number; instanceId?: string }): void;
	sendScrollbackEnterAck(requestId: number, instanceId: string): void;
};
```

Terminal consumes `ShellTerminalSourcePort`; scrollback consumes terminal view,
terminal transport, activity, and `ShellWorkmuxPort`. Preserve the dev-side
listener lifecycle test harness and current-handle refresh behavior. Register
scrollback retirement cleanup through
`workmux.registerBeforeDispose('scrollback', cleanup)`.

- [ ] **Step 4: Migrate keyboard and remaining consumers**

Use this remote boundary consistently:

```ts
export type ShellKeyboardRemoteTargetContext = {
	targetKey: ShellTargetKey;
	tmuxEnabled: boolean;
	sessionName: string;
	connectionId: string;
	channelId: number;
	workmux: ShellWorkmuxPort;
	hostCommands: ShellHostCommandPort | null;
};
```

Browser actions, notifications, skill selector, terminal fit, diagnostics, and
keyboard commands consume only the narrow session ports they use. Preserve all
current mdev bridge, terminal diagnostics, timeout, and failure-class behavior.

- [ ] **Step 5: Run the typed-port regression group and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-terminal-hook-runtime.test.ts test/integration/shell-terminal-lifecycle-controller.test.ts test/integration/shell-terminal-listener-ownership.test.ts test/integration/shell-terminal-runtime-publication.test.ts test/integration/shell-scrollback-controller.test.ts test/integration/shell-keyboard-remote-controller.test.ts test/integration/shell-browser-actions-controller.test.ts test/integration/shell-notifications-lifecycle.test.ts test/integration/shell-skill-selector-controller.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-activity-port-consumers.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all commands exit 0. Record source commits `a7a291b7` through
`a7da6ebc` and note that current terminal-listener tests remained GREEN.

- [ ] **Step 6: Commit the typed-port slice**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/lib apps/mobile/test/integration apps/mobile/test/components/shell-activity-port-consumers.test.tsx
git commit -m "Rebuild typed shell ports"
```

Before committing, inspect `git diff --cached --name-only`; it must contain only
Task 3 files, not secure storage, shell config, Jest config, or generated files.

### Task 4: Session-Scoped Wispr Controller

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-tap-runner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-timer-owner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr.tsx`
- Create: `apps/mobile/test/integration/shell-wispr-controller-test-support.ts`
- Create: `apps/mobile/test/integration/shell-wispr-controller.test.ts`
- Create:
  `apps/mobile/test/integration/shell-wispr-controller-lifecycle.test.ts`
- Create: `apps/mobile/test/integration/shell-wispr-timer-owner.test.ts`
- Create: `apps/mobile/test/components/shell-wispr-controller.test.tsx`
- Modify: `apps/mobile/src/lib/wispr-automation.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/simple-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

**Interfaces:**

- Consumes: session generation, `ShellActivityPort`, text-entry modal commands,
  current native Wispr adapter, logger, and injectable clock/timers.
- Produces: `useShellWisprController()` with `snapshot`, `openTextEditor`,
  `textEntryProps`, and complete session cleanup.

- [ ] **Step 1: Add pure state-machine and fake-time tests**

Transfer final cases from source commit `5dc97c87` into Node tests and the
current component lane. The core dependency boundary is:

```ts
export type WisprTimerOwner = WisprTimerPort & {
	sleep(delayMs: number): Promise<void>;
	cancelAll(): void;
};

export type CreateShellWisprControllerCoreInput = {
	native: ShellWisprNativePort;
	modal: ShellWisprModalPort;
	now(): number;
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
	pixelRatio(): number;
	platformOS: string;
	logger: {
		info(message: string, payload?: unknown): void;
		warn(message: string, error?: unknown): void;
	};
};
```

Cover unsupported platform, setup-required status, automatic start, manual
start, timeout, close during pending start, unmount, repeated close, stale
request IDs, and rejected native calls.

- [ ] **Step 2: Run Wispr tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/wispr-automation.test.ts test/integration/shell-wispr-controller.test.ts test/integration/shell-wispr-controller-lifecycle.test.ts test/integration/shell-wispr-timer-owner.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-wispr-controller.test.tsx
```

Expected: FAIL because the Wispr controller modules are absent.

- [ ] **Step 3: Implement pure Wispr owners**

Implement separate core, timer, tap, start, and close units. The public snapshot
is a discriminated union; no unit may own both native tap retry and modal view
state. Every async completion checks request identity before publishing. Timer
cleanup is idempotent, and a pending native start remains paired with its close
decision after React unmount.

- [ ] **Step 4: Implement the React/native adapter**

`useShellWisprController` constructs the core once, synchronizes committed
dependencies in `useLayoutEffect`, exposes state through `useSyncExternalStore`,
and disposes through a replay-safe lifecycle. Remove `openRef` and render-time
`.current` assignments from simple modals and `detail.tsx`.

- [ ] **Step 5: Run Wispr tests and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/wispr-automation.test.ts test/integration/shell-wispr-controller.test.ts test/integration/shell-wispr-controller-lifecycle.test.ts test/integration/shell-wispr-timer-owner.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-wispr-controller.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all commands exit 0. Record source commits `ad219e88` through
`5dc97c87`.

- [ ] **Step 6: Commit the Wispr controller slice**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts apps/mobile/src/lib/shell-controllers/wispr-core.ts apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts apps/mobile/src/lib/shell-controllers/wispr-tap-runner.ts apps/mobile/src/lib/shell-controllers/wispr-timer-owner.ts apps/mobile/src/lib/shell-controllers/wispr.tsx apps/mobile/src/lib/shell-controllers/simple-modals.tsx apps/mobile/src/lib/wispr-automation.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-wispr-controller-test-support.ts apps/mobile/test/integration/shell-wispr-controller.test.ts apps/mobile/test/integration/shell-wispr-controller-lifecycle.test.ts apps/mobile/test/integration/shell-wispr-timer-owner.test.ts apps/mobile/test/integration/wispr-automation.test.ts apps/mobile/test/components/shell-wispr-controller.test.tsx
git commit -m "Rebuild shell Wispr ownership"
```

### Task 5: Real ShellScreenView and Composition Boundary

**Files:**

- Create: `apps/mobile/src/app/shell/ShellScreenOverlays.tsx`
- Create: `apps/mobile/src/app/shell/ShellScreenStates.tsx`
- Create: `apps/mobile/src/app/shell/ShellScreenView.tsx`
- Create: `apps/mobile/src/app/shell/use-manual-terminal-fit.ts`
- Create: `apps/mobile/src/app/shell/use-shell-route-ready.ts`
- Create: `apps/mobile/src/app/shell/use-shell-terminal-view-policy.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-source.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-target-owner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-tmux-resolution.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-transport-owner.ts`
- Create:
  `apps/mobile/src/lib/shell-controllers/scrollback-remote-copy-mode-owner.ts`
- Create: `apps/mobile/test/integration/shell-detail-boundary.test.ts`
- Create: `apps/mobile/test/components/shell-detail-modal-commands.test.tsx`
- Create: `apps/mobile/test/components/shell-session-target-lifetimes.test.tsx`
- Create: `apps/mobile/test/components/use-connection-debug-command.test.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Delete: `apps/mobile/src/app/shell/shell-keyboard-composition.ts`
- Delete:
  `apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts`

**Interfaces:**

- Consumes: Task 2 session owner, Task 3 controller ports, Task 4 Wispr
  controller, and existing modal/controller view props.
- Produces: real `ShellScreenView`, composition-only `ShellDetail`, focused
  session lifetime owners, and enforced architecture limits.

- [ ] **Step 1: Add final boundary tests before moving JSX**

Use the TypeScript-AST guard from source commit `73c7a20a`. It must assert:

```ts
assert.ok(countNonblankLines(detailSource) < 650);
assert.ok(countFunctionLines(detailFile, 'ShellDetail') < 300);
assert.equal(detailIdentifiers.has('useSshStore'), false);
assert.equal(detailIdentifiers.has('createWorkmuxControlChannel'), false);
assert.equal(detailAssignsRefCurrent, false);
assert.deepEqual(findViewWorkflowViolations(viewFile), []);
```

Move the original Stage 2 render cases into the three named component-test
files. Preserve the current `jest-expo` setup and use `@/` imports.

- [ ] **Step 2: Run boundary and component tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-detail-modal-commands.test.tsx test/components/shell-session-target-lifetimes.test.tsx test/components/use-connection-debug-command.test.tsx
```

Expected: FAIL because `ShellScreenView.tsx` and focused owners are absent and
`detail.tsx` exceeds both limits.

- [ ] **Step 3: Move rendering into ShellScreenView**

Define view-only props:

```ts
export type ShellScreenViewProps = {
	session: ShellScreenSessionView;
	terminal: ShellScreenTerminalView;
	keyboard: ShellScreenKeyboardView;
	modals: ShellScreenModalView;
};

export function ShellScreenView(
	props: ShellScreenViewProps,
): React.ReactElement | null;
```

Move the real `XtermJsWebView`, keyboard, overlays, reconnect state, and modal
JSX into the view. The view may import controller types but no controller hooks,
stores, native adapters, timers, Workmux factories, or diagnostic constructors.

- [ ] **Step 4: Reduce ShellDetail and delete obsolete shims**

Extract route-ready, manual-fit, terminal-view-policy, session-source,
target-lifetime, tmux-resolution, transport, and remote-copy-mode owners. Delete
the keyboard composition shim and its test. `ShellDetail` constructs owners,
wires ports, derives `ShellScreenSessionView`, and passes view props only.

- [ ] **Step 5: Run shell composition regressions and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts test/integration/shell-route.test.ts test/integration/shell-session-controller.test.ts test/integration/shell-session-workmux.test.ts test/integration/shell-terminal-runtime-publication.test.ts test/integration/shell-keyboard-hook-composition.test.ts test/integration/shell-scrollback-controller.test.ts test/integration/shell-modal-controller-composition.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-detail-modal-commands.test.tsx test/components/shell-session-target-lifetimes.test.tsx test/components/use-connection-debug-command.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all commands exit 0 and the boundary reports fewer than 650 nonblank
file lines and fewer than 300 `ShellDetail` lines. Record source commits
`8751a1d0` through `73c7a20a`.

- [ ] **Step 6: Commit the rendering slice**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/app/shell apps/mobile/src/lib/shell-controllers apps/mobile/src/lib/connection-debug-command.ts apps/mobile/src/lib/connection-diagnostic-delivery.ts apps/mobile/src/lib/tmux-scrollback.ts apps/mobile/src/lib/use-connection-debug-command.ts apps/mobile/test/integration apps/mobile/test/components
git commit -m "Rebuild shell rendering boundary"
```

Inspect the staged diff first and unstage any file not named in Task 5.

### Task 6: Serialized Wispr Native-Control Authority

**Files:**

- Create:
  `apps/mobile/src/lib/shell-controllers/wispr-native-control-authority.ts`
- Create:
  `apps/mobile/test/integration/shell-wispr-native-control-authority.test.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/wispr-core.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/wispr.tsx`
- Modify: Wispr integration and component tests from Task 4.

**Interfaces:**

- Consumes: the Task 4 start/close protocols.
- Produces: process-wide `WisprNativeControlAuthority`, cancellable acquisition,
  one active lease, latest waiter semantics, release, and permanent poison.

- [ ] **Step 1: Add authority tests first**

Use this public contract and test one lease, replacement, cancellation, release,
and poison:

```ts
export type WisprNativeControlLease = {
	release(): void;
	poison(): void;
};

export type WisprNativeControlAcquisition = {
	status: 'acquired' | 'waiting' | 'blocked';
	outcome: Promise<
		| { status: 'acquired'; lease: WisprNativeControlLease }
		| { status: 'superseded' | 'cancelled' | 'blocked' }
	>;
	cancel(): void;
};

export function createWisprNativeControlAuthority(): WisprNativeControlAuthority;
```

Also add lifecycle cases proving a successor waits for predecessor close, a
failed/uncertain close poisons authority, and stale leases cannot release or
poison a successor.

- [ ] **Step 2: Run authority tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-wispr-native-control-authority.test.ts test/integration/shell-wispr-controller-lifecycle.test.ts test/integration/shell-wispr-controller.test.ts
```

Expected: FAIL because the authority module and lease dependency do not exist.

- [ ] **Step 3: Implement authority and integrate start/close protocols**

Implement one process-wide authority instance in the React adapter. Start must
acquire before issuing a native toggle. Successful close releases its exact
lease; uncertain timeout or rejected cleanup poisons it. Acquisition
cancellation removes only that request, and a newer waiting acquisition
supersedes the older waiter without affecting the active owner.

Task 6 adds this required field to Task 4's core input:

```ts
export type CreateShellWisprControllerCoreInput = {
	native: ShellWisprNativePort;
	controlAuthority: WisprNativeControlAuthority;
	modal: ShellWisprModalPort;
	now(): number;
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
	pixelRatio(): number;
	platformOS: string;
	logger: {
		info(message: string, payload?: unknown): void;
		warn(message: string, error?: unknown): void;
	};
};
```

- [ ] **Step 4: Run the complete Wispr group and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/wispr-automation.test.ts test/integration/shell-wispr-controller.test.ts test/integration/shell-wispr-controller-lifecycle.test.ts test/integration/shell-wispr-timer-owner.test.ts test/integration/shell-wispr-native-control-authority.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-wispr-controller.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all commands exit 0. Record source commits `f91c2090` through
`0d54b653`.

- [ ] **Step 5: Commit native-control authority**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/lib/shell-controllers/wispr-native-control-authority.ts apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts apps/mobile/src/lib/shell-controllers/wispr-core.ts apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts apps/mobile/src/lib/shell-controllers/wispr.tsx apps/mobile/test/integration/shell-wispr-native-control-authority.test.ts apps/mobile/test/integration/shell-wispr-controller-lifecycle.test.ts apps/mobile/test/integration/shell-wispr-controller-test-support.ts apps/mobile/test/integration/shell-wispr-controller.test.ts apps/mobile/test/integration/wispr-automation.test.ts apps/mobile/test/components/shell-wispr-controller.test.tsx
git commit -m "Serialize Wispr native control"
```

### Task 7: Worktree Workspace Session-Port Adaptation

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/worktree-workspace-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/worktree-workspace.tsx`
- Modify: `apps/mobile/src/app/shell/ShellScreenView.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify:
  `apps/mobile/test/integration/shell-worktree-workspace-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-detail-boundary.test.ts`
- Modify: `apps/mobile/test/components/worktree-workspace-modal.test.tsx`

**Interfaces:**

- Consumes: `ShellTargetKey`, `ShellWorkmuxPort`, session name, connection
  availability, tmux capability, modal arbiter, and the existing Worktree core.
- Produces: the unchanged `WorktreeWorkspaceControllerHandle`, port-based
  controller dependencies, and `ShellScreenView` ownership of the custom modal.

- [ ] **Step 1: Change Worktree tests to reject raw dependencies**

Add a source-boundary assertion and port fixture:

```ts
const adapterSource = readFileSync(
	join(
		process.cwd(),
		'src/lib/shell-controllers/worktree-workspace-adapter.ts',
	),
	'utf8',
);
assert.doesNotMatch(adapterSource, /WorkmuxControlChannel/);
assert.doesNotMatch(adapterSource, /connection:\s*TConnection/);

const workmux: Pick<ShellWorkmuxPort, 'command' | 'operation'> = {
	command: async () => ({ status: 'completed', output: 'main:2.1' }),
	operation: async () => ({ status: 'completed', output: '{}' }),
};
```

Add a boundary assertion that `ShellScreenView.tsx` contains
`WorktreeWorkspaceModal` and `detail.tsx` does not. Extend the component test to
render the modal through `ShellScreenView` props while retaining the existing
draft and busy-dismissal cases.

- [ ] **Step 2: Run Worktree and boundary tests and record RED**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-worktree-workspace-controller.test.ts test/integration/shell-detail-boundary.test.ts test/integration/worktree-workspace-bridge.test.ts test/integration/worktree-workspace-modal.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/worktree-workspace-modal.test.tsx
```

Expected: FAIL because the adapter imports `WorkmuxControlChannel`, accepts a
raw connection, and the modal is still rendered by `detail.tsx`.

- [ ] **Step 3: Replace Worktree raw dependencies with session ports**

Use this exact dependency boundary:

```ts
export type WorktreeWorkspaceControllerDependencies = Readonly<{
	connectionAvailable: boolean;
	tmuxEnabled: boolean;
	sessionName: string;
	sourceKey: ShellTargetKey;
	workmux: Pick<ShellWorkmuxPort, 'command' | 'operation'>;
	arbiter: ShellModalArbiter;
}>;
```

Map Workmux outcomes explicitly:

```ts
function unwrapWorkmuxOutcome(outcome: ShellWorkmuxOutcome): string {
	switch (outcome.status) {
		case 'completed':
			return outcome.output ?? '';
		case 'failed':
			throw requestError(outcome.failure.message, outcome.failure.failureClass);
		case 'superseded':
			throw requestError('Worktree workspace request was superseded.');
		case 'unavailable':
			throw requestError('Worktree workspace request is unavailable.');
	}
}
```

`hasConnection` reads `connectionAvailable`; `isWorkmuxEnabled` reads
`tmuxEnabled`; target resolution calls `workmux.command`; bridge operations call
`workmux.operation`. Keep the current timeout, unsupported-operation mapping,
stale-target classification, invalid-response handling, and no-retry behavior.

- [ ] **Step 4: Move Worktree modal rendering into ShellScreenView**

Extend the modal view contract:

```ts
export type ShellScreenModalView = {
	commandMenu: {
		state: SimpleModalHandle;
		props: ShellKeyboardControllerHandle['commandMenuProps'];
	};
	browser: {
		actions: BrowserActionsModalProps;
		detectedOpenPicker: DetectedOpenPickerModalProps;
		hostUrl: HostUrlModalProps;
	};
	commander: {
		state: SimpleModalHandle;
		props: ShellKeyboardControllerHandle['commanderProps'];
	};
	skillSelector: SkillSelectorModalProps;
	textEntry: {
		state: SimpleModalHandle;
		keyboard: ShellKeyboardControllerHandle['textEntryProps'];
		wispr: ShellWisprControllerHandle['textEntryProps'];
	};
	configure: {
		state: SimpleModalHandle;
		props: ShellKeyboardControllerHandle['configureProps'];
	};
	featureRequest: FeatureRequestModalProps;
	worktreeWorkspace: WorktreeWorkspaceModalControllerProps;
};
```

Render `WorktreeWorkspaceModal` with the shared bottom offset and those props.
Construct `useWorktreeWorkspaceController` in `ShellDetail` from session values,
wire `openNew`/`openClose` into keyboard modal commands, and pass only
`modalProps` into `ShellScreenView`.

- [ ] **Step 5: Run Worktree and mdev regression tests and record GREEN**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-worktree-workspace-controller.test.ts test/integration/shell-detail-boundary.test.ts test/integration/worktree-workspace-bridge.test.ts test/integration/worktree-workspace-modal.test.ts test/integration/command-menu.test.ts test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts
pnpm exec jest --config jest.config.cjs --runInBand test/components/worktree-workspace-modal.test.tsx
pnpm run fmt:check
pnpm run typecheck
```

Expected: all commands exit 0. Record that the direct Worktree actions and final
Advanced submenu remain unchanged.

- [ ] **Step 6: Commit Worktree adaptation**

```bash
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/lib/shell-controllers/worktree-workspace-adapter.ts apps/mobile/src/lib/shell-controllers/worktree-workspace.tsx apps/mobile/src/app/shell/ShellScreenView.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-worktree-workspace-controller.test.ts apps/mobile/test/integration/shell-detail-boundary.test.ts apps/mobile/test/components/worktree-workspace-modal.test.tsx
git commit -m "Adapt Worktree Workspace to shell ports"
```

### Task 8: Full Verification, Maintainability Review, and Preview Evidence

**Files:**

- Modify: `docs/run/issue-141-stage-2-reconciliation-evidence.md`
- Modify only when a failing gate identifies a Stage 2 defect: files already
  listed in Tasks 1–7 and their focused tests.

**Interfaces:**

- Consumes: the complete independently usable Stage 2 branch.
- Produces: exact automated/manual acceptance evidence and a review-ready pull
  request linked from issue 141.

- [ ] **Step 1: Run forbidden-pattern and size gates**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts
if rg -n 'WorkmuxControlChannel' src/lib/shell-controllers/{browser-actions*,keyboard*,notifications*,scrollback*,skill-selector*,worktree-workspace*}.{ts,tsx}; then exit 1; fi
if rg -n '\.current\s*=' src/app/shell/detail.tsx; then exit 1; fi
```

Expected: boundary PASS and both forbidden searches return no matches. Record
the measured file/function sizes in Full Verification.

- [ ] **Step 2: Run all focused Stage 2 Node suites**

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/shell-route.test.ts test/integration/shell-session-controller.test.ts test/integration/shell-session-workmux.test.ts test/integration/shell-terminal-listener-ownership.test.ts test/integration/shell-terminal-runtime-publication.test.ts test/integration/shell-terminal-hook-runtime.test.ts test/integration/shell-scrollback-controller.test.ts test/integration/shell-keyboard-remote-controller.test.ts test/integration/shell-browser-actions-controller.test.ts test/integration/shell-notifications-lifecycle.test.ts test/integration/shell-skill-selector-controller.test.ts test/integration/shell-wispr-controller.test.ts test/integration/shell-wispr-controller-lifecycle.test.ts test/integration/shell-wispr-timer-owner.test.ts test/integration/shell-wispr-native-control-authority.test.ts test/integration/shell-worktree-workspace-controller.test.ts test/integration/shell-detail-boundary.test.ts
```

Expected: all tests PASS with exit 0. Record the test count and elapsed time.

- [ ] **Step 3: Run all Stage 2 component suites**

```bash
cd apps/mobile
pnpm exec jest --config jest.config.cjs --runInBand test/components/shell-route-error-screen.test.tsx test/components/shell-session-controller.test.tsx test/components/shell-activity-port-consumers.test.tsx test/components/shell-wispr-controller.test.tsx test/components/shell-detail-modal-commands.test.tsx test/components/shell-session-target-lifetimes.test.tsx test/components/use-connection-debug-command.test.tsx test/components/worktree-workspace-modal.test.tsx
```

Expected: every suite and test PASS with exit 0. Record suite/test counts.

- [ ] **Step 4: Run complete mobile checks**

```bash
cd apps/mobile
pnpm run fmt:check
pnpm run lint:check
pnpm run typecheck
pnpm run test:integration
pnpm run test:components
```

Expected: every command exits 0. Do not run `test:e2e:clear-state`.

- [ ] **Step 5: Run repository checks with Nix**

```bash
cd /home/muly/code/fressh
nix develop .#default -c pnpm exec turbo lint:check
nix develop .#default -c pnpm --filter @fressh/react-native-uniffi-russh test
nix develop .#default -c pnpm --filter @fressh/react-native-xtermjs-webview test
nix develop .#default -c pnpm exec jscpd .
```

Expected: lint/type/format/package tests exit 0 and jscpd introduces no new
Stage 2 duplication. Record exact output summaries.

- [ ] **Step 6: Run the thermo-nuclear maintainability review**

Invoke `thermo-nuclear-code-quality-review` over the complete diff from the
recorded replacement base through `HEAD`. Resolve every blocking finding in the
owning Task 1–7 file, rerun its focused tests, and append the review artifact or
path plus final zero-blocker result to the evidence file.

- [ ] **Step 7: Build the local Android preview**

```bash
cd /home/muly/code/fressh/apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Expected: local preview build succeeds using the existing signing lane. Do not
uninstall the existing app or clear its data.

- [ ] **Step 8: Perform the non-destructive Android smoke matrix**

On the existing signed installation, verify and record each result:

```text
[ ] Existing saved connections and private keys remain present.
[ ] A valid route opens its terminal and input/output continues.
[ ] An invalid/malformed route shows the Back screen and Back returns safely.
[ ] Leaving and re-entering the screen preserves the live SSH resource.
[ ] Reconnect overlay and host-page failure navigation remain correct.
[ ] Keyboard, command menu, scrollback entry/exit, and modal arbitration work.
[ ] New and Close Worktree Workspace open the native modal; cancel is safe.
[ ] The mdev Advanced submenu order remains unchanged.
[ ] Wispr opens, starts, closes, and does not double-toggle across re-entry.
```

Do not execute destructive Worktree close against a personal workspace. Record
device/build identifiers and observed results in Android Preview.

- [ ] **Step 9: Finalize evidence and commit review fixes**

Under `## Rollback`, record that Stage 2 changes no stored format, screen
unmount does not destroy live SSH resources, the replacement branch can be
abandoned without changing the immutable source branch, and a merged Stage 2
must be reverted before Stage 3 or later dependent shell stages.

```bash
git status --short
git diff --check
git add docs/run/issue-141-stage-2-reconciliation-evidence.md apps/mobile/src/app/shell apps/mobile/src/lib/shell-controllers apps/mobile/src/lib/connection-debug-command.ts apps/mobile/src/lib/connection-diagnostic-delivery.ts apps/mobile/src/lib/tmux-scrollback.ts apps/mobile/src/lib/use-connection-debug-command.ts apps/mobile/src/lib/wispr-automation.ts apps/mobile/src/lib/terminal-fit-runner.ts apps/mobile/test/integration apps/mobile/test/components
git commit -m "Record Stage 2 acceptance evidence"
```

Expected: before `git add`, only the evidence file and reviewed Stage 2 fixes
are present; after the commit, the worktree is clean.

- [ ] **Step 10: Open the Stage 2 pull request and link issue 141**

```bash
gh pr create --base dev --head source-quality-stage-2-reconciled --title "Complete Stage 2 shell ownership recovery" --body-file docs/run/issue-141-stage-2-reconciliation-evidence.md
```

Expected: the PR targets `dev`, contains only Stage 2, and includes exact
evidence. Add the PR URL to issue 141 without moving Current focus until the PR
is accepted and merged.
