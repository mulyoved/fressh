# Shell Modal Controllers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,308-line `shell-modals.tsx` with focused, locally tested
modal controllers and deterministic close-veto arbitration.

**Architecture:** Establish shared controller lifecycle/identity primitives,
then create independent cores and thin hooks for simple modals, skill selection,
feature requests, and browser actions. A focused modal arbiter preserves the
current conflict lists and close order without controller-to-controller imports;
`detail.tsx` wires the arbiter and imports each hook directly.

**Tech Stack:** TypeScript 5.9, React 19 hooks, Expo Linking/Clipboard, React
Native Alert, Node `tsx --test`, pnpm, Prettier, ESLint.

## Global Constraints

- Preserve all modal copy, loading/error state, close vetoes, request
  invalidation, source-change behavior, and side-channel command behavior.
- Do not introduce a state-management dependency, controller barrel, or shell
  facade.
- Place controller files under `apps/mobile/src/lib/shell-controllers/` with
  kebab-case names.
- Controller cores own generations, in-flight state, errors, invalidation, and
  disposal; hooks only bind React/platform dependencies and produce props.
- Preserve the current browser/feature/skill modal conflict sets and their
  deterministic close order.
- Delete `apps/mobile/src/lib/shell-modals.tsx` in this PR; do not leave a
  re-export wrapper.
- Keep existing pure request helpers in their current files.
- A stale request must not change modal state, display an alert, clear newer
  in-flight state, or launch a URL.
- Keep Wispr in `detail.tsx`; `TextEntryModalHandle.openRef` remains available
  to it.

---

## File Structure

**Create:**

- `apps/mobile/src/lib/shell-controllers/controller-core.ts` — shared lifecycle
  result/types and snapshot publisher.
- `apps/mobile/src/lib/shell-controllers/source-keys.ts` — collision-safe
  transport and target keys.
- `apps/mobile/src/lib/shell-controllers/modal-arbiter.ts` — registered close
  commands, conflict lists, and veto handling.
- `apps/mobile/src/lib/shell-controllers/simple-modals.tsx` — simple modal
  core/hook and text-entry open ref.
- `apps/mobile/src/lib/shell-controllers/skill-selector-core.ts` — testable
  load/refresh/select lifecycle.
- `apps/mobile/src/lib/shell-controllers/skill-selector.tsx` — native
  cache/React adapter and modal props.
- `apps/mobile/src/lib/shell-controllers/feature-request-core.ts` — repository
  resolution/submission lifecycle.
- `apps/mobile/src/lib/shell-controllers/feature-request.tsx` — Alert/React
  adapter and modal props.
- `apps/mobile/src/lib/shell-controllers/browser-actions-core.ts` — browser,
  Diffity, detected-open, and host URL lifecycle.
- `apps/mobile/src/lib/shell-controllers/browser-actions.tsx` —
  Linking/Clipboard/React adapter and modal props.
- `apps/mobile/test/integration/shell-controller-core.test.ts`
- `apps/mobile/test/integration/shell-modal-arbiter.test.ts`
- `apps/mobile/test/integration/shell-skill-selector-controller.test.ts`
- `apps/mobile/test/integration/shell-feature-request-controller.test.ts`
- `apps/mobile/test/integration/shell-browser-actions-controller.test.ts`
- `apps/mobile/test/integration/shell-modal-controller-composition.test.ts`

**Modify:**

- `apps/mobile/src/app/shell/detail.tsx` — construct keys/arbiter and consume
  focused hooks.
- `apps/mobile/test/integration/feature-request-target-picker.test.ts` — point
  source assertions at `feature-request.tsx`.
- `apps/mobile/test/integration/shell-modals-detected-open-picker-props.test.ts`
  — point source assertions at `browser-actions.tsx` and rename around the
  focused module.
- `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts` —
  retain direct Workmux channel assertions with new import paths.
- `apps/mobile/test/integration/shell-modals.test.ts` — retain request-helper
  coverage; rename only if its remaining scope warrants it.

**Delete:**

- `apps/mobile/src/lib/shell-modals.tsx`

## Published Interfaces

The later plans consume these exact exports:

```ts
// controller-core.ts
export type ControllerInvalidationReason =
	| 'closed'
	| 'source-change'
	| 'focus-lost'
	| 'app-inactive'
	| 'runtime-reset'
	| 'unmount';

export type ControllerOutcome<Failure = never> =
	| { status: 'completed' }
	| { status: 'superseded' }
	| { status: 'unavailable' }
	| { status: 'failed'; failure: Failure };

export type ControllerCore<State> = {
	getSnapshot(): State;
	subscribe(listener: () => void): () => void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

// source-keys.ts
export type ShellTransportKey = string & { readonly __shellTransportKey: true };
export type ShellTargetKey = string & { readonly __shellTargetKey: true };
export function createShellTransportKey(
	connectionId: string,
	channelId: number,
): ShellTransportKey;
export function createShellTargetKey(
	transportKey: ShellTransportKey,
	tmuxTarget: string,
): ShellTargetKey;
```

The four hooks keep the current public handle names so `detail.tsx` integration
is mechanical, but they are imported from separate files. No combined re-export
is permitted.

---

### Task 1: Shared Controller Lifecycle and Source Keys

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/controller-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/source-keys.ts`
- Test: `apps/mobile/test/integration/shell-controller-core.test.ts`

**Interfaces:**

- Consumes: no earlier task.
- Produces: `ControllerCore`, `ControllerOutcome`,
  `ControllerInvalidationReason`, `createControllerPublisher`,
  `ShellTransportKey`, `ShellTargetKey`, `createShellTransportKey`, and
  `createShellTargetKey`.

- [ ] **Step 1: Write the failing lifecycle and key tests**

Create `apps/mobile/test/integration/shell-controller-core.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerPublisher } from '../../src/lib/shell-controllers/controller-core';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

void test('controller publisher publishes snapshots and stops after disposal', () => {
	const publisher = createControllerPublisher({ count: 0 });
	const seen: number[] = [];
	const unsubscribe = publisher.subscribe(() => {
		seen.push(publisher.getSnapshot().count);
	});

	publisher.publish({ count: 1 });
	unsubscribe();
	publisher.publish({ count: 2 });
	publisher.disposePublisher();
	publisher.publish({ count: 3 });

	assert.deepEqual(seen, [1]);
	assert.deepEqual(publisher.getSnapshot(), { count: 2 });
});

void test('source keys are normalized and collision safe', () => {
	const first = createShellTransportKey('a:1', 2);
	const second = createShellTransportKey('a', 12);
	assert.notEqual(first, second);
	assert.equal(
		createShellTargetKey(first, '  '),
		JSON.stringify([first, 'main']),
	);
	assert.equal(
		createShellTargetKey(first, ' work '),
		JSON.stringify([first, 'work']),
	);
});
```

- [ ] **Step 2: Run the test and verify module-resolution failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-controller-core.test.ts
```

Expected: FAIL because `shell-controllers/controller-core` and
`shell-controllers/source-keys` do not exist.

- [ ] **Step 3: Implement the shared primitives**

Create `controller-core.ts` with the published types above and this publisher:

```ts
export type ControllerPublisher<State> = {
	getSnapshot(): State;
	subscribe(listener: () => void): () => void;
	publish(snapshot: State): void;
	disposePublisher(): void;
};

export function createControllerPublisher<State>(
	initialSnapshot: State,
): ControllerPublisher<State> {
	let snapshot = initialSnapshot;
	let disposed = false;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		publish: (nextSnapshot) => {
			if (disposed) return;
			snapshot = nextSnapshot;
			for (const listener of listeners) listener();
		},
		disposePublisher: () => {
			if (disposed) return;
			disposed = true;
			listeners.clear();
		},
	};
}
```

Create `source-keys.ts`:

```ts
export type ShellTransportKey = string & {
	readonly __shellTransportKey: true;
};
export type ShellTargetKey = string & { readonly __shellTargetKey: true };

export function createShellTransportKey(
	connectionId: string,
	channelId: number,
): ShellTransportKey {
	return JSON.stringify([connectionId, channelId]) as ShellTransportKey;
}

export function createShellTargetKey(
	transportKey: ShellTransportKey,
	tmuxTarget: string,
): ShellTargetKey {
	return JSON.stringify([
		transportKey,
		tmuxTarget.trim() || 'main',
	]) as ShellTargetKey;
}
```

- [ ] **Step 4: Run the test and typecheck**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-controller-core.test.ts && pnpm run typecheck
```

Expected: PASS, followed by a zero-exit TypeScript check.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/controller-core.ts apps/mobile/src/lib/shell-controllers/source-keys.ts apps/mobile/test/integration/shell-controller-core.test.ts
git commit -m "refactor(mobile): add shell controller lifecycle contracts"
```

---

### Task 2: Modal Arbiter and Simple Modal State

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/modal-arbiter.ts`
- Create: `apps/mobile/src/lib/shell-controllers/simple-modals.tsx`
- Test: `apps/mobile/test/integration/shell-modal-arbiter.test.ts`

**Interfaces:**

- Consumes: `createControllerPublisher` and `ControllerCore` from Task 1.
- Produces: `ShellModalId`, `ShellModalArbiter`, `createShellModalArbiter`,
  `createShellSimpleModalsCore`, `SimpleModalHandle`, `TextEntryModalHandle`,
  `ShellSimpleModalsHandle`, and `useShellSimpleModals(arbiter)`.

- [ ] **Step 1: Write the failing arbiter tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellModalArbiter } from '../../src/lib/shell-controllers/modal-arbiter';

void test('modal arbiter closes conflicts in requested order before opening', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	arbiter.register('commander', () => {
		events.push('close:commander');
	});
	arbiter.register('configure', () => {
		events.push('close:configure');
	});

	const opened = arbiter.requestOpen({
		target: 'browser-actions',
		conflicts: ['commander', 'configure'],
		onOpen: () => events.push('open:browser-actions'),
	});

	assert.equal(opened, true);
	assert.deepEqual(events, [
		'close:commander',
		'close:configure',
		'open:browser-actions',
	]);
});

void test('modal arbiter stops on close veto and does not open target', () => {
	const events: string[] = [];
	const arbiter = createShellModalArbiter();
	arbiter.register('feature-request', () => {
		events.push('veto:feature-request');
		return false;
	});

	assert.equal(
		arbiter.requestOpen({
			target: 'browser-actions',
			conflicts: ['feature-request'],
			onOpen: () => events.push('opened'),
		}),
		false,
	);
	assert.deepEqual(events, ['veto:feature-request']);
});

void test('simple modal core owns open state and disposal', () => {
	const core = createShellSimpleModalsCore();
	core.open('commander');
	core.open('text-entry');
	assert.deepEqual(core.getSnapshot(), {
		commandMenu: false,
		commander: true,
		textEntry: true,
		configure: false,
	});
	core.close('commander');
	core.dispose();
	core.open('configure');
	assert.equal(core.getSnapshot().commander, false);
	assert.equal(core.getSnapshot().configure, false);
});
```

Import `createShellSimpleModalsCore` from `shell-controllers/simple-modals` in
the test file.

- [ ] **Step 2: Run the test and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-arbiter.test.ts
```

Expected: FAIL because `createShellModalArbiter` is missing.

- [ ] **Step 3: Implement the arbiter and simple modal hook**

Use these exact arbiter contracts:

```ts
export type ShellModalId =
	| 'command-menu'
	| 'commander'
	| 'text-entry'
	| 'configure'
	| 'browser-actions'
	| 'feature-request'
	| 'skill-selector';

export type ShellModalClose = (context: {
	opening: ShellModalId;
}) => boolean | void;
export type ShellModalArbiter = {
	register(id: ShellModalId, close: ShellModalClose): () => void;
	requestOpen(input: {
		target: ShellModalId;
		conflicts: readonly ShellModalId[];
		onOpen: () => void;
	}): boolean;
};
```

Implement `requestOpen` by iterating `conflicts` exactly as supplied, skipping
the target, calling each closer with `{ opening: target }`, stopping when a
closer returns `false`, and calling `onOpen` only after every close succeeds. A
returned unregister callback must remove only the same closer instance. The
opening context lets browser actions preserve target-specific request
invalidation without importing another controller.

Move `SimpleModalHandle`, `TextEntryModalHandle`, `ShellSimpleModalsHandle`, and
`useShellSimpleModals` from `shell-modals.tsx` into `simple-modals.tsx`. Add
`createShellSimpleModalsCore()` with publisher-backed boolean state and
`open(id)`, `close(id)`, `invalidate`, and `dispose`; the hook subscribes with
`useSyncExternalStore`. Add an `arbiter: ShellModalArbiter` parameter and
register command-menu, commander, and configure close commands in one effect. Do
not register text entry here: `detail.tsx` registers its existing Wispr-aware
`handleCloseTextEntry` in Task 6. Keep `textEntry.openRef` synchronized with the
core snapshot so Wispr callbacks continue to see current state.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-arbiter.test.ts && pnpm run typecheck
```

Expected: PASS and zero type errors. `simple-modals.tsx` is not integrated yet.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/modal-arbiter.ts apps/mobile/src/lib/shell-controllers/simple-modals.tsx apps/mobile/test/integration/shell-modal-arbiter.test.ts
git commit -m "refactor(mobile): add shell modal arbitration"
```

---

### Task 3: Skill Selector Core and Hook

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/skill-selector-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/skill-selector.tsx`
- Create: `apps/mobile/test/integration/shell-skill-selector-controller.test.ts`

**Interfaces:**

- Consumes: Task 1 lifecycle types, Task 2 `ShellModalArbiter`, existing
  `DiscoveredSkill`, `BrowserActionsWorkspace`, `loadSkillSelectorProject`, and
  `skillDiscoveryCache`.
- Produces: `createSkillSelectorControllerCore`, `SkillSelectorControllerCore`,
  `SkillSelectorModalProps`, `SkillSelectorControllerHandle`, and
  `useSkillSelectorController`.

- [ ] **Step 1: Write failing lifecycle tests**

Create a harness whose injected `loadProject` returns a deferred promise, then
cover both current and stale completion:

```ts
void test('skill selector publishes loaded project for the current source', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.load.resolve({
		projectName: 'fressh',
		projectRoot: '/repo/fressh',
		updatedAt: '2026-07-10T00:00:00Z',
		skills: [{ name: 'brainstorming', description: 'Design' }],
	});
	await harness.settled();

	assert.deepEqual(harness.core.getSnapshot(), {
		open: true,
		skills: [{ name: 'brainstorming', description: 'Design' }],
		projectName: 'fressh',
		projectRoot: '/repo/fressh',
		updatedAt: '2026-07-10T00:00:00Z',
		isLoading: false,
		isRefreshing: false,
		error: null,
		refreshError: null,
	});
});

void test('skill selector suppresses completion after source invalidation', async () => {
	const harness = createSkillSelectorHarness();
	harness.core.open();
	harness.core.setSourceKey('source-2');
	harness.load.resolve({
		projectName: 'stale',
		projectRoot: '/stale',
		updatedAt: null,
		skills: [],
	});
	await harness.settled();
	assert.equal(harness.core.getSnapshot().open, false);
	assert.equal(harness.core.getSnapshot().projectName, null);
});
```

The test file must define `createDeferred`, `createSkillSelectorHarness`, and
`settled` locally. Inject `loadProject` and `sendText` so no native cache or
React render is required.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-skill-selector-controller.test.ts
```

Expected: FAIL because `skill-selector-core.ts` does not exist.

- [ ] **Step 3: Implement the core state and lifecycle**

Use this core interface:

```ts
export type SkillSelectorControllerCore = ControllerCore<SkillSelectorState> & {
	open(): void;
	close(): void;
	retry(): void;
	refresh(): void;
	select(skill: DiscoveredSkill): void;
	setSourceKey(sourceKey: string): void;
};

export function createSkillSelectorControllerCore(deps: {
	initialSourceKey: string;
	loadProject(input: { forceRefresh: boolean }): Promise<SkillSelectorProject>;
	sendText(value: string): void;
	requestOpen(onOpen: () => void): boolean;
	getErrorMessage(error: unknown): string;
}): SkillSelectorControllerCore;
```

Move the current load/refresh/select behavior into the core. Replace React
setters with one immutable snapshot published through
`createControllerPublisher`. Keep a monotonically increasing request ID and
capture `sourceKey` before awaiting. `close`, `setSourceKey`, `invalidate`, and
`dispose` increment the ID before clearing state. `refresh` preserves visible
skills and writes failures to `refreshError`; initial load failures write
`error`.

- [ ] **Step 4: Implement the thin hook**

Move the current exported modal/handle prop types into `skill-selector.tsx`. The
hook creates the core once, uses `useSyncExternalStore` with
`core.subscribe/core.getSnapshot`, updates the source key in a layout effect,
and disposes on unmount. Its injected `loadProject` calls
`loadSkillSelectorProject` with `skillDiscoveryCache`, the current stable
connection ID/target, `resolveHostBrowserWorkspace`, and
`runHostBrowserCommand`. Its `requestOpen` uses the modal arbiter with the
current skill-selector conflict list:

```ts
[
	'command-menu',
	'browser-actions',
	'commander',
	'configure',
	'feature-request',
	'text-entry',
];
```

- [ ] **Step 5: Run focused and existing skill tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-skill-selector-controller.test.ts \
  test/integration/skill-selector-loader.test.ts \
  test/integration/skill-discovery.test.ts \
  test/integration/skill-discovery-cache.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/skill-selector-core.ts apps/mobile/src/lib/shell-controllers/skill-selector.tsx apps/mobile/test/integration/shell-skill-selector-controller.test.ts
git commit -m "refactor(mobile): isolate skill selector controller"
```

---

### Task 4: Feature Request Core and Hook

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/feature-request-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/feature-request.tsx`
- Create:
  `apps/mobile/test/integration/shell-feature-request-controller.test.ts`
- Modify: `apps/mobile/test/integration/feature-request-target-picker.test.ts`

**Interfaces:**

- Consumes: Task 1 lifecycle types, Task 2 arbiter, existing
  `buildCreateGitHubIssueCommand` and `buildFeatureRequestSubmittedAlert`.
- Produces: `createFeatureRequestControllerCore`,
  `FeatureRequestControllerCore`, `FeatureRequestModalProps`,
  `FeatureRequestControllerHandle`, and `useFeatureRequestController`.

- [ ] **Step 1: Write failing resolution, veto, and stale-submit tests**

The new test must assert these concrete cases:

```ts
void test('feature request close vetoes while submission is active', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	await harness.resolveCurrent();
	const pending = harness.core.submit('description', 'mulyoved/fressh');
	assert.equal(harness.core.close(), false);
	harness.core.markSourceStale();
	harness.submit.resolve({
		success: true,
		output: '',
		issueUrl: 'https://github.com/mulyoved/fressh/issues/1',
	});
	await pending;
	assert.equal(harness.alerts.length, 0);
	assert.equal(harness.core.getSnapshot().open, false);
});

void test('feature request current success closes and alerts once', async () => {
	const harness = createFeatureRequestHarness();
	harness.core.open();
	await harness.resolveCurrent();
	const pending = harness.core.submit('description', 'mulyoved/fressh');
	harness.submit.resolve({ success: true, output: '', issueUrl: null });
	await pending;
	assert.equal(harness.core.getSnapshot().open, false);
	assert.equal(harness.alerts.length, 1);
});
```

Define the harness locally with deferred repository and submit operations,
captured commands, and an injected `showSubmittedAlert` function.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-feature-request-controller.test.ts
```

Expected: FAIL because the feature request core is missing.

- [ ] **Step 3: Implement the core and hook**

Use this core interface:

```ts
export type FeatureRequestControllerCore =
	ControllerCore<FeatureRequestState> & {
		open(): void;
		close(): boolean;
		markSourceStale(): void;
		submit(description: string, repository: string): Promise<void>;
	};
```

Move repository resolution and submission from `shell-modals.tsx`. The core owns
separate resolve/submit generations, the submit-in-flight flag, source
staleness, and all visible state. Inject `resolveCurrentGitHubRepository`,
`executeSubmission(command, 60_000)`, logging, error conversion, and
`showSubmittedAlert`. Preserve the existing close veto and exact fallback error
messages.

The hook binds `showSubmittedAlert` to `Alert.alert` using
`buildFeatureRequestSubmittedAlert` and requests modal opening through the
arbiter with conflicts `['browser-actions', 'skill-selector', 'configure']`.
Move the current modal/handle/dependency types into `feature-request.tsx`.

- [ ] **Step 4: Update source-contract tests and run focused suites**

Change `feature-request-target-picker.test.ts` to read
`src/lib/shell-controllers/feature-request.tsx` instead of
`src/lib/shell-modals.tsx`; retain its repository-forwarding assertion.

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-feature-request-controller.test.ts \
  test/integration/feature-request-target-picker.test.ts \
  test/integration/repo-feature-request.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/feature-request-core.ts apps/mobile/src/lib/shell-controllers/feature-request.tsx apps/mobile/test/integration/shell-feature-request-controller.test.ts apps/mobile/test/integration/feature-request-target-picker.test.ts
git commit -m "refactor(mobile): isolate feature request controller"
```

---

### Task 5: Browser Actions Core and Hook

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/browser-actions-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/browser-actions.tsx`
- Create:
  `apps/mobile/test/integration/shell-browser-actions-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-modals-detected-open-picker-props.test.ts`

**Interfaces:**

- Consumes: Task 1 lifecycle types/target key, Task 2 arbiter, and existing
  browser request helpers.
- Produces: `createBrowserActionsControllerCore`,
  `BrowserActionsControllerCore`, all three modal-prop types,
  `BrowserActionsControllerHandle`, and `useBrowserActionsController`.

- [ ] **Step 1: Write failing controller lifecycle tests**

Cover grouped invalidation and a stale URL-open completion:

```ts
void test('browser controller source change clears all request-owned UI', async () => {
	const harness = createBrowserActionsHarness();
	harness.core.open();
	harness.core.editUrlSlot('window-url');
	harness.urlRead.resolve({
		mode: 'edit',
		slot: 'window-url',
		panePath: '/repo',
		initialValue: 'https://example.test',
	});
	await harness.settled();
	harness.core.setSourceKey(
		createShellTargetKey(createShellTransportKey('conn', 7), 'other'),
	);
	const state = harness.core.getSnapshot();
	assert.equal(state.open, false);
	assert.equal(state.hostUrl, null);
	assert.equal(state.detectedOpenPicker, null);
});

void test('browser controller does not open URL after invalidation', async () => {
	const harness = createBrowserActionsHarness();
	const pending = harness.core.openGitHubTarget('issues');
	harness.core.invalidate('focus-lost');
	harness.repository.resolve({
		repository: 'mulyoved/fressh',
		panePath: '/repo',
	});
	await pending;
	assert.deepEqual(harness.openedUrls, []);
});
```

The local harness injects `readHostUrl`, exposes its deferred as `urlRead`, and
uses only the public `editUrlSlot` command. Import `createShellTransportKey` and
`createShellTargetKey` from `shell-controllers/source-keys` for the source
replacement.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-browser-actions-controller.test.ts
```

Expected: FAIL because `browser-actions-core.ts` is missing.

- [ ] **Step 3: Implement the browser core**

Use this public core surface:

```ts
export type BrowserActionsControllerCore =
	ControllerCore<BrowserActionsState> & {
		setSourceKey(sourceKey: ShellTargetKey): void;
		open(): boolean;
		close(): void;
		openGitHubTarget(target: GitHubRepositoryTarget): Promise<void>;
		openDiffity(): Promise<void>;
		openDetected(mode: HostBrowserOpenMode): boolean;
		selectDetected(candidate: DetectedOpenCandidate): Promise<void>;
		closeDetectedPicker(): void;
		openUrlSlot(slot: HostBrowserUrlSlot): void;
		editUrlSlot(slot: HostBrowserUrlSlot): void;
		closeHostUrl(): boolean;
		submitHostUrl(value: string): void;
		invalidateHostUrlReads(): void;
		resolvePaneContext(): Promise<TmuxPaneContext>;
		resolvePanePath(): Promise<string>;
		resolveWorkspace(): Promise<BrowserActionsWorkspace>;
		resolveCurrentGitHubRepository(): Promise<string>;
		runHostBrowserCommand(command: string, timeoutMs?: number): Promise<string>;
	};
```

Move the existing browser hook state and callbacks into the core while reusing
`runDetectedOpenControllerRequest`,
`runGuardedDetectedOpenPickerSelectionRequest`, `runGitHubTargetOpenRequest`,
`runHostDiffityOpenRequest`, `runHostUrlReadRequest`, `runHostUrlSubmitRequest`,
and `cleanupBrowserActionRequests`. Replace React setters with publisher-backed
snapshot setters. Capture a generation and source key around every awaited
operation; the injected `openAndroidUrl` must only run for the current request.
`closeHostUrl` returns `false` while submit is in flight.

- [ ] **Step 4: Implement the browser hook**

Move the current modal prop/handle/dependency types to `browser-actions.tsx`.
Bind platform operations to `Linking.openURL`, Clipboard/report helpers, and the
current side-channel/Workmux ports. Use `useSyncExternalStore` for state and
call `core.setSourceKey` in a layout effect. Browser opening uses the arbiter
with conflicts in the current order:

```ts
[
	'command-menu',
	'commander',
	'skill-selector',
	'text-entry',
	'configure',
	'feature-request',
];
```

- [ ] **Step 5: Update detected-open source assertions and run focused suites**

Point `shell-modals-detected-open-picker-props.test.ts` at
`src/lib/shell-controllers/browser-actions.tsx` for hook prop assertions and at
`browser-actions-core.ts` for invalidation-order assertions. Keep the
`detail.tsx` render assertion.

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-browser-actions-controller.test.ts \
  test/integration/shell-modals.test.ts \
  test/integration/browser-actions-controller-actions.test.ts \
  test/integration/browser-actions-controller-context.test.ts \
  test/integration/browser-actions-modal-controller.test.ts \
  test/integration/detected-open-actions.test.ts \
  test/integration/shell-modals-detected-open-picker-props.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/browser-actions-core.ts apps/mobile/src/lib/shell-controllers/browser-actions.tsx apps/mobile/test/integration/shell-browser-actions-controller.test.ts apps/mobile/test/integration/shell-modals-detected-open-picker-props.test.ts
git commit -m "refactor(mobile): isolate browser actions controller"
```

---

### Task 6: Compose Focused Modal Controllers and Delete the Combined File

**Files:**

- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`
- Create:
  `apps/mobile/test/integration/shell-modal-controller-composition.test.ts`
- Delete: `apps/mobile/src/lib/shell-modals.tsx`

**Interfaces:**

- Consumes: all hooks/arbiter from Tasks 2-5 and source keys from Task 1.
- Produces: the final PR 1 `detail.tsx` modal composition used by every
  subsequent plan.

- [ ] **Step 1: Write the failing composition guard**

```ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

void test('shell detail composes focused modal controllers without shell-modals', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.match(source, /shell-controllers\/browser-actions/);
	assert.match(source, /shell-controllers\/feature-request/);
	assert.match(source, /shell-controllers\/skill-selector/);
	assert.match(source, /shell-controllers\/simple-modals/);
	assert.match(source, /createShellModalArbiter/);
	assert.doesNotMatch(source, /from '@\/lib\/shell-modals'/);
	assert.equal(
		existsSync(join(process.cwd(), 'src/lib/shell-modals.tsx')),
		false,
	);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-controller-composition.test.ts
```

Expected: FAIL because `detail.tsx` still imports `shell-modals.tsx` and that
file still exists.

- [ ] **Step 3: Wire the arbiter, keys, and focused hooks**

Replace the combined import with direct imports. Construct stable keys and the
arbiter near the other shell identity values:

```ts
const transportKey = useMemo(
	() => createShellTransportKey(connectionId, channelId),
	[channelId, connectionId],
);
const targetKey = useMemo(
	() => createShellTargetKey(transportKey, tmuxTarget),
	[tmuxTarget, transportKey],
);
const modalArbiter = useMemo(() => createShellModalArbiter(), []);
```

Pass `modalArbiter` to all four hooks and `targetKey` to browser/skill source
inputs. Register feature/skill/browser close commands through their hooks. In
`detail.tsx`, register `handleCloseTextEntry` as the `text-entry` closer after
that Wispr-aware callback is defined; unregister it on cleanup. Browser's
registered closer receives the opening target and invalidates host URL reads for
`feature-request`, `configure`, and `text-entry`, matching the current callers.
Remove `skillSelectorCloseRef`, `featureRequestCloseRef`, all three
`close*OtherModals` callbacks, and `sourceKeyChangeTrackerRef`. Keep
`runBrowserActionsWorkmuxCommand` in `detail.tsx` because PR 2 also consumes it.
Delete `shell-modals.tsx` after all imports and source assertions move.

- [ ] **Step 4: Run the full modal-focused verification**

```bash
cd apps/mobile && pnpm exec prettier --write \
  src/lib/shell-controllers \
  src/app/shell/detail.tsx \
  test/integration/shell-*controller*.test.ts \
  test/integration/feature-request-target-picker.test.ts \
  test/integration/shell-modals-detected-open-picker-props.test.ts && \
pnpm exec tsx --test \
  test/integration/shell-controller-core.test.ts \
  test/integration/shell-modal-arbiter.test.ts \
  test/integration/shell-skill-selector-controller.test.ts \
  test/integration/shell-feature-request-controller.test.ts \
  test/integration/shell-browser-actions-controller.test.ts \
  test/integration/shell-modal-controller-composition.test.ts \
  test/integration/shell-modals.test.ts \
  test/integration/feature-request-target-picker.test.ts \
  test/integration/detected-open-actions.test.ts && \
pnpm run lint:check && pnpm run typecheck
```

Expected: Prettier completes, every listed test passes, and lint/typecheck exit
zero.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/src/app/shell/detail.tsx \
  apps/mobile/test/integration/shell-modal-controller-composition.test.ts \
  apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts
git rm apps/mobile/src/lib/shell-modals.tsx
git commit -m "refactor(mobile): compose focused shell modal controllers"
```

## PR 1 Completion Check

- [ ] `rg "shell-modals" apps/mobile/src apps/mobile/test` returns no stale
      source path.
- [ ] Every modal controller owns its request IDs, in-flight flags, errors, and
      cleanup.
- [ ] Feature request close veto and exact modal conflict order are covered by
      tests.
- [ ] Browser requests suppress stale URL launches and alerts.
- [ ] `detail.tsx` contains no modal close-ref cycle or grouped request cleanup.
- [ ] `cd apps/mobile && pnpm run fmt:check && pnpm run lint:check && pnpm run typecheck`
      passes.
