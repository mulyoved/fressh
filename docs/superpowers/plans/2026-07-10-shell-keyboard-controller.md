# Shell Keyboard Controller and Final Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move keyboard/config state, all user-input adapters, command
scheduling, Workmux navigation/status cycling, config reload, Codex restart, and
slot dispatch out of `detail.tsx`, then complete issue #83's coordinator audit.

**Architecture:** Use three focused cores: keyboard state/history, guarded
input/step scheduling, and remote command requests. A thin hook composes those
cores with clipboard/system-keyboard subscriptions, animation, modal/browser
command ports, existing pure keyboard helpers, terminal view commands, and the
scrollback input port; `detail.tsx` renders returned prop bundles and retains
only the excluded Wispr wiring.

**Tech Stack:** TypeScript 5.9, React 19, React Native Animated/Keyboard, Expo
Clipboard/Linking, Workmux control channel, Node `tsx --test`, pnpm/Turbo,
Android EAS preview build.

## Global Constraints

- Start from the merged scrollback-controller PR.
- Every user-originated terminal payload—including WebView/system-keyboard
  input—must use `scrollback.input.sendSegments`.
- Preserve modifier order, one-shot keyboard return, macros, command-step
  delays, paste semantics, and text-entry history behavior.
- Preserve system keyboard and selection-mode transitions, resume dismissal, and
  keyboard-switch flash timing/copy.
- Keep Workmux status cycling in the keyboard remote-command core.
- Preserve Workmux runner serialization, one pending replacement, stale failure
  suppression, nav scope, and transport-unhealthy reconnect behavior.
- Preserve runtime config reload and Codex restart copy, timeouts, failure
  presentation, command bridge behavior, and stale suppression.
- Consume modals/browser/Wispr/debug/fit through injected command ports; the
  keyboard controller must not import another controller.
- Do not extract Wispr internals or change the text-entry UI.
- Final `detail.tsx` target is 1,400-1,800 lines, with responsibilities taking
  precedence over the soft count.

---

## File Structure

**Create:**

- `apps/mobile/src/lib/shell-controllers/keyboard-state-core.ts` — config,
  selection, modifiers, system/selection mode, and text history.
- `apps/mobile/src/lib/shell-controllers/keyboard-input-core.ts` — all payload
  adapters, step timers, presets, macros, and WebView input.
- `apps/mobile/src/lib/shell-controllers/keyboard-remote-core.ts` —
  Workmux/status queue, config reload, and Codex restart lifecycle.
- `apps/mobile/src/lib/shell-controllers/keyboard.tsx` —
  React/platform/action-context adapter and view props.
- `apps/mobile/test/integration/shell-keyboard-state-controller.test.ts`
- `apps/mobile/test/integration/shell-keyboard-input-controller.test.ts`
- `apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts`
- `apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts`

**Modify:**

- `apps/mobile/src/app/shell/detail.tsx` — consume keyboard controller and
  remove extracted ownership.
- `apps/mobile/test/integration/keyboard-actions.test.ts`
- `apps/mobile/test/integration/keyboard-routing.test.ts`
- `apps/mobile/test/integration/keyboard-runtime.test.ts`
- `apps/mobile/test/integration/terminal-input-payloads.test.ts`
- `apps/mobile/test/integration/codex-restart.test.ts`
- `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

## Published Interfaces

```ts
export type ShellKeyboardModalCommands = {
	toggleCommandMenu(): void;
	openCommander(): void;
	openSkillSelector(): void;
	openBrowserActions(): void;
	openFeatureRequest(): void;
	openWisprTextEditor(): void;
	openConfigurator(): void;
	closeCommandMenu(): void;
};

export type ShellKeyboardBrowserCommands = {
	openDiff(): void;
	openUrlSlot(slot: HostBrowserUrlSlot): void;
	openDetected(mode: 'auto' | 'pick'): void;
	editUrlSlot(slot: HostBrowserUrlSlot): void;
};

export type ShellKeyboardControllerHandle = {
	keyboard: KeyboardDefinition | null;
	macros: readonly MacroDef[];
	modifierKeysActive: readonly ModifierKey[];
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	flash: { name: string | null; opacity: Animated.Value };
	shellConfigState: ShellConfigState;
	terminalKeyboardProps: {
		keyboard: KeyboardDefinition | null;
		modifierKeysActive: ModifierKey[];
		onSlotPress(slot: KeyboardExecutableItem): void;
		selectionModeEnabled: boolean;
		onCopySelection(): void;
		navScope: WorkmuxNavScope;
	};
	commandMenuProps: {
		entries: CommandMenuEntry[];
		onSelect(preset: CommandPreset): void;
		onAction(actionId: ActionId): void;
		onBridge(entry: CommandBridgeEntry): void;
	};
	commanderProps: {
		onExecuteCommand(value: string): void;
		onPasteText(value: string): void;
		onSendShortcut(sequence: string): void;
	};
	textEntryProps: {
		onPaste(value: string): void;
		history: TextEntryHistoryModalProps;
	};
	configureProps: {
		onDevServer(): void;
		onReloadConfig(): void;
		onHostConfig(): void;
		onRequestFeature(): void;
		onOpenGitHubIssues(): void;
		onOpenShellConfigDocs(): void;
		configVersion: string;
		configUpdatedAt: string;
		configSource: string;
		configLastLoadedAt: string | null;
		configLastError: string | null;
	};
	onWebViewInput(input: { str: string; instanceId: string }): void;
	onSelectionChanged(text: string): void;
	onSelectionModeChange(enabled: boolean): void;
	onCommandBridgeEntry(entry: CommandBridgeEntry): void;
	invalidate(reason: ControllerInvalidationReason): void;
};
```

The prop bundles above live in `keyboard.tsx`; pure cores do not import shell
components.

---

### Task 1: Keyboard State, Selection, Modifiers, and History

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/keyboard-state-core.ts`
- Create: `apps/mobile/test/integration/shell-keyboard-state-controller.test.ts`

**Interfaces:**

- Consumes: shell-config helpers/types, modifier definitions moved from the
  bottom of `detail.tsx`, and `textEntryHistoryStore` injected through a small
  port.
- Produces: `createShellKeyboardStateCore`, `ShellKeyboardStateCore`, current
  keyboard/macros/config/history snapshots, selection/mode commands, and
  modifier application.

- [ ] **Step 1: Write failing selection/modifier/history tests**

```ts
void test('keyboard state rotates active keyboards and returns from one-shot keyboard', () => {
	const harness = createKeyboardStateHarness();
	assert.equal(harness.core.getSnapshot().selectedKeyboardId, 'main');
	harness.core.rotateKeyboard();
	assert.equal(harness.core.getSnapshot().selectedKeyboardId, 'advanced');
	harness.core.completeSlotPress();
	assert.equal(harness.core.getSnapshot().selectedKeyboardId, 'main');
});

void test('keyboard state applies modifiers in contract order', () => {
	const harness = createKeyboardStateHarness();
	harness.core.toggleModifier('shift');
	harness.core.toggleModifier('ctrl');
	assert.deepEqual(
		Array.from(harness.core.applyModifiers(new Uint8Array([0x61]))),
		[0x01],
	);
});

void test('keyboard state refreshes text history after accepted paste', () => {
	const harness = createKeyboardStateHarness();
	harness.core.recordAcceptedTextPaste('hello');
	assert.deepEqual(
		harness.core.getSnapshot().history.recent.map((entry) => entry.text),
		['hello'],
	);
});
```

Define a minimal two-keyboard shell config and in-memory history store in the
test harness. Import the real modifier types and config helpers.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-state-controller.test.ts
```

Expected: FAIL because `keyboard-state-core.ts` is missing.

- [ ] **Step 3: Implement state ownership**

Move shell config state, keyboard maps/active IDs, preferred/selected keyboard,
current macros, modifier state, system-keyboard flag, selection-mode flag,
text-entry history state/sections/cycle entries, keyboard rotation, explicit
selection, one-shot return, modifier contracts, and history mutations into the
core. Export modifier contracts from this file; remove them from `detail.tsx`
only during Task 5 integration.

Use `createControllerPublisher` and publish immutable snapshots. Provide these
commands:

```ts
setShellConfigState(state: ShellConfigState): void;
rotateKeyboard(): void;
selectKeyboardIfExists(id: string): void;
completeSlotPress(): void;
toggleModifier(modifier: ModifierKey): void;
applyModifiers(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
setSystemKeyboardEnabled(enabled: boolean): void;
setSelectionModeEnabled(enabled: boolean): void;
recordAcceptedTextPaste(text: string): void;
pinHistoryText(text: string): void;
pinHistoryEntry(id: string): void;
unpinHistoryEntry(id: string): void;
deleteHistoryEntry(id: string): void;
clearRecentHistory(): void;
```

- [ ] **Step 4: Run state and existing pure keyboard tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-keyboard-state-controller.test.ts \
  test/integration/keyboard-config.test.ts \
  test/integration/keyboard-routing.test.ts \
  test/integration/text-entry-history.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/keyboard-state-core.ts apps/mobile/test/integration/shell-keyboard-state-controller.test.ts
git commit -m "refactor(mobile): isolate shell keyboard state"
```

---

### Task 2: Guarded Input Adapters, Steps, Presets, and Macros

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/keyboard-input-core.ts`
- Create: `apps/mobile/test/integration/shell-keyboard-input-controller.test.ts`

**Interfaces:**

- Consumes: state core from Task 1, `ShellScrollbackInputPort`, terminal view
  port, activity getter, `runMacro`, terminal payload helpers, and injected
  clock.
- Produces: `ShellKeyboardInputCore`, send byte/text commands, WebView input,
  clipboard/text-entry paste, command steps/presets, slot dispatch helpers,
  `invalidate`, and `dispose`.

- [ ] **Step 1: Write failing all-inputs-use-scrollback tests**

```ts
void test('keyboard input routes bytes text WebView and text paste through scrollback', async () => {
	const harness = createKeyboardInputHarness();
	await harness.core.sendBytes(new Uint8Array([0x1b]));
	await harness.core.sendText('a');
	await harness.core.onWebViewInput({ str: 'b', instanceId: 'instance-1' });
	await harness.core.pasteTextEntry('hello');
	assert.deepEqual(harness.sent, [
		[[0x1b]],
		[[0x61]],
		[[0x62]],
		[[0x68, 0x65, 0x6c, 0x6c, 0x6f], [0x0d]],
	]);
});

void test('keyboard input records text history only after scrollback accepts payload', async () => {
	const harness = createKeyboardInputHarness({ inputOutcome: 'unavailable' });
	await harness.core.pasteTextEntry('blocked');
	assert.deepEqual(harness.recordedHistory, []);
	harness.setInputOutcome('completed');
	await harness.core.pasteTextEntry('accepted');
	assert.deepEqual(harness.recordedHistory, ['accepted']);
});

void test('keyboard input invalidation cancels scheduled command steps', () => {
	const harness = createKeyboardInputHarness();
	harness.core.runCommandSteps([
		{ type: 'text', data: 'a' },
		{ type: 'enter', delayMs: 50 },
	]);
	harness.clock.advanceBy(0);
	harness.core.invalidate('focus-lost');
	harness.clock.advanceBy(50);
	assert.deepEqual(harness.sent, [[[0x61]]]);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-input-controller.test.ts
```

Expected: FAIL because the input core is missing.

- [ ] **Step 3: Implement every payload adapter**

Move `sendBytesWithModifiers`, `sendTextRaw`, `sendTextWithModifiers`, command
timeout clearing, `sendCommandStep`, `runCommandSteps`, presets, clipboard
payload acceptance, text-entry paste acceptance/history callback, and
WebView/system input into the core. All final sends call only
`scrollbackInput.sendSegments`; no shell/terminal writer is accepted as a
dependency. Preserve 50 ms default command-step spacing and 10 ms text/Enter
spacing from `scrollbackExitDelayMs`.

Reject WebView events whose instance ID is not current according to terminal
view. Exit selection mode for input/commands except explicit copy. Resolve
`ControllerOutcome` so scheduled stale work stops without feedback.

- [ ] **Step 4: Add slot/macro dispatch and run focused tests**

Move `handleSlotPress` decision logic into the core, but inject `runAction` so
the core does not import modal/platform controllers. Reuse
`planDetectedOpenShortcutPress`, `runKeyboardActionSlot`, and `runMacro`.

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-keyboard-input-controller.test.ts \
  test/integration/keyboard-runtime.test.ts \
  test/integration/keyboard-actions.test.ts \
  test/integration/terminal-input-payloads.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/keyboard-input-core.ts apps/mobile/test/integration/shell-keyboard-input-controller.test.ts
git commit -m "refactor(mobile): centralize guarded keyboard input"
```

---

### Task 3: Workmux, Status, Config Reload, and Codex Restart Core

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/keyboard-remote-core.ts`
- Create:
  `apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts`

**Interfaces:**

- Consumes: activity/target context, Workmux control channel port, state core,
  existing `createWorkmuxKeyboardCommandRunner`, `restartCodexWithBridge`, and
  runtime config reload.
- Produces: `ShellKeyboardRemoteCore`, `runWorkmuxCommand`, `reloadConfig`,
  `restartCodex`, `handleCommandBridgeEntry`, `invalidate`, and `dispose`.

- [ ] **Step 1: Write failing stale status/config/restart tests**

```ts
void test('keyboard remote core suppresses stale status failure', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.runWorkmuxCommand({ type: 'status-cycle' });
	harness.core.invalidate('focus-lost');
	harness.workmux.reject(new Error('status failed'));
	assert.deepEqual(await pending, { status: 'superseded' });
	assert.deepEqual(harness.alerts, []);
});

void test('keyboard remote core ignores config completion after target replacement', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.reloadConfig();
	harness.core.setTargetContext(harness.target('other'));
	harness.reload.resolve(harness.configState('remote'));
	await pending;
	assert.deepEqual(harness.appliedConfigs, []);
	assert.deepEqual(harness.alerts, []);
});

void test('keyboard remote core prevents stale Codex operation and failure alert', async () => {
	const harness = createKeyboardRemoteHarness();
	const pending = harness.core.restartCodex();
	harness.contextCommand.resolve(harness.workmuxContext());
	harness.core.invalidate('app-inactive');
	await pending;
	assert.equal(harness.restartOperations.length, 0);
	assert.deepEqual(harness.alerts, []);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-remote-controller.test.ts
```

Expected: FAIL because the remote core is missing.

- [ ] **Step 3: Implement Workmux runner and failure ownership**

Move the Workmux runner construction, current tmux/session/nav getters,
instrumented Workmux command adapter, failure classification, alert, and
transport invalidation into the remote core. Reuse
`createWorkmuxKeyboardCommandRunner` unchanged. `setTargetContext` invalidates
the existing runner before changing the target. Activity invalidation calls
runner `invalidate()` before any visible state reset.

- [ ] **Step 4: Implement config reload and Codex restart generations**

Move runtime config request generation and Codex restart generation/in-flight
state into the core. `reloadConfig` closes the command menu, captures
generation/activity/target, applies current success through
`keyboardState.setShellConfigState`, and preserves exact success/failure Alert
copy. `restartCodex` snapshots the Workmux channel, prevents concurrent starts,
checks generation before bridge operation and feedback, preserves optional
timeout from command bridge entries, and clears in-flight only when its own
generation is current.

- [ ] **Step 5: Run remote and existing command tests**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-keyboard-remote-controller.test.ts \
  test/integration/keyboard-actions.test.ts \
  test/integration/codex-restart.test.ts \
  test/integration/shell-workmux-keyboard-policy.test.ts \
  test/integration/shell-config-store.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/keyboard-remote-core.ts apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts
git commit -m "refactor(mobile): isolate shell remote keyboard commands"
```

---

### Task 4: React Hook, Platform Keyboard, Action Context, and View Props

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Modify: `apps/mobile/test/integration/shell-keyboard-state-controller.test.ts`
- Modify: `apps/mobile/test/integration/shell-keyboard-input-controller.test.ts`

**Interfaces:**

- Consumes: all three cores, activity, terminal/scrollback ports, modal/browser
  command ports, manual fit/debug commands, nav preference, and shell
  components' prop types.
- Produces: `useShellKeyboardController` and `ShellKeyboardControllerHandle`.

- [ ] **Step 1: Add failing activity/system-keyboard tests to the pure harness**

```ts
void test('keyboard activity transition restores or dismisses Android keyboard once', () => {
	const harness = createKeyboardInputHarness({ platformOS: 'android' });
	harness.core.noteSystemKeyboardVisibility(true);
	harness.core.onActivityChanged({ interactive: false, generation: 1 });
	harness.core.onActivityChanged({ interactive: true, generation: 2 });
	assert.deepEqual(harness.systemKeyboardCommands, [
		'remember:true',
		'enable:true',
	]);
	harness.clock.advanceBy(150);
	assert.deepEqual(harness.dismissCalls, []);
});
```

Add the complementary disabled/previously-hidden case and assert one immediate
dismiss plus one 150 ms scheduled dismiss.

- [ ] **Step 2: Implement the hook composition**

The hook creates the three cores, subscribes to keyboard state with
`useSyncExternalStore`, updates target/activity dependencies, and disposes all
cores on unmount. Add one Android `Keyboard.addListener` pair for
`keyboardDidShow`/`keyboardDidHide`; forward visibility to the input core.

Keep keyboard-switch animation in this hook with the current values: opacity 1,
400 ms delay, 800 ms fade, native driver, no flash on first mount, and stop on
cleanup. Build the `ActionContext` using only injected modal/browser/fit/debug
ports plus remote/input/state core commands. Keep `runAction` and
`runKeyboardActionSlot` as pure routing helpers.

Clipboard reads and writes use Expo Clipboard. Selection copy calls
`terminal.view.getSelection()`, records duplicate suppression, writes clipboard,
exits selection, and applies one-shot keyboard return. System keyboard and
selection mode user commands update state then call terminal view commands.

- [ ] **Step 3: Build exact component prop bundles**

Return memoized props for:

- `TerminalKeyboard`: current keyboard, modifiers, selection flag, nav scope,
  `onSlotPress`, and copy-selection command.
- `CommandMenuModal`: shell config command menus and preset/action callbacks.
- `TerminalCommanderModal`: execute/paste callbacks through input core.
- `TextEntryModal`: history lists and accepted-paste/history mutation callbacks;
  Wispr-specific props remain supplied by `detail.tsx`.
- `ConfigureModal`: config metadata and reload/host/docs/issues/dev-server
  commands.

Return WebView input/selection callbacks and command bridge callback separately
as shown in Published Interfaces.

- [ ] **Step 4: Run focused hook-adjacent suites and typecheck**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-keyboard-state-controller.test.ts \
  test/integration/shell-keyboard-input-controller.test.ts \
  test/integration/shell-keyboard-remote-controller.test.ts \
  test/integration/terminal-keyboard-component.test.ts \
  test/integration/command-menu.test.ts \
  test/integration/text-entry-history.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-controllers/keyboard.tsx apps/mobile/src/lib/shell-controllers/keyboard-*-core.ts apps/mobile/test/integration/shell-keyboard-*.test.ts
git commit -m "refactor(mobile): add shell keyboard controller hook"
```

---

### Task 5: Compose Keyboard Controller and Complete Issue #83 Audit

**Files:**

- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Create:
  `apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

**Interfaces:**

- Consumes: `useShellKeyboardController`, modal/browser ports from PR 1,
  activity from PR 2, terminal from PR 3, and scrollback from PR 4.
- Produces: final issue #83 coordinator boundary.

- [ ] **Step 1: Write the failing responsibility guard**

```ts
void test('shell detail delegates keyboard command workflow', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.match(source, /useShellKeyboardController\(\{/);
	for (const legacy of [
		'preferredKeyboardId',
		'modifierKeysActive',
		'commandTimeoutsRef',
		'workmuxKeyboardCommandRunner',
		'codexRestartGenerationRef',
		'codexRestartInFlightRef',
		'runtimeShellConfigReloadRequestIdRef',
		'systemKeyboardVisibleRef',
		'lastKeyboardVisibleRef',
	]) {
		assert.doesNotMatch(source, new RegExp(legacy));
	}
});

void test('shell detail remains an explicit composition root', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	assert.doesNotMatch(source, /useShellController\(/);
	assert.match(source, /useShellTerminalController\(/);
	assert.match(source, /useShellScrollbackController\(/);
	assert.match(source, /useShellKeyboardController\(/);
});
```

Add standard Node imports.

- [ ] **Step 2: Run and verify failure**

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-controller-composition.test.ts
```

Expected: FAIL because keyboard ownership remains inline.

- [ ] **Step 3: Replace inline keyboard/config/action code**

Build typed modal/browser command ports in `detail.tsx` from the focused
controller handles and Wispr-aware callbacks. Construct
`useShellKeyboardController` with activity, terminal, scrollback, Workmux,
connection/store diagnostics, nav preference, manual fit/debug commands, modal
ports, logger, and platform dependencies.

Replace terminal/command/commander/text-entry/configure JSX props with returned
bundles. Replace WebView input/selection-mode/selection callbacks and command
bridge handling. Remove config/keyboard/history/modifier/system-keyboard state,
animations, refs, AppState reactions, command timers, Workmux runner, config
reload, Codex restart, action context, slot dispatch, modifier contracts, and
now-unused imports from `detail.tsx`. Keep Wispr state/callbacks and pass only
its props into the text-entry bundle.

- [ ] **Step 4: Run architecture checks and measure the coordinator**

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/shell-modal-controller-composition.test.ts \
  test/integration/shell-activity-notifications-composition.test.ts \
  test/integration/shell-terminal-controller-composition.test.ts \
  test/integration/shell-scrollback-controller-composition.test.ts \
  test/integration/shell-keyboard-controller-composition.test.ts && \
wc -l src/app/shell/detail.tsx
```

Expected: all architecture tests PASS. Expected line count: 1,400-1,800. If the
count is outside the soft range, inspect responsibilities; move only named
controller workflow still present, and do not extract Wispr or rendering solely
to satisfy the number.

- [ ] **Step 5: Run complete automated verification**

```bash
cd apps/mobile && pnpm run fmt:check && pnpm run lint:check && pnpm run typecheck && pnpm run test:integration
```

Expected: formatting completes and lint/typecheck/full integration suite exit
zero.

- [ ] **Step 6: Build and perform manual Android preview verification**

```bash
cd apps/mobile && \
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android
```

Expected: local preview APK build succeeds. Install only through the existing
signing lane for `com.finalapp.vibe2`; do not uninstall or clear data. Manually
verify terminal attach/reload/rotation/fit, configured and system keyboard
input, modifier/macro/preset actions, scrollback entry/exit/live input, browser
and feature-request modals, Workmux navigation/status cycling, notification
route/acknowledgement, and Wispr text entry regression behavior.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/mobile/src/app/shell/detail.tsx \
  apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts \
  apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts
git commit -m "refactor(mobile): compose shell keyboard controller"
```

## PR 5 and Issue #83 Completion Check

- [ ] `detail.tsx` composes focused controllers and retains only
      route/connection setup, tmux configuration, Wispr, rendering, and error
      boundaries.
- [ ] Every controller has an explicit identity, view state, commands,
      invalidation, disposal, and local lifecycle tests.
- [ ] No controller imports another controller; cross-domain behavior uses
      injected ports.
- [ ] All user input routes through `scrollback.input` and terminal leases.
- [ ] Full mobile integration, lint, typecheck, formatting, preview build, and
      manual checks pass.
- [ ] Issue #83 is updated with all five PRs; issue #6 remains closed and issue
      #130 remains the Wispr follow-up.
