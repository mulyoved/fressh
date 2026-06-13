# Workmux Nav Scope Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four Workmux window-nav buttons on the advanced and tmux keyboards with `Prev`, `Next`, and a sticky 3-level scope toggle (`Active` ⊂ `+Busy` ⊂ `All`) that controls which windows `Prev`/`Next` walk.

**Architecture:** The app holds the chosen scope locally (MMKV preference) and appends `--scope <active|visible|all>` to `mdev tmux app nav next|prev`. mdev (external repo) does the actual filtering. The toggle button is a new on-keyboard control that cycles the local scope and renders a segmented pill of the current level. `next-all`/`prev-all` and the `WORKMUX_NAV_*_ALL` action IDs are kept unchanged as a back-compat "all" shortcut so `phone_base` is untouched.

**Tech Stack:** React Native (Expo), TypeScript, react-native-mmkv, node:test via `tsx --test`.

---

> ## ⚠️ Hard external dependency: mdev `--scope`
>
> After Task 6, the app sends `--scope` on **every** `next`/`prev` (including `phone_base`'s nav). An mdev build that does not understand `--scope` will reject those commands and window nav will break. **Ship the `--scope active|visible|all` support in `mulyoved/skills` first** (semantics: `active` = ✅/💬 only; `visible` = ✅+🤖, exclude hidden; `all` = every window, same as `*-all`). All tasks below are unit-testable without mdev; only the end-to-end smoke test in Task 8 needs a `--scope`-capable mdev.

## File structure

- **Modify** `apps/mobile/src/lib/workmux-app-commands.ts` — `WorkmuxNavScope` type + helpers; `--scope` support in `buildWorkmuxAppNavArgv`/`buildWorkmuxAppNavCommand`; command-token quoting fix.
- **Modify** `apps/mobile/src/lib/workmux-bridge-operations.ts` — parse scoped nav argv into bridge params.
- **Modify** `apps/mobile/src/lib/preferences.tsx` — sticky `workmuxNavScope` preference (global, default `active`).
- **Modify** `apps/mobile/src/lib/keyboard-actions.ts` — runner injects scope on `next`/`prev`; `WORKMUX_CYCLE_NAV_SCOPE` action; `ActionContext.cycleNavScope`; register the action id.
- **Create** `apps/mobile/src/app/shell/components/WorkmuxScopeToggleKey.tsx` — the segmented-pill key.
- **Modify** `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx` — `navScope` prop + render branch for the toggle slot.
- **Modify** `apps/mobile/src/app/shell/detail.tsx` — wire `getNavScope`, `cycleNavScope`, and the `navScope` prop.
- **Modify** `apps/mobile/config/shell-config.json` — consolidate nav clusters on `advanced_keyboard` and `tmux_keyboard`.
- **Tests:** `workmux-app-commands.test.ts`, `workmux-bridge-operations.test.ts`, `keyboard-actions.test.ts`, `keyboard-config.test.ts`.

**All commands below run from `apps/mobile/`.** Single test file: `pnpm exec tsx --test test/integration/<file>`. Typecheck: `pnpm typecheck`. Each task ends green (typecheck + touched tests pass); the changes are additive so intermediate commits never break the build.

---

### Task 1: Scope type, helpers, and `--scope` argv

**Files:**
- Modify: `apps/mobile/src/lib/workmux-app-commands.ts`
- Test: `apps/mobile/test/integration/workmux-app-commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/integration/workmux-app-commands.test.ts` (it already imports the builders; add `buildWorkmuxAppNavArgv`, `buildWorkmuxAppNavCommand`, `isWorkmuxNavScope`, `nextWorkmuxNavScope` to the import block from `../../src/lib/workmux-app-commands`):

```ts
void test('buildWorkmuxAppNavArgv appends --scope for next/prev', () => {
	assert.deepEqual(
		buildWorkmuxAppNavArgv('main', 'next', undefined, 'visible'),
		['tmux', 'app', 'nav', 'next', '--session', 'main', '--scope', 'visible'],
	);
	assert.deepEqual(
		buildWorkmuxAppNavArgv('main', 'prev', undefined, 'active'),
		['tmux', 'app', 'nav', 'prev', '--session', 'main', '--scope', 'active'],
	);
});

void test('buildWorkmuxAppNavArgv omits --scope when scope is undefined', () => {
	assert.deepEqual(buildWorkmuxAppNavArgv('main', 'next-all'), [
		'tmux',
		'app',
		'nav',
		'next-all',
		'--session',
		'main',
	]);
});

void test('buildWorkmuxAppNavArgv rejects scope on non next/prev actions', () => {
	assert.throws(
		() => buildWorkmuxAppNavArgv('main', 'next-all', undefined, 'all'),
		/Unexpected Workmux nav scope/,
	);
});

void test('buildWorkmuxAppNavCommand keeps flags unquoted and values quoted', () => {
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'next', undefined, 'visible'),
		"mdev tmux app nav 'next' --session 'main' --scope 'visible'",
	);
});

void test('nextWorkmuxNavScope rotates active -> visible -> all -> active', () => {
	assert.equal(nextWorkmuxNavScope('active'), 'visible');
	assert.equal(nextWorkmuxNavScope('visible'), 'all');
	assert.equal(nextWorkmuxNavScope('all'), 'active');
});

void test('isWorkmuxNavScope guards scope strings', () => {
	assert.equal(isWorkmuxNavScope('visible'), true);
	assert.equal(isWorkmuxNavScope('nope'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test test/integration/workmux-app-commands.test.ts`
Expected: FAIL — `buildWorkmuxAppNavArgv` does not accept a 4th arg / `isWorkmuxNavScope` and `nextWorkmuxNavScope` are not exported.

- [ ] **Step 3: Add the scope type and helpers**

In `src/lib/workmux-app-commands.ts`, just below the existing `WorkmuxNavAction` type (around line 53), add:

```ts
export type WorkmuxNavScope = 'active' | 'visible' | 'all';

export const WORKMUX_NAV_SCOPE_VALUES = [
	'active',
	'visible',
	'all',
] as const satisfies readonly WorkmuxNavScope[];

export function isWorkmuxNavScope(value: string): value is WorkmuxNavScope {
	return (WORKMUX_NAV_SCOPE_VALUES as readonly string[]).includes(value);
}

export function nextWorkmuxNavScope(current: WorkmuxNavScope): WorkmuxNavScope {
	const index = WORKMUX_NAV_SCOPE_VALUES.indexOf(current);
	return WORKMUX_NAV_SCOPE_VALUES[
		(index + 1) % WORKMUX_NAV_SCOPE_VALUES.length
	] as WorkmuxNavScope;
}
```

- [ ] **Step 4: Add `scope` to `buildWorkmuxAppNavArgv`**

Replace the whole `buildWorkmuxAppNavArgv` function (currently around lines 346–381) with:

```ts
export function buildWorkmuxAppNavArgv(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
	scope?: WorkmuxNavScope,
): string[] {
	if (action === 'select') {
		if (scope !== undefined) {
			throw new Error(`Unexpected Workmux nav scope for action: ${action}`);
		}
		if (index === undefined) {
			throw new Error('Missing Workmux nav select index');
		}
		if (!isSafeNonNegativeInteger(index)) {
			throw new Error(`Invalid Workmux nav select index: ${index}`);
		}
		return [
			'tmux',
			'app',
			'nav',
			action,
			String(index),
			'--session',
			normalizeSessionName(sessionName),
		];
	}

	if (index !== undefined) {
		throw new Error(`Unexpected Workmux nav index for action: ${action}`);
	}

	const argv = [
		'tmux',
		'app',
		'nav',
		action,
		'--session',
		normalizeSessionName(sessionName),
	];

	if (scope === undefined) {
		return argv;
	}

	if (action !== 'next' && action !== 'prev') {
		throw new Error(`Unexpected Workmux nav scope for action: ${action}`);
	}
	if (!isWorkmuxNavScope(scope)) {
		throw new Error(`Invalid Workmux nav scope: ${scope}`);
	}

	return [...argv, '--scope', scope];
}
```

- [ ] **Step 5: Add `scope` to `buildWorkmuxAppNavCommand`**

Replace `buildWorkmuxAppNavCommand` (around lines 383–391) with:

```ts
export function buildWorkmuxAppNavCommand(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
	scope?: WorkmuxNavScope,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppNavArgv(sessionName, action, index, scope),
	);
}
```

- [ ] **Step 6: Keep the `--scope` flag unquoted in command form**

In `isMdevCommandToken` (around lines 195–210), the `case 'nav':` line currently reads:

```ts
		case 'nav':
			return tokens[4] === 'select' ? index === 6 : index === 5;
```

Change it to also treat the `--scope` flag position (index 7) as a command token:

```ts
		case 'nav':
			return tokens[4] === 'select'
				? index === 6
				: index === 5 || index === 7;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec tsx --test test/integration/workmux-app-commands.test.ts`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/workmux-app-commands.ts test/integration/workmux-app-commands.test.ts
git commit -m "feat(mobile): add Workmux nav scope helpers and --scope argv" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Parse scoped nav argv in the mdev bridge

**Files:**
- Modify: `apps/mobile/src/lib/workmux-bridge-operations.ts`
- Test: `apps/mobile/test/integration/workmux-bridge-operations.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/integration/workmux-bridge-operations.test.ts` (import `buildMdevBridgeOperationFromWorkmuxArgv` from `../../src/lib/workmux-bridge-operations` if not already imported):

```ts
void test('maps scoped next/prev nav argv to bridge params with scope', () => {
	assert.deepEqual(
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'nav',
			'next',
			'--session',
			'main',
			'--scope',
			'visible',
		]),
		{
			operation: 'tmux.app.nav',
			params: { action: 'next', session: 'main', scope: 'visible' },
		},
	);
});

void test('rejects scoped nav argv for non next/prev actions', () => {
	assert.throws(() =>
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'nav',
			'next-all',
			'--session',
			'main',
			'--scope',
			'all',
		]),
	);
});

void test('rejects scoped nav argv with an invalid scope', () => {
	assert.throws(() =>
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'nav',
			'next',
			'--session',
			'main',
			'--scope',
			'nope',
		]),
	);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test test/integration/workmux-bridge-operations.test.ts`
Expected: FAIL — the scoped argv hits `unsupported(argv)` and throws (so the first test fails on the thrown error).

- [ ] **Step 3: Import the scope guard**

At the top of `src/lib/workmux-bridge-operations.ts`, add:

```ts
import { isWorkmuxNavScope } from './workmux-app-commands';
```

- [ ] **Step 4: Add the scoped-nav parse branch**

In `buildMdevBridgeOperationFromWorkmuxArgv`, inside `if (command === 'nav') {`, add this branch immediately after the existing `argv.length === 6` block (around line 121, before the `select` block):

```ts
			if (
				argv.length === 8 &&
				argv[4] === '--session' &&
				argv[6] === '--scope'
			) {
				const action = argAt(argv, 3);
				if (action !== 'next' && action !== 'prev') unsupported(argv);
				const scope = argAt(argv, 7);
				if (!isWorkmuxNavScope(scope)) unsupported(argv);
				return {
					operation: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[3],
					params: { action, session: argAt(argv, 5), scope },
				};
			}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec tsx --test test/integration/workmux-bridge-operations.test.ts`
Expected: PASS.

- [ ] **Step 6: Add a matching control-channel test**

In `test/integration/workmux-control-channel.test.ts`, find the existing test that sends `['tmux', 'app', 'nav', 'next-all', '--session', 'main']` and asserts `params: { action: 'next-all', session: 'main' }` (around line 60). Copy it to a new test that sends the scoped argv and asserts the scoped params:

```ts
// argv: ['tmux', 'app', 'nav', 'next', '--session', 'main', '--scope', 'visible']
// expected params: { action: 'next', session: 'main', scope: 'visible' }
```

Keep the rest of that test's harness identical to the sibling `next-all` test.

- [ ] **Step 7: Run the control-channel tests**

Run: `pnpm exec tsx --test test/integration/workmux-control-channel.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/workmux-bridge-operations.ts test/integration/workmux-bridge-operations.test.ts test/integration/workmux-control-channel.test.ts
git commit -m "feat(mobile): parse scoped Workmux nav argv in mdev bridge" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Sticky nav-scope preference

**Files:**
- Modify: `apps/mobile/src/lib/preferences.tsx`

> **Note on tests:** `preferences.tsx` instantiates `new MMKV(...)` at module load, which is a native module and cannot run under `tsx`/node, so preferences have no node:test coverage (consistent with the rest of this file). The only branching logic — the scope rotation — lives in `nextWorkmuxNavScope`, already unit-tested in Task 1. This task is verified by `pnpm typecheck`.

- [ ] **Step 1: Import the scope type and rotation helper**

At the top of `src/lib/preferences.tsx`, extend the imports:

```ts
import {
	nextWorkmuxNavScope,
	type WorkmuxNavScope,
} from './workmux-app-commands';
```

- [ ] **Step 2: Add the `workmuxNavScope` preference**

Inside the `preferences` object, add this entry after `shellListViewMode` (before the closing `} as const;`):

```ts
	workmuxNavScope: {
		_key: 'workmuxNavScope',
		_resolve: (rawScope: string | undefined): WorkmuxNavScope =>
			rawScope === 'visible' || rawScope === 'all' ? rawScope : 'active',
		get: (): WorkmuxNavScope =>
			preferences.workmuxNavScope._resolve(
				storage.getString(preferences.workmuxNavScope._key),
			),
		set: (scope: WorkmuxNavScope) => {
			storage.set(preferences.workmuxNavScope._key, scope);
		},
		cycle: (): WorkmuxNavScope => {
			const next = nextWorkmuxNavScope(preferences.workmuxNavScope.get());
			preferences.workmuxNavScope.set(next);
			return next;
		},
		useNavScopePref: (): [
			WorkmuxNavScope,
			(scope: WorkmuxNavScope) => void,
		] => {
			const [scope, setScope] = useMMKVString(
				preferences.workmuxNavScope._key,
			);
			return [
				preferences.workmuxNavScope._resolve(scope),
				(next: WorkmuxNavScope) => {
					setScope(next);
				},
			] as const;
		},
	},
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/preferences.tsx
git commit -m "feat(mobile): add sticky Workmux nav scope preference" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Scope-aware runner + cycle action

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Test: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/integration/keyboard-actions.test.ts`:

```ts
void test('Workmux keyboard runner appends scope for next/prev only', async () => {
	const argvCalls: { argv: string[]; timeoutMs: number }[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => 'main',
		getNavScope: () => 'visible',
		runWorkmuxCommand: async (argv, timeoutMs) => {
			argvCalls.push({ argv, timeoutMs });
		},
		showFailure: () => {},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	await runner.run({ type: 'nav', action: 'next' });
	await runner.run({ type: 'nav', action: 'next-all' });

	assert.deepEqual(argvCalls, [
		{
			argv: [
				'tmux',
				'app',
				'nav',
				'next',
				'--session',
				'main',
				'--scope',
				'visible',
			],
			timeoutMs: 10_000,
		},
		{
			argv: ['tmux', 'app', 'nav', 'next-all', '--session', 'main'],
			timeoutMs: 10_000,
		},
	]);
});

void test('WORKMUX_CYCLE_NAV_SCOPE cycles local scope and sends no remote command', async () => {
	let cycles = 0;
	let remoteSends = 0;
	await runAction('WORKMUX_CYCLE_NAV_SCOPE', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		cycleNavScope: () => {
			cycles += 1;
		},
		runWorkmuxKeyboardCommand: async () => {
			remoteSends += 1;
			return { status: 'handled' };
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(cycles, 1);
	assert.equal(remoteSends, 0);
});

void test('WORKMUX_CYCLE_NAV_SCOPE is a known, config-supported action', () => {
	assert.equal(
		KNOWN_ACTION_IDS.includes(
			'WORKMUX_CYCLE_NAV_SCOPE' as (typeof KNOWN_ACTION_IDS)[number],
		),
		true,
	);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test test/integration/keyboard-actions.test.ts`
Expected: FAIL — `getNavScope` is not a known runner option, `cycleNavScope` is not on `ActionContext`, and `WORKMUX_CYCLE_NAV_SCOPE` is not handled or registered.

- [ ] **Step 3: Import the scope type**

In `src/lib/keyboard-actions.ts`, add `type WorkmuxNavScope` to the existing import from `@/lib/workmux-app-commands` (the block around lines 6–14).

- [ ] **Step 4: Register the action id**

In `KNOWN_ACTION_IDS` (around lines 63–91), add `'WORKMUX_CYCLE_NAV_SCOPE',` next to `'TOGGLE_COMMAND_MENU',`.

- [ ] **Step 5: Add `getNavScope` to the runner factory**

In `createWorkmuxKeyboardCommandRunner`'s parameter object type (around lines 128–140), add:

```ts
	getNavScope,
```

to the destructured params and

```ts
	getNavScope?: () => WorkmuxNavScope;
```

to the param type. Then, inside `execute`, replace the argv construction (around lines 166–171) with:

```ts
			const navScope =
				command.type === 'nav' &&
				(command.action === 'next' || command.action === 'prev')
					? getNavScope?.()
					: undefined;
			const argv =
				command.type === 'focus'
					? buildWorkmuxAppFocusArgv(sessionName, command.target)
					: command.type === 'nav'
						? buildWorkmuxAppNavArgv(
								sessionName,
								command.action,
								undefined,
								navScope,
							)
						: buildWorkmuxStatusCycleArgv(sessionName);
```

(When `getNavScope` is not supplied, `navScope` is `undefined` and no `--scope` is appended — preserving current behavior. Do **not** import `buildWorkmuxAppNavCommand`; the "no host command fallback" test asserts that name never appears in this file.)

- [ ] **Step 6: Add `cycleNavScope` to `ActionContext` and handle the action**

In the `ActionContext` type (around lines 238–264), add:

```ts
	cycleNavScope?: () => void;
```

In `runAction`'s `switch` (around lines 299–409), add a case next to `TOGGLE_COMMAND_MENU`:

```ts
		case 'WORKMUX_CYCLE_NAV_SCOPE': {
			context.cycleNavScope?.();
			return;
		}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec tsx --test test/integration/keyboard-actions.test.ts`
Expected: PASS (new tests and all pre-existing ones, including the `next-all` runner test which still produces unscoped argv).

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/keyboard-actions.ts test/integration/keyboard-actions.test.ts
git commit -m "feat(mobile): inject nav scope and add scope-cycle action" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Scope-toggle pill key

**Files:**
- Create: `apps/mobile/src/app/shell/components/WorkmuxScopeToggleKey.tsx`
- Modify: `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`

> **Note on tests:** the repo has no React Native render-test setup (no `react-test-renderer`/testing-library in devDependencies), so this presentational component is verified by `pnpm typecheck`. Its behavior is covered by the Task 4 action test (cycle dispatch) and the Task 7 config test (the slot exists), plus the Task 8 manual smoke.

- [ ] **Step 1: Create the pill component**

Create `src/app/shell/components/WorkmuxScopeToggleKey.tsx`:

```tsx
import { Pressable, Text, View } from 'react-native';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { useTheme } from '@/lib/theme';

const SCOPE_SEGMENTS: readonly { scope: WorkmuxNavScope; label: string }[] = [
	{ scope: 'active', label: 'Active' },
	{ scope: 'visible', label: '+Busy' },
	{ scope: 'all', label: 'All' },
];

export function WorkmuxScopeToggleKey({
	scope,
	span,
	keyHeight,
	onPress,
}: {
	scope: WorkmuxNavScope;
	span: number;
	keyHeight: number;
	onPress: () => void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Window nav scope: ${scope}`}
			onPress={onPress}
			style={{
				flex: span,
				margin: 2,
				height: keyHeight,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				flexDirection: 'row',
				overflow: 'hidden',
			}}
		>
			{SCOPE_SEGMENTS.map((segment, index) => {
				const active = segment.scope === scope;
				return (
					<View
						key={segment.scope}
						style={{
							flex: 1,
							alignItems: 'center',
							justifyContent: 'center',
							backgroundColor: active
								? theme.colors.primary
								: 'transparent',
							borderLeftWidth: index === 0 ? 0 : 1,
							borderLeftColor: theme.colors.border,
						}}
					>
						<Text
							numberOfLines={1}
							style={{ color: theme.colors.textPrimary, fontSize: 10 }}
						>
							{segment.label}
						</Text>
					</View>
				);
			})}
		</Pressable>
	);
}
```

- [ ] **Step 2: Add the `navScope` prop to `TerminalKeyboard`**

In `src/app/shell/components/TerminalKeyboard.tsx`:

Add imports near the other imports:

```tsx
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { WorkmuxScopeToggleKey } from './WorkmuxScopeToggleKey';
```

Extend the props destructuring and type (the block at lines 198–210). Add `navScope` (defaulted so the sole caller compiles before Task 6):

```tsx
export function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
	selectionModeEnabled,
	onCopySelection,
	navScope = 'active',
}: {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardExecutableItem) => void;
	selectionModeEnabled: boolean;
	onCopySelection: () => void;
	navScope?: WorkmuxNavScope;
}) {
```

- [ ] **Step 3: Render the toggle in the grid loop**

In the grid-mapping loop, immediately after the `if (!slot) { ... }` empty-cell block (around line 555, just before `const isSelectionCopySlot =`), insert:

```tsx
		if (slot.type === 'action' && slot.actionId === 'WORKMUX_CYCLE_NAV_SCOPE') {
			cells.push(
				<WorkmuxScopeToggleKey
					key={`slot-${rowIndex}-${col}`}
					scope={navScope}
					span={span}
					keyHeight={keyHeight}
					onPress={() => onSlotPress(slot)}
				/>,
			);
			col += span;
			continue;
		}
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add src/app/shell/components/WorkmuxScopeToggleKey.tsx src/app/shell/components/TerminalKeyboard.tsx
git commit -m "feat(mobile): add Workmux scope-toggle pill key" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire scope into the shell detail screen

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

> **Note on tests:** `detail.tsx` is the large shell orchestrator and has no node:test coverage; verify with `pnpm typecheck`. After this task, `next`/`prev` carry `--scope` for real — see the mdev dependency callout at the top.

- [ ] **Step 1: Import `preferences`**

Confirm `preferences` is imported in `detail.tsx` (it is used widely; if not, add `import { preferences } from '@/lib/preferences';`).

- [ ] **Step 2: Read the sticky scope for rendering**

Near the other preference hooks in the component body, add:

```tsx
const [navScope] = preferences.workmuxNavScope.useNavScopePref();
```

- [ ] **Step 3: Feed the scope to the runner**

In the `createWorkmuxKeyboardCommandRunner({ ... })` call (around line 2405), add this property to the options object (alongside `getSessionName`):

```tsx
			getNavScope: () => preferences.workmuxNavScope.get(),
```

- [ ] **Step 4: Provide `cycleNavScope` on the action context**

In the `useMemo<ActionContext>(() => ({ ... }))` object (around line 2532), add (next to `runWorkmuxKeyboardCommand`):

```tsx
		cycleNavScope: () => {
			preferences.workmuxNavScope.cycle();
		},
```

`cycleNavScope` reads/writes MMKV directly and needs no entry in the `useMemo` dependency array.

- [ ] **Step 5: Pass `navScope` to the keyboard**

In the `<TerminalKeyboard ... />` JSX (around line 3306), add the prop:

```tsx
				navScope={navScope}
```

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add src/app/shell/detail.tsx
git commit -m "feat(mobile): wire sticky nav scope into shell keyboard" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Consolidate the keyboard layouts

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Test: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Update the advanced keyboard nav row**

In `config/shell-config.json`, inside `advanced_keyboard` → `grid[1]` (the row starting with `PAGE_UP`), replace the four consecutive nav slots (`WORKMUX_NAV_PREV_ALL` "Previous All", `WORKMUX_NAV_PREV` "Previous", `WORKMUX_NAV_NEXT` "Next", `WORKMUX_NAV_NEXT_ALL` "Next All", currently lines ~413–436) with these three slots:

```json
					{
						"type": "action",
						"actionId": "WORKMUX_NAV_PREV",
						"label": "Prev",
						"icon": null
					},
					{
						"type": "action",
						"actionId": "WORKMUX_NAV_NEXT",
						"label": "Next",
						"icon": null
					},
					{
						"type": "action",
						"actionId": "WORKMUX_CYCLE_NAV_SCOPE",
						"label": "Scope",
						"icon": null,
						"span": 2
					},
```

- [ ] **Step 2: Remove the advanced keyboard's duplicate all-nav pair**

In `advanced_keyboard` → `grid[2]`, replace the two slots `WORKMUX_NAV_PREV_ALL` "Prev all" and `WORKMUX_NAV_NEXT_ALL` "Next all" (currently lines ~460–471) with two `null` entries, so the row becomes all `null` (it will be filtered out at render time):

```json
				null,
				null,
				null
```

(That replaces the `{ Prev all }, { Next all }, null` tail — the row's last three array entries — with `null, null, null`.)

- [ ] **Step 3: Update the tmux keyboard nav cluster**

In `tmux_keyboard` → `grid[0]`, replace the four nav slots (`WORKMUX_NAV_PREV` "Previous", `WORKMUX_NAV_NEXT` "Next", `WORKMUX_NAV_PREV_ALL` "Previous All", `WORKMUX_NAV_NEXT_ALL` "Next All", currently lines ~514–537) with:

```json
					{
						"type": "action",
						"actionId": "WORKMUX_NAV_PREV",
						"label": "Prev",
						"icon": null
					},
					{
						"type": "action",
						"actionId": "WORKMUX_NAV_NEXT",
						"label": "Next",
						"icon": null
					},
					{
						"type": "action",
						"actionId": "WORKMUX_CYCLE_NAV_SCOPE",
						"label": "Scope",
						"icon": null,
						"span": 2
					},
```

- [ ] **Step 4: Validate the config parses**

Run: `pnpm validate:shell-config`
Expected: PASS (no unknown action id — `WORKMUX_CYCLE_NAV_SCOPE` was registered in Task 4; valid JSON).

- [ ] **Step 5: Update the broken advanced-keyboard assertion**

In `test/integration/keyboard-config.test.ts`, in the test `advanced keyboard omits consolidated host URL setter actions`, replace the `grid[2]?.slice(7, 9)` assertion (currently lines ~581–594, expecting the two `_ALL` slots) with:

```ts
	assert.deepEqual(advancedKeyboard.grid[2]?.slice(7, 9), [null, null]);
```

And add, after the existing `EDIT_HOST_URL_*` checks (after line ~603):

```ts
	assert.equal(advancedActionIds.includes('WORKMUX_NAV_PREV_ALL'), false);
	assert.equal(advancedActionIds.includes('WORKMUX_NAV_NEXT_ALL'), false);
```

- [ ] **Step 6: Add the consolidated-cluster tests**

Append to `test/integration/keyboard-config.test.ts`:

```ts
void test('advanced keyboard uses the consolidated scope-toggle nav cluster', () => {
	const config = getBundledShellConfig();
	const advanced = config.keyboards.find((k) => k.id === 'advanced_keyboard');
	assert.ok(advanced);
	const navRow = advanced.grid[1] ?? [];
	const navActionIds = navRow.flatMap((slot) =>
		slot?.type === 'action' ? [slot.actionId] : [],
	);
	assert.ok(navActionIds.includes('WORKMUX_NAV_PREV'));
	assert.ok(navActionIds.includes('WORKMUX_NAV_NEXT'));
	assert.ok(navActionIds.includes('WORKMUX_CYCLE_NAV_SCOPE'));
	assert.equal(navActionIds.includes('WORKMUX_NAV_PREV_ALL'), false);
	assert.equal(navActionIds.includes('WORKMUX_NAV_NEXT_ALL'), false);
	const scopeSlot = navRow.find(
		(slot) =>
			slot?.type === 'action' && slot.actionId === 'WORKMUX_CYCLE_NAV_SCOPE',
	);
	assert.equal(scopeSlot?.span, 2);
});

void test('tmux keyboard uses the consolidated scope-toggle nav cluster', () => {
	const config = getBundledShellConfig();
	const tmux = config.keyboards.find((k) => k.id === 'tmux_keyboard');
	assert.ok(tmux);
	const navActionIds = (tmux.grid[0] ?? []).flatMap((slot) =>
		slot?.type === 'action' ? [slot.actionId] : [],
	);
	assert.ok(navActionIds.includes('WORKMUX_NAV_PREV'));
	assert.ok(navActionIds.includes('WORKMUX_NAV_NEXT'));
	assert.ok(navActionIds.includes('WORKMUX_CYCLE_NAV_SCOPE'));
	assert.equal(navActionIds.includes('WORKMUX_NAV_PREV_ALL'), false);
	assert.equal(navActionIds.includes('WORKMUX_NAV_NEXT_ALL'), false);
});
```

> The existing test `bundled Workmux all-window nav keys use semantic actions` still passes: `phone_base` keeps its `Prev all`/`Next all` slots (labels unchanged), so the matched set is non-empty and still maps to `WORKMUX_NAV_*_ALL`.

- [ ] **Step 7: Run the keyboard-config tests to verify they pass**

Run: `pnpm exec tsx --test test/integration/keyboard-config.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add config/shell-config.json test/integration/keyboard-config.test.ts
git commit -m "feat(mobile): consolidate window-nav keys into scope toggle" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Full verification and handoff

**Files:** none (verification only)

- [ ] **Step 1: Run the full mobile check suite**

```bash
pnpm typecheck
pnpm lint:check
pnpm test:integration
pnpm validate:shell-config
```

Expected: all PASS, zero lint warnings.

- [ ] **Step 2: Manual smoke (requires a `--scope`-capable mdev)**

Confirm the `mulyoved/skills` `--scope active|visible|all` support is deployed on the test host, then in the running app:
1. Open the advanced (or tmux) keyboard — the nav cluster shows `Prev`, `Next`, and the `Active | +Busy | All` pill with `Active` filled.
2. Tap the pill: it advances `Active → +Busy → All → Active`, and the state persists after backgrounding/reopening the app.
3. With a mix of ✅/🤖/hidden windows, verify `Next`/`Prev` walk only the windows in the selected scope at each level.

- [ ] **Step 3: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "fix(mobile): adjust Workmux scope toggle after smoke test" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** three-button layout (Tasks 5, 7) · sticky 3-level scope `active`/`visible`/`all` (Tasks 1, 3) · 💬 folded into Active = the `active` scope's mdev semantics (documented in the mdev callout) · segmented-pill indicator, current filled (Task 5) · mdev owns filtering via `--scope`, app passes it (Tasks 1, 2, 4, 6) · global MMKV persistence, default `active` (Task 3) · advanced + tmux redesigned, `phone_base` and `_ALL` ids kept (Tasks 4, 7) · mdev-first sequencing (callout + Task 8) · tests for argv/bridge/runner/config (Tasks 1, 2, 4, 7). Edge cases (current window outside scope, empty scope, wrap) are mdev-owned and noted in the spec.

**No placeholders:** every code step shows complete code; every test step shows the assertions; every run step gives the command and expected result.

**Type consistency:** `WorkmuxNavScope` (`'active' | 'visible' | 'all'`) defined in Task 1 is used identically in Tasks 3, 4, 5, 6; `buildWorkmuxAppNavArgv(session, action, index?, scope?)` (Task 1) is called with that exact shape in Task 4; `getNavScope`/`cycleNavScope` names match between the runner/`ActionContext` (Task 4) and the wiring (Task 6); `WORKMUX_CYCLE_NAV_SCOPE` is spelled identically across Tasks 4, 5, 7.
