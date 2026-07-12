# Shell Controller and Modal Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every shell controller to the canonical
`{ state, commands, view }` handle, remove unearned layers, and replace the
verified duplicate chrome in eight standard shell modals with one shared frame.

**Architecture:** Each domain keeps one public hook and one type-only contracts
file; private files exist only for a real model, async runtime, policy, or
platform boundary. The shared modal frame owns standard native modal, backdrop,
keyboard avoidance, end placement, surface, title, and close chrome while every
modal keeps its content, local form state, and controller workflow.

**Tech Stack:** TypeScript 5.9, React 19, Expo 54, React Native 0.81, Node
`tsx --test`, pnpm/Turbo, Prettier, ESLint.

## Prerequisite

Execute and merge
`docs/superpowers/plans/2026-07-12-shell-detail-wispr-decomposition.md` first.
This plan assumes its session, Wispr, typed port, and `ShellScreenView` files
are present. If that execution changes a name listed here, update this plan
before starting rather than adding a compatibility alias.

## Global Constraints

- Start every changed behavior with a failing test and observe the expected
  failure before production edits.
- Preserve current shell-controller and modal behavior, copy, sizing, backdrop
  close, Android Back, keyboard avoidance, scroll position, focus, and local
  reset semantics.
- Every public controller handle has exactly `state`, `commands`, and `view`.
- Every domain has one public hook file and one public type-only contracts file.
- Other domains import only public contracts and focused capability ports.
- Tests may import private models, runtimes, and policies directly.
- Keep `controller-core.ts` limited to `ControllerHandle`, `ControllerCore`,
  `ControllerOutcome`, publisher/subscriber behavior, and replay-safe disposal.
- Delete old public signatures, forwarding layers, and their tests in the same
  task that introduces the replacement. Do not add compatibility aliases.
- Do not add barrels, a combined shell facade, a generic adapter stack, Redux,
  XState, or an event bus.
- Hooks may create pure units, read snapshots, commit ports/identity in layout
  effects, subscribe/dispose in passive effects, and build the public handle.
  They may not mutate external state during render.
- Private files are named for owned behavior: `model`, `runtime`, `policy`, or a
  platform boundary. Final production filenames may not use `adapter`, `facade`,
  `support`, `coordinator`, or `hook-runtime` as architectural roles.
- Public hooks stay below 250 nonblank lines. Private models, runtimes, and
  policies stay below 350 nonblank lines.
- `TextEntryModal` remains custom because it owns centered dragging, animated
  translation, a separately layered backdrop, dynamic height, and a draggable
  header. Do not force it through the standard frame.
- Use the local Android preview lane for manual checks. Never clear
  `com.finalapp.vibe2` data or run `test:e2e:clear-state`.
- Run a thermo-nuclear maintainability review after automated verification and
  resolve every blocker before merge.

---

## Final File Shape

### Shared

- Modify `apps/mobile/src/lib/shell-controllers/controller-core.ts`
  - Add `ControllerHandle<State, Commands, View>`.
- Keep `apps/mobile/src/lib/shell-controllers/source-keys.ts`.
- Delete `apps/mobile/src/lib/shell-controllers/controller-lifecycle.ts`.
- Delete `apps/mobile/src/lib/shell-controllers/generation-request-gate.ts`.
- Create `apps/mobile/test/integration/shell-controller-architecture.test.ts`.

### Modal chrome

- Create `apps/mobile/src/app/shell/components/ShellModalFrame.tsx`.
- Create `apps/mobile/src/app/shell/components/shell-modal-frame-layout.ts`.
- Create `apps/mobile/test/integration/shell-modal-frame.test.ts`.
- Migrate `BrowserActionsModal.tsx`, `CommandMenuModal.tsx`,
  `ConfigureModal.tsx`, `DetectedOpenPickerModal.tsx`,
  `TerminalCommanderModal.tsx`, `SkillSelectorModal.tsx`,
  `FeatureRequestModal.tsx`, and `HostUrlModal.tsx`.
- Keep the custom frame inside `TextEntryModal.tsx`.

### Canonical controller domains

Each domain finishes with `<domain>.tsx`, `<domain>-contracts.ts`, and only the
private model/runtime/policy files named in its task. The final architecture
test is the authoritative file-shape list.

---

### Task 1: Shared Modal Frame and Compact Menu Sheets

**Files:**

- Create: `apps/mobile/src/app/shell/components/ShellModalFrame.tsx`
- Create: `apps/mobile/src/app/shell/components/shell-modal-frame-layout.ts`
- Create: `apps/mobile/test/integration/shell-modal-frame.test.ts`
- Modify: `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
- Modify: `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`
- Modify: `apps/mobile/src/app/shell/components/ConfigureModal.tsx`
- Modify: `apps/mobile/src/app/shell/components/DetectedOpenPickerModal.tsx`

**Interfaces:**

- Consumes: current modal visibility, close/show commands, bottom offset,
  placement, keyboard avoidance, header content, and exact surface dimensions.
- Produces: `ShellModalFrame` and `resolveShellModalFrameLayout()`.

- [ ] **Step 1: Write the failing layout and ownership tests**

Create `shell-modal-frame.test.ts` with these assertions:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveShellModalFrameLayout } from '../../src/app/shell/components/shell-modal-frame-layout';

void test('bottom-end frame keeps the sheet above the keyboard bar', () => {
	assert.deepEqual(
		resolveShellModalFrameLayout({
			placement: 'bottom-end',
			bottomOffset: 28,
		}),
		{
			container: { justifyContent: 'flex-end', alignItems: 'flex-end' },
			surface: { marginRight: 8, marginBottom: 28 },
		},
	);
});

void test('center-end frame applies bottom offset to its container', () => {
	assert.deepEqual(
		resolveShellModalFrameLayout({
			placement: 'center-end',
			bottomOffset: 24,
		}),
		{
			container: {
				justifyContent: 'center',
				alignItems: 'flex-end',
				paddingBottom: 24,
			},
			surface: { marginRight: 8 },
		},
	);
});

void test('standard shell sheets delegate native modal chrome to one frame', () => {
	for (const file of [
		'BrowserActionsModal.tsx',
		'CommandMenuModal.tsx',
		'ConfigureModal.tsx',
		'DetectedOpenPickerModal.tsx',
	]) {
		const source = readFileSync(`src/app/shell/components/${file}`, 'utf8');
		assert.match(source, /<ShellModalFrame/);
		assert.doesNotMatch(source, /<Modal\b/);
	}
});
```

- [ ] **Step 2: Run the frame test and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-frame.test.ts
```

Expected: FAIL because the frame and layout module do not exist.

- [ ] **Step 3: Implement the pure layout contract**

Create `shell-modal-frame-layout.ts`:

```ts
export type ShellModalPlacement = 'bottom-end' | 'center-end';

export function resolveShellModalFrameLayout(input: {
	placement: ShellModalPlacement;
	bottomOffset: number;
}) {
	if (input.placement === 'center-end') {
		return {
			container: {
				justifyContent: 'center' as const,
				alignItems: 'flex-end' as const,
				paddingBottom: input.bottomOffset,
			},
			surface: { marginRight: 8 },
		};
	}
	return {
		container: {
			justifyContent: 'flex-end' as const,
			alignItems: 'flex-end' as const,
		},
		surface: { marginRight: 8, marginBottom: input.bottomOffset },
	};
}
```

- [ ] **Step 4: Implement the shared frame**

Expose this exact contract:

```ts
export type ShellModalFrameProps = {
	open: boolean;
	title: string;
	onClose(): void;
	onShow?(): void;
	bottomOffset: number;
	placement: ShellModalPlacement;
	keyboardAvoiding?: boolean;
	subtitle?: ReactNode;
	headerActions?: ReactNode;
	surfaceStyle: StyleProp<ViewStyle>;
	children: ReactNode;
};
```

The component renders one transparent slide `Modal`, passes `onClose` to
`onRequestClose`, closes from the full themed backdrop, optionally uses iOS
`KeyboardAvoidingView`, and renders one themed surface with border, padding,
top-left radius, title, optional subtitle/actions, and close button. The surface
stops responder propagation. `surfaceStyle` supplies only the preserved modal-
specific width, min/max width, and max height.

- [ ] **Step 5: Migrate the four compact sheets**

Pass their existing close/reset callback to the frame. Preserve these exact
sizes:

```text
BrowserActions: width 72%, min 260, max 360, maxHeight 80%
CommandMenu: width 70%, min 240, max 320, maxHeight 80%
Configure: width 70%, min 240, max 320, maxHeight 80%
DetectedOpenPicker: width 78%, min 280, max 380, maxHeight 80%
```

Move Browser's mode toggle into `headerActions`. Keep each modal's content and
local state in its existing file.

- [ ] **Step 6: Run modal tests and commit**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-frame.test.ts test/integration/shell-modals-detected-open-picker-props.test.ts
```

Expected: PASS.

```bash
git add apps/mobile/src/app/shell/components apps/mobile/test/integration/shell-modal-frame.test.ts
git commit -m "Add shared shell modal frame"
```

### Task 2: Keyboard-Aware and Form Sheet Migration

**Files:**

- Modify: `apps/mobile/src/app/shell/components/TerminalCommanderModal.tsx`
- Modify: `apps/mobile/src/app/shell/components/SkillSelectorModal.tsx`
- Modify: `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx`
- Modify: `apps/mobile/src/app/shell/components/HostUrlModal.tsx`
- Modify: `apps/mobile/test/integration/shell-modal-frame.test.ts`

**Interfaces:**

- Consumes: `ShellModalFrame` from Task 1.
- Produces: all eight standard shell sheets on the shared frame.

- [ ] **Step 1: Extend the failing ownership test**

Add all four files to the frame-ownership loop and explicitly assert:

```ts
const textEntry = readFileSync(
	'src/app/shell/components/TextEntryModal.tsx',
	'utf8',
);
assert.doesNotMatch(textEntry, /<ShellModalFrame/);
assert.match(textEntry, /<Animated\.View/);
assert.match(textEntry, /panResponder\.panHandlers/);
```

- [ ] **Step 2: Run the frame test and verify RED**

Expected: FAIL because the four files still render `Modal` directly.

- [ ] **Step 3: Migrate bottom-end keyboard sheets**

Use `placement="bottom-end"` and `keyboardAvoiding` for TerminalCommander and
SkillSelector. Preserve:

```text
TerminalCommander: width 70%, min 260, max 360, maxHeight 85%
SkillSelector: width 70%, min 260, max 360, dynamic maxHeight
```

Pass SkillSelector's existing `bottomOffset + androidBottomInset` value. Put its
search/status subtitle in `subtitle` and refresh controls in `headerActions`.

- [ ] **Step 4: Migrate center-end form sheets**

Use `placement="center-end"` and `keyboardAvoiding` for FeatureRequest and
HostUrl. Preserve width 85%, min 280, max 400; preserve FeatureRequest maxHeight
85%. Pass the existing reset-aware `handleClose` functions unchanged.

- [ ] **Step 5: Run modal and feature tests, then commit**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-frame.test.ts test/integration/feature-request-target-picker.test.ts
```

Expected: PASS.

```bash
git add apps/mobile/src/app/shell/components apps/mobile/test/integration/shell-modal-frame.test.ts
git commit -m "Share standard shell modal chrome"
```

### Task 3: Canonical Controller Foundation and Skill Selector Pilot

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/controller-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/skill-selector-contracts.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/skill-selector-core.ts` to
  `apps/mobile/src/lib/shell-controllers/skill-selector-model.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/skill-selector.tsx`
- Delete: `apps/mobile/src/lib/shell-controllers/skill-selector-adapter.ts`
- Modify: `apps/mobile/test/integration/shell-skill-selector-controller.test.ts`
- Replace: `apps/mobile/test/integration/shell-skill-selector-adapter.test.ts`
  with `apps/mobile/test/integration/shell-skill-selector-contract.test.ts`

**Interfaces:**

- Produces: `ControllerHandle<State, Commands, View>` and the first canonical
  domain handle.

- [ ] **Step 1: Write the failing public contract test**

Use a compile-time exact-key assertion plus behavior checks:

```ts
type ExactKeys<T, Keys extends PropertyKey> =
	Exclude<keyof T, Keys> extends never
		? Exclude<Keys, keyof T> extends never
			? true
			: false
		: false;

const exact: ExactKeys<
	SkillSelectorControllerHandle,
	'state' | 'commands' | 'view'
> = true;
assert.equal(exact, true);
```

Assert selecting a skill still sends `$name ` through the guarded input port and
closes the model.

- [ ] **Step 2: Run the skill selector suites and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-skill-selector-*.test.ts
```

Expected: FAIL because the handle is flat and the adapter still exists.

- [ ] **Step 3: Add the shared handle and domain contracts**

Add to `controller-core.ts`:

```ts
export type ControllerHandle<State, Commands, View> = Readonly<{
	state: State;
	commands: Commands;
	view: View;
}>;
```

Define `SkillSelectorCommands` as `open`, `close`, `retry`, and `refresh`;
define `SkillSelectorView` as `{ modal: SkillSelectorModalProps }`; define the
handle with `ControllerHandle`.

- [ ] **Step 4: Fold the adapter and rename the core**

Pass host loader, cache, modal arbiter, guarded input, and error ports directly
to the model. The hook owns platform cache/loader adaptation, layout commit,
modal registration, passive disposal, and view derivation. Delete the adapter
and its type exports.

- [ ] **Step 5: Run, typecheck, and commit**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-skill-selector-*.test.ts && pnpm run typecheck
```

Expected: PASS.

```bash
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration/shell-skill-selector-*.test.ts
git commit -m "Canonicalize skill selector controller"
```

### Task 4: Feature Request Controller

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/feature-request-contracts.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/feature-request-core.ts` to
  `apps/mobile/src/lib/shell-controllers/feature-request-model.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/feature-request.tsx`
- Delete: `apps/mobile/src/lib/shell-controllers/feature-request-adapter.ts`
- Modify:
  `apps/mobile/test/integration/shell-feature-request-controller.test.ts`

**Interfaces:**

- Produces:
  `FeatureRequestControllerHandle = ControllerHandle<State, Commands, View>`
  with commands `open`, `close`, `submit`, and `markSourceStale`; view
  `{ modal }`.

- [ ] **Step 1: Change tests to the canonical handle and direct ports**

Add exact-key coverage. Preserve tests for repository resolution, submission
availability, stale completion, close veto, successful alert, current failure,
and repeated disposal.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-feature-request-controller.test.ts
```

Expected: FAIL on the old flat handle/adapter.

- [ ] **Step 3: Move public types and fold forwarding behavior**

Move state/failure/commands/view/input-port types to contracts. Give the model
repository, host command, modal arbiter, alert, error, and logger ports
directly. Build the modal view in the hook. Delete the adapter in the same edit.

- [ ] **Step 4: Run and commit**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-feature-request-controller.test.ts test/integration/feature-request-target-picker.test.ts && pnpm run typecheck
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration/shell-feature-request-controller.test.ts
git commit -m "Canonicalize feature request controller"
```

### Task 5: Browser Actions Controller

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/browser-actions-contracts.ts`
- Split: `apps/mobile/src/lib/shell-controllers/browser-actions-core.ts` into
  `apps/mobile/src/lib/shell-controllers/browser-actions-model.ts` and
  `apps/mobile/src/lib/shell-controllers/browser-actions-request-runtime.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/browser-actions.tsx`
- Delete: `apps/mobile/src/lib/shell-controllers/browser-actions-adapter.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/browser-actions-facade.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/browser-actions-modal-props.ts`
- Modify:
  `apps/mobile/test/integration/shell-browser-actions-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-browser-actions-controller-advanced.test.ts`
- Modify:
  `apps/mobile/test/integration/browser-actions-controller-lifecycle.test.ts`
- Delete:
  `apps/mobile/test/integration/browser-actions-controller-facade.test.ts`
- Delete:
  `apps/mobile/test/integration/browser-actions-modal-props-mapper.test.ts`

**Interfaces:**

- Commands: open/close, browser targets, URL editing, detected selection,
  repository/workspace resolution, host command, and invalidation.
- View: `{ browserModal, hostUrlModal, detectedOpenModal }`.

- [ ] **Step 1: Rewrite tests around model/runtime/handle behavior**

Keep all request generation, host URL submit, detected picker, stale completion,
close veto, error copy, and workspace/repository coverage. Add exact handle keys
and assert view callbacks call the current command object.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-browser-actions-controller*.test.ts test/integration/browser-actions-controller-*.test.ts
```

Expected: FAIL because the facade and mapper still own the public surface.

- [ ] **Step 3: Split real async work and delete forwarding layers**

Move snapshot/transitions to `browser-actions-model.ts`; move host URL reads,
submits, detected operations, and repository/workspace requests to
`browser-actions-request-runtime.ts`. The hook constructs stable commands and
the three view groups directly. Delete adapter, facade, modal-props, and their
tests.

- [ ] **Step 4: Enforce size and run tests**

```bash
cd apps/mobile && test "$(awk 'NF {n++} END {print n}' src/lib/shell-controllers/browser-actions.tsx)" -lt 250 && test "$(awk 'NF {n++} END {print n}' src/lib/shell-controllers/browser-actions-model.ts)" -lt 350 && test "$(awk 'NF {n++} END {print n}' src/lib/shell-controllers/browser-actions-request-runtime.ts)" -lt 350 && pnpm exec tsx --test test/integration/shell-browser-actions-controller*.test.ts && pnpm run typecheck
```

Expected: size gates and tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Flatten browser actions controller layers"
```

### Task 6: Terminal Controller

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/terminal-contracts.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/terminal-hook-runtime.ts` to
  `apps/mobile/src/lib/shell-controllers/terminal-runtime.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts` to
  `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-runtime.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/terminal-size-core.ts` to
  `apps/mobile/src/lib/shell-controllers/terminal-size-runtime.ts`
- Keep: `apps/mobile/src/lib/shell-controllers/terminal-transport.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal.tsx`
- Modify: `apps/mobile/test/integration/shell-terminal-hook-runtime.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-terminal-size-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-terminal-controller-composition.test.ts`

**Interfaces:**

- State: ready/rendered/runtime identity/last size.
- Commands: load, initialize, resize, retry, fit/wait, transport port, and
  terminal UI port.
- View: xterm ref and Xterm callback props.

- [ ] **Step 1: Update terminal tests to final names and handle shape**

Preserve listener-owner detach, first buffer, stale attach, output, ordered
transport, resize dedupe, fit waiter, retry, and disposal coverage.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-*.test.ts
```

Expected: FAIL on missing contracts/final names.

- [ ] **Step 3: Move public types and rename owned protocols**

Keep lifecycle, size, and transport algorithms separate. Fold the generic hook
runtime construction into `terminal-runtime.ts`; make `terminal.tsx` only
create, commit, subscribe, dispose, and build `{ state, commands, view }`.

- [ ] **Step 4: Run and commit**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-*.test.ts test/integration/terminal-*.test.ts && pnpm run typecheck
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Canonicalize terminal controller"
```

### Task 7: Notifications Controller

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/notifications-contracts.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/notifications-core.ts` to
  `apps/mobile/src/lib/shell-controllers/notifications-model.ts`
- Rename:
  `apps/mobile/src/lib/shell-controllers/notifications-route-coordinator.ts` to
  `apps/mobile/src/lib/shell-controllers/notifications-route-runtime.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/notifications.tsx`
- Delete: `apps/mobile/src/lib/shell-controllers/notifications-lifecycle.ts`
- Modify: `apps/mobile/test/integration/shell-notifications-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-notifications-lifecycle.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-notifications-route-controller.test.ts`

**Interfaces:**

- State: route/context/command revisions and handled route.
- Commands: acknowledge visible and invalidate.
- View: `null`.

- [ ] **Step 1: Rewrite tests for final model/runtime and exact handle**

Keep authorization consume/restore, same-route reuse, queued replacement,
context change, stale completion, acknowledgement, activity, pending signal,
logger failure, and disposal tests.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-notifications-*.test.ts
```

Expected: FAIL on old lifecycle/coordinator names.

- [ ] **Step 3: Fold simple effects and retain the real route protocol**

Move activity and pending subscription effects into `notifications.tsx`. Move
automatic acknowledgement identity into the model. Rename the queued route
transaction logic to `notifications-route-runtime.ts` without flattening it.

- [ ] **Step 4: Run and commit**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-notifications-*.test.ts test/integration/shell-activity-notifications-composition.test.ts && pnpm run typecheck
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Canonicalize notifications controller"
```

### Task 8: Activity and Simple Modal Controllers

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/activity-contracts.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/activity-core.ts` to
  `apps/mobile/src/lib/shell-controllers/activity-model.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/activity-app-state.ts` to
  `apps/mobile/src/lib/shell-controllers/activity-platform.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/activity.tsx`
- Create: `apps/mobile/src/lib/shell-controllers/simple-modals-contracts.ts`
- Create: `apps/mobile/src/lib/shell-controllers/simple-modals-model.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/modal-arbiter.ts` to
  `apps/mobile/src/lib/shell-controllers/simple-modals-arbiter-runtime.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/simple-modals.tsx`
- Modify: `apps/mobile/test/integration/shell-activity-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-modal-controller-composition.test.ts`
- Modify: `apps/mobile/test/integration/shell-modals.test.ts`

**Interfaces:**

- Activity handle: state snapshot; commands expose the focused activity port;
  view is `null`.
- Simple modal handle: state; commands group open/close by modal ID; view groups
  `commandMenu`, `commander`, `textEntry`, and `configure` visibility/close
  props.

- [ ] **Step 1: Update tests to exact handles and direct lifecycle ownership**

Preserve AppState/focus generation, replay-safe cleanup, modal open/close,
arbiter registration, and idempotent disposal tests. Assert activity does not
coordinate sibling workflow.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-activity-*.test.ts test/integration/shell-modal-*.test.ts test/integration/shell-modals.test.ts
```

Expected: FAIL on old handles.

- [ ] **Step 3: Convert both small domains**

Move public types to contracts and synchronous state to models. Rename the
AppState platform wrapper and modal arbiter to their owning domains. Keep
AppState subscription in the activity hook and modal registration in the modal
hook. Return canonical handles without refs or prop facades.

- [ ] **Step 4: Run and commit**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-activity-*.test.ts test/integration/shell-modal-*.test.ts test/integration/shell-modals.test.ts && pnpm run typecheck
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Canonicalize activity and modal controllers"
```

### Task 9: Keyboard Controller Protocol Split

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/keyboard-contracts.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/keyboard-state-core.ts` to
  `apps/mobile/src/lib/shell-controllers/keyboard-model.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/keyboard-input-core.ts` to
  `apps/mobile/src/lib/shell-controllers/keyboard-input-runtime.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/keyboard-remote-core.ts` to
  `apps/mobile/src/lib/shell-controllers/keyboard-remote-runtime.ts`
- Rename: `apps/mobile/src/lib/shell-controllers/keyboard-controller-adapter.ts`
  to `apps/mobile/src/lib/shell-controllers/keyboard-action-runtime.ts`
- Create: `apps/mobile/src/lib/shell-controllers/keyboard-activity-runtime.ts`
- Merge: `apps/mobile/src/lib/shell-controllers/activity-keyboard-actions.ts`
  into `apps/mobile/src/lib/shell-controllers/keyboard-activity-runtime.ts`
- Merge:
  `apps/mobile/src/lib/shell-controllers/activity-retained-domain-bridge.ts`
  into `apps/mobile/src/lib/shell-controllers/keyboard-activity-runtime.ts`
- Merge: `apps/mobile/src/lib/shell-controllers/keyboard-input-support.ts` into
  `apps/mobile/src/lib/shell-controllers/keyboard-input-policy.ts`
- Merge: `apps/mobile/src/lib/shell-controllers/keyboard-remote-support.ts` into
  `apps/mobile/src/lib/shell-controllers/keyboard-remote-runtime.ts`
- Split/delete: `apps/mobile/src/lib/shell-controllers/keyboard-hook-runtime.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/keyboard-hook-contracts.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/keyboard-input-contracts.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/keyboard-remote-contracts.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/keyboard-props.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Modify: tests matching `apps/mobile/test/integration/shell-keyboard-*.test.ts`
  and `apps/mobile/test/integration/keyboard-*.test.ts`.
- Replace:
  `apps/mobile/test/integration/shell-activity-keyboard-actions.test.ts` and
  `apps/mobile/test/integration/shell-activity-retained-domain-bridge.test.ts`
  with `apps/mobile/test/integration/shell-keyboard-activity-runtime.test.ts`.

**Interfaces:**

- State: keyboard selection/config/modifiers/system keyboard/selection mode and
  flash.
- Commands: all user input, action dispatch, config reload, Workmux, clipboard,
  selection, invalidation, and focused input capability port.
- View: terminal keyboard, command menu, commander, text entry, and configure
  prop groups.

- [ ] **Step 1: Change tests to final protocol names and handle**

Preserve every keyboard state, input authority, stale runtime, modifier, macro,
clipboard, command step, Workmux, config reload, restart, modal action, and
reentrant callback test. Replace prop-copy tests with view derivation tests.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-*.test.ts test/integration/keyboard-*.test.ts
```

Expected: FAIL on final names and handle.

- [ ] **Step 3: Move public contracts and real protocols**

Keep model, input, remote, and action ownership separate. Move pure macro and
authority transformations to `keyboard-input-policy.ts`. Move remote target and
cancellation policy beside the remote runtime. Move keyboard resume/dismiss
scheduling and activity-triggered keyboard commands into
`keyboard-activity-runtime.ts`; activity no longer coordinates keyboard work.
Build view groups in the hook.

- [ ] **Step 4: Delete the mixed hook runtime**

Move only React construction/commit/subscription/disposal into `keyboard.tsx`.
Move any remaining async ownership to its named runtime. Delete
`keyboard-hook-runtime.ts`, `keyboard-props.ts`, old contracts,
`activity-keyboard-actions.ts`, `activity-retained-domain-bridge.ts`, and old
tests that only prove forwarding.

- [ ] **Step 5: Run size, behavior, and type gates**

```bash
cd apps/mobile && test "$(awk 'NF {n++} END {print n}' src/lib/shell-controllers/keyboard.tsx)" -lt 250 && for f in src/lib/shell-controllers/keyboard-{model,input-runtime,remote-runtime,action-runtime,activity-runtime,input-policy}.ts; do test "$(awk 'NF {n++} END {print n}' "$f")" -lt 350; done && pnpm exec tsx --test test/integration/shell-keyboard-*.test.ts test/integration/keyboard-*.test.ts && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Split keyboard controller by protocol"
```

### Task 10: Scrollback Controller Protocol Split

**Files:**

- Keep/create: `apps/mobile/src/lib/shell-controllers/scrollback-contracts.ts`
- Replace: `apps/mobile/src/lib/shell-controllers/scrollback-core.ts` with
  `apps/mobile/src/lib/shell-controllers/scrollback-model.ts`
- Create:
  `apps/mobile/src/lib/shell-controllers/scrollback-remote-copy-runtime.ts`
- Create: `apps/mobile/src/lib/shell-controllers/scrollback-cleanup-runtime.ts`
- Rename/merge:
  `apps/mobile/src/lib/shell-controllers/scrollback-live-input-coordinator.ts`
  to `apps/mobile/src/lib/shell-controllers/scrollback-input-runtime.ts`
- Keep: `apps/mobile/src/lib/shell-controllers/scrollback-policy.ts`
- Delete:
  `apps/mobile/src/lib/shell-controllers/scrollback-batch-coordinator.ts`
- Delete:
  `apps/mobile/src/lib/shell-controllers/scrollback-cleanup-coordinator.ts`
- Delete:
  `apps/mobile/src/lib/shell-controllers/scrollback-clear-coordinator.ts`
- Delete:
  `apps/mobile/src/lib/shell-controllers/scrollback-entry-coordinator.ts`
- Delete:
  `apps/mobile/src/lib/shell-controllers/scrollback-failure-coordinator.ts`
- Delete:
  `apps/mobile/src/lib/shell-controllers/scrollback-local-ui-coordinator.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/scrollback-mode-coordinator.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/scrollback-callback-safety.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/scrollback-channel-teardown.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/scrollback-operation-owner.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/scrollback.tsx`
- Modify: tests matching
  `apps/mobile/test/integration/shell-scrollback-*.test.ts` and
  `apps/mobile/test/integration/tmux-scrollback-*.test.ts`.

**Interfaces:**

- State: active phase and terminal runtime identity.
- Commands: clear, jump to live, invalidate, guarded input, and Xterm event
  commands.
- View: visibility and Xterm scrollback props.

- [ ] **Step 1: Retarget tests to the four final private units**

Preserve remote entry/mode/batch/ack, operation ownership, cleanup barrier,
channel retirement, clear, callback failure, local UI, live input, stale
runtime, activity, and repeated disposal behavior.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-scrollback-*.test.ts test/integration/tmux-scrollback-*.test.ts
```

Expected: FAIL on final unit names and handle.

- [ ] **Step 3: Merge by owned protocol**

Move synchronous snapshot publication to the model. Merge entry, mode, batch,
operation owner, and failure coordination into remote-copy runtime. Merge
cleanup, clear, callback safety, and channel teardown into cleanup runtime. Keep
guarded input separate and policy pure.

- [ ] **Step 4: Rebuild the public hook and delete old files**

The hook creates four units once, commits ports/identity in a layout effect,
disposes in a passive effect, and builds one handle. Delete every replaced
coordinator file and its forwarding-only tests in the same edit.

- [ ] **Step 5: Run size, behavior, and type gates**

```bash
cd apps/mobile && test "$(awk 'NF {n++} END {print n}' src/lib/shell-controllers/scrollback.tsx)" -lt 250 && for f in src/lib/shell-controllers/scrollback-{model,remote-copy-runtime,cleanup-runtime,input-runtime,policy}.ts; do test "$(awk 'NF {n++} END {print n}' "$f")" -lt 350; done && pnpm exec tsx --test test/integration/shell-scrollback-*.test.ts test/integration/tmux-scrollback-*.test.ts && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Split scrollback controller by protocol"
```

### Task 11: Session and Wispr Controllers

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/session-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/session.tsx`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/wispr.tsx`
- Modify: `apps/mobile/test/integration/shell-session-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-session-workmux.test.ts`
- Modify: `apps/mobile/test/integration/shell-wispr-controller.test.ts`

**Interfaces:**

- Session handle: session snapshot; session lifecycle and focused terminal,
  Workmux, host, diagnostic, and activity capability commands; render state.
- Wispr handle: automation snapshot;
  open/settings/auto-start/focus/change/close/ invalidate commands; text-entry
  view props.

- [ ] **Step 1: Update prerequisite tests to exact canonical handles**

Keep all route/session/Workmux cleanup and Wispr retry/timeout/pending-close/
dispose tests. Add exact-key coverage and private-import boundary checks.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-*.test.ts test/integration/shell-wispr-controller.test.ts
```

Expected: FAIL because prerequisite handles are not canonical.

- [ ] **Step 3: Repackage without changing ownership**

Move public types to contracts. Keep session state, diagnostics, Workmux, Wispr
tap, Wispr close, and Wispr model as their existing focused private units. Only
the hooks and returned handles change shape.

- [ ] **Step 4: Run and commit**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-*.test.ts test/integration/shell-wispr-controller.test.ts test/integration/wispr-automation.test.ts && pnpm run typecheck
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration
git commit -m "Canonicalize session and Wispr controllers"
```

### Task 12: Architecture Gate and Legacy Layer Deletion

**Files:**

- Create: `apps/mobile/test/integration/shell-controller-architecture.test.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/controller-lifecycle.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/generation-request-gate.ts`
- Delete: `apps/mobile/test/integration/generation-request-gate.test.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/shell-command-lifecycle.ts`
- Delete: `apps/mobile/test/integration/shell-command-lifecycle.test.ts`
- Delete: `apps/mobile/src/lib/shell-controllers/shell-terminal-live-input.ts`
- Delete:
  `apps/mobile/test/integration/shell-terminal-live-input-adapter.test.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/src/app/shell/ShellScreenView.tsx`
- Modify: remaining production imports under `apps/mobile/src/` that point to a
  renamed controller file.

**Interfaces:**

- Produces: one automatic final shape and dependency-direction gate.

- [ ] **Step 1: Write the failing full architecture test**

The test enumerates these public domains:

```ts
const domains = [
	'activity',
	'browser-actions',
	'feature-request',
	'keyboard',
	'notifications',
	'scrollback',
	'session',
	'simple-modals',
	'skill-selector',
	'terminal',
	'wispr',
] as const;
```

For each domain, assert the hook and contracts file exist. Parse production
filenames and fail on:

```ts
const forbiddenNames =
	/(?:adapter|facade|modal-props|hook-runtime|support|coordinator)\.(?:ts|tsx)$/;
```

Assert `controller-lifecycle.ts` and `generation-request-gate.ts` are absent;
assert the unused `shell-command-lifecycle.ts` and
`shell-terminal-live-input.ts` helpers are absent; public hooks are below 250
nonblank lines; private model/runtime/policy files are below 350; `detail.tsx`
imports only public hook/contracts files; and behavior tests do not read
`detail.tsx` for controller implementation strings.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-controller-architecture.test.ts
```

Expected: FAIL on remaining legacy names/imports.

- [ ] **Step 3: Delete shared legacy layers and update imports**

Inline each hook's small source commit and replay-safe setup. Delete the unused
generation gate and the two production-unreferenced shell lifecycle/input
helpers with their isolated tests. Update `ShellDetail` and `ShellScreenView` to
read `.state`, `.commands`, and `.view`; pass focused command ports rather than
full sibling handles.

- [ ] **Step 4: Remove brittle composition tests**

Move behavior assertions to owning model/runtime tests. Keep only the final
architecture test and the separate `shell-detail-boundary.test.ts` for source
shape. Delete tests that assert local variable names, forwarding calls, or old
file placement.

- [ ] **Step 5: Run architecture, shell, and type gates**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-controller-architecture.test.ts test/integration/shell-detail-boundary.test.ts test/integration/shell-*.test.ts && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Enforce canonical shell controllers"
```

### Task 13: Full Verification and Maintainability Review

**Files:**

- Verify: all files changed in Tasks 1-12.

- [ ] **Step 1: Run modal and architecture gates**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modal-frame.test.ts test/integration/shell-controller-architecture.test.ts test/integration/shell-detail-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full mobile checks**

```bash
cd apps/mobile && pnpm run fmt:check && pnpm run lint:check && pnpm run typecheck && pnpm run test:integration
```

Expected: all commands exit 0 without warnings or unhandled rejections.

- [ ] **Step 3: Run repository checks**

```bash
pnpm exec turbo lint:check
```

Expected: Turbo, syncpack, and jscpd checks exit 0.

- [ ] **Step 4: Run the thermo-nuclear review**

Invoke `$thermo-nuclear-code-quality-review` on the complete diff. It must find
no replacement giant files, facade/adapter chains, pass-through view builders,
sibling private imports, render-time mutation, boolean state-machine growth, or
unowned async cleanup. Fix every blocker with a new RED-GREEN cycle, then rerun
Steps 1-3.

- [ ] **Step 5: Build and manually check the local Android preview**

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Use the existing signing lane. Without clearing data, check all eight standard
modal sizes, backdrop close, Android Back, keyboard avoidance, header actions,
local reset, TextEntry dragging, terminal attach/reload, scrollback, keyboard,
notifications, browser actions, feature request, skill selector, Wispr, and
reconnect behavior.

- [ ] **Step 6: Record evidence and commit review fixes**

Record test counts, final controller file inventory and line counts, deleted
layer list, preview artifact path, modal observations, and thermo-nuclear review
result in the pull request. If review fixes changed code:

```bash
git add apps/mobile
git commit -m "Harden shell controller consolidation"
```
