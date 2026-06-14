# Work Key Walk Advanced Stripe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Work key long-press stripe show current-scope previous, widened-scope previous/next, and the three mode selectors.

**Architecture:** Put Work-key option derivation in a pure helper so scope math and runtime metadata are independently testable. `TerminalKeyboard` uses that helper only for the actual Work key slot, while `detail.tsx` and `keyboard-actions.ts` pass a one-shot nav scope override through the existing Workmux keyboard command path.

**Tech Stack:** Expo React Native, TypeScript, Node `tsx --test`, existing Workmux keyboard action runner.

---

## Scope Check

This plan covers one subsystem: the mobile terminal Work key long-press menu.
It does not change Workmux server filtering, keyboard gesture placement, or other
keyboard menus.

## File Structure

- Create `apps/mobile/src/lib/work-key-long-press-options.ts`
  - Owns Work-key detection, scope widening, dynamic option construction, and
    runtime metadata readers.
- Create `apps/mobile/test/integration/work-key-long-press-options.test.ts`
  - Tests the pure helper against all three scopes and verifies non-Work slots
    are unchanged.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Allows one-shot scope overrides on `next`/`prev` Workmux nav commands.
- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Verifies overrides are carried by `runAction` and respected by the command
    runner.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Reads runtime scope override metadata from a pressed long-press option and
    forwards it to `runAction`.
- Modify `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
  - Resolves Work long-press options dynamically and renders the existing scope
    badge on scoped nav options.

## Task 1: Add Pure Work-Key Option Derivation

**Files:**
- Create: `apps/mobile/src/lib/work-key-long-press-options.ts`
- Create: `apps/mobile/test/integration/work-key-long-press-options.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/mobile/test/integration/work-key-long-press-options.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getWorkKeyLongPressOptions,
	getWorkmuxLongPressScopeBadge,
	getWorkmuxNavScopeOverride,
	isWorkKeyNavSlot,
	widenWorkmuxNavScope,
} from '../../src/lib/work-key-long-press-options';
import { type KeyboardLongPressOption, type KeyboardSlot } from '../../src/lib/shell-config';

const workSlot: KeyboardSlot = {
	type: 'action',
	actionId: 'WORKMUX_NAV_NEXT',
	label: 'Work',
	icon: 'AppWindow',
	span: 2,
	longPress: {
		options: [
			{ type: 'action', actionId: 'WORKMUX_NAV_PREV', label: 'Prev', icon: null },
			{ type: 'action', actionId: 'WORKMUX_NAV_NEXT', label: 'Next', icon: null },
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
				label: 'Active',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
				label: '+Busy',
				icon: null,
			},
			{ type: 'action', actionId: 'WORKMUX_NAV_SCOPE_ALL', label: 'All', icon: null },
		],
	},
};

function summarize(options: readonly KeyboardLongPressOption[]) {
	return options.map((option) => {
		assert.equal(option.type, 'action');
		return {
			actionId: option.actionId,
			label: option.label,
			override: getWorkmuxNavScopeOverride(option),
			badge: getWorkmuxLongPressScopeBadge(option),
		};
	});
}

void test('widenWorkmuxNavScope caps the mode ladder at all', () => {
	assert.equal(widenWorkmuxNavScope('active'), 'visible');
	assert.equal(widenWorkmuxNavScope('visible'), 'all');
	assert.equal(widenWorkmuxNavScope('all'), 'all');
});

void test('isWorkKeyNavSlot only matches the actual Work nav slot shape', () => {
	assert.equal(isWorkKeyNavSlot(workSlot), true);
	assert.equal(
		isWorkKeyNavSlot({
			...workSlot,
			label: 'Next',
		}),
		false,
	);
	assert.equal(
		isWorkKeyNavSlot({
			...workSlot,
			actionId: 'WORKMUX_NAV_PREV',
		}),
		false,
	);
});

void test('Work key options for active mode include previous active and widened busy nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'active');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev Active',
			override: 'active',
			badge: 'active',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev +Busy',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next +Busy',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: 'Active',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: '+Busy',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: 'All',
			override: undefined,
			badge: null,
		},
	]);
});

void test('Work key options for visible mode include previous busy and widened all nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'visible');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev +Busy',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: 'Active',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: '+Busy',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: 'All',
			override: undefined,
			badge: null,
		},
	]);
});

void test('Work key options for all mode repeat all for widened nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'all');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: 'Active',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: '+Busy',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: 'All',
			override: undefined,
			badge: null,
		},
	]);
});

void test('non-Work long-press menus are left to their configured options', () => {
	const options = getWorkKeyLongPressOptions(
		{
			type: 'bytes',
			bytes: [27, 91, 68],
			label: 'ARROW_LEFT',
			icon: 'ArrowLeft',
			longPress: {
				options: [
					{ type: 'bytes', bytes: [27, 91, 68], label: 'ARROW_LEFT', icon: 'ArrowLeft' },
				],
			},
		},
		'active',
	);

	assert.equal(options, null);
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/work-key-long-press-options.test.ts
```

Expected: FAIL with a module-not-found error for
`../../src/lib/work-key-long-press-options`.

- [ ] **Step 3: Implement the helper**

Create `apps/mobile/src/lib/work-key-long-press-options.ts`:

```ts
import {
	type KeyboardExecutableItem,
	type KeyboardLongPressOption,
	type KeyboardSlot,
} from './shell-config';
import {
	isWorkmuxNavScope,
	type WorkmuxNavScope,
} from './workmux-app-commands';

type WorkmuxScopedNavActionId = 'WORKMUX_NAV_PREV' | 'WORKMUX_NAV_NEXT';

export type WorkmuxScopedNavLongPressOption = Extract<
	KeyboardLongPressOption,
	{ type: 'action' }
> & {
	actionId: WorkmuxScopedNavActionId;
	workmuxNavScopeOverride: WorkmuxNavScope;
	workmuxNavScopeBadge: WorkmuxNavScope;
};

export type ResolvedKeyboardLongPressOption =
	| KeyboardLongPressOption
	| WorkmuxScopedNavLongPressOption;

export const WORKMUX_NAV_SCOPE_LABEL: Record<WorkmuxNavScope, string> = {
	active: 'Active',
	visible: '+Busy',
	all: 'All',
};

export const WORKMUX_NAV_SCOPE_BADGE_LABEL: Record<WorkmuxNavScope, string> = {
	active: 'A',
	visible: '+B',
	all: '∀',
};

const WORK_SCOPE_ACTION_IDS = new Set([
	'WORKMUX_NAV_SCOPE_ACTIVE',
	'WORKMUX_NAV_SCOPE_VISIBLE',
	'WORKMUX_NAV_SCOPE_ALL',
]);

export function widenWorkmuxNavScope(
	scope: WorkmuxNavScope,
): WorkmuxNavScope {
	switch (scope) {
		case 'active':
			return 'visible';
		case 'visible':
			return 'all';
		case 'all':
			return 'all';
	}
}

export function isWorkKeyNavSlot(slot: KeyboardSlot): boolean {
	if (
		slot.type !== 'action' ||
		slot.actionId !== 'WORKMUX_NAV_NEXT' ||
		slot.label !== 'Work'
	) {
		return false;
	}

	const optionActionIds = new Set(
		(slot.longPress?.options ?? []).flatMap((option) =>
			option.type === 'action' ? [option.actionId] : [],
		),
	);
	for (const actionId of WORK_SCOPE_ACTION_IDS) {
		if (!optionActionIds.has(actionId)) return false;
	}
	return true;
}

function makeScopedNavOption(
	actionId: WorkmuxScopedNavActionId,
	scope: WorkmuxNavScope,
): WorkmuxScopedNavLongPressOption {
	const direction = actionId === 'WORKMUX_NAV_PREV' ? 'Prev' : 'Next';
	return {
		type: 'action',
		actionId,
		label: `${direction} ${WORKMUX_NAV_SCOPE_LABEL[scope]}`,
		icon: null,
		workmuxNavScopeOverride: scope,
		workmuxNavScopeBadge: scope,
	};
}

export function getWorkKeyLongPressOptions(
	slot: KeyboardSlot,
	navScope: WorkmuxNavScope | null | undefined,
): readonly ResolvedKeyboardLongPressOption[] | null {
	if (!isWorkKeyNavSlot(slot) || !navScope || !isWorkmuxNavScope(navScope)) {
		return null;
	}

	const widenedScope = widenWorkmuxNavScope(navScope);
	return [
		makeScopedNavOption('WORKMUX_NAV_PREV', navScope),
		makeScopedNavOption('WORKMUX_NAV_PREV', widenedScope),
		makeScopedNavOption('WORKMUX_NAV_NEXT', widenedScope),
		{
			type: 'action',
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: WORKMUX_NAV_SCOPE_LABEL.active,
			icon: null,
		},
		{
			type: 'action',
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: WORKMUX_NAV_SCOPE_LABEL.visible,
			icon: null,
		},
		{
			type: 'action',
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: WORKMUX_NAV_SCOPE_LABEL.all,
			icon: null,
		},
	];
}

export function getWorkmuxNavScopeOverride(
	item: KeyboardExecutableItem,
): WorkmuxNavScope | undefined {
	const value = (item as { workmuxNavScopeOverride?: unknown })
		.workmuxNavScopeOverride;
	return typeof value === 'string' && isWorkmuxNavScope(value)
		? value
		: undefined;
}

export function getWorkmuxLongPressScopeBadge(
	item: KeyboardExecutableItem,
): WorkmuxNavScope | null {
	const value = (item as { workmuxNavScopeBadge?: unknown })
		.workmuxNavScopeBadge;
	return typeof value === 'string' && isWorkmuxNavScope(value) ? value : null;
}
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/work-key-long-press-options.test.ts
```

Expected: PASS for all tests in `work-key-long-press-options.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/work-key-long-press-options.ts apps/mobile/test/integration/work-key-long-press-options.test.ts
git commit -m "Add Work key long-press option resolver"
```

## Task 2: Add One-Shot Scope Override To Workmux Keyboard Actions

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Write failing action tests**

In `apps/mobile/test/integration/keyboard-actions.test.ts`, add these tests
after `Workmux keyboard runner uses required argv command transport`:

```ts
void test('Workmux keyboard runner prefers explicit one-shot nav scope over stored scope', async () => {
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

	assert.deepEqual(
		await runner.run({ type: 'nav', action: 'prev', scope: 'all' }),
		{ status: 'handled' },
	);
	assert.deepEqual(argvCalls, [
		{
			argv: [
				'tmux',
				'app',
				'nav',
				'prev',
				'--session',
				'main',
				'--scope',
				'all',
			],
			timeoutMs: 10_000,
		},
	]);
});

void test('runAction forwards one-shot nav scope metadata to Workmux commands', async () => {
	const commands: WorkmuxKeyboardCommand[] = [];

	await runAction(
		'WORKMUX_NAV_PREV',
		{
			availableKeyboardIds: new Set(),
			selectKeyboard: () => {},
			rotateKeyboard: () => {},
			openConfigurator: () => {},
			sendBytes: () => {},
			pasteClipboard: async () => {},
			copySelection: () => {},
			runWorkmuxKeyboardCommand: async (command: WorkmuxKeyboardCommand) => {
				commands.push(command);
				return { status: 'handled' };
			},
		} as Parameters<typeof runAction>[1],
		{ workmuxNavScopeOverride: 'all' },
	);

	assert.deepEqual(commands, [{ type: 'nav', action: 'prev', scope: 'all' }]);
});
```

- [ ] **Step 2: Run the action tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: FAIL because the runner still uses the stored `visible` scope instead
of the one-shot `all` scope, and `runAction` still delegates a command without a
`scope` property.

- [ ] **Step 3: Update command types and runner scope selection**

In `apps/mobile/src/lib/keyboard-actions.ts`, replace:

```ts
export type WorkmuxKeyboardCommand =
	| { type: 'focus'; target: WorkmuxFocusTarget }
	| { type: 'nav'; action: Exclude<WorkmuxNavAction, 'select'> }
	| { type: 'status-cycle' };
```

with:

```ts
export type WorkmuxKeyboardCommand =
	| { type: 'focus'; target: WorkmuxFocusTarget }
	| {
			type: 'nav';
			action: Exclude<WorkmuxNavAction, 'select'>;
			scope?: WorkmuxNavScope;
	  }
	| { type: 'status-cycle' };
```

Then replace the `navScope` calculation inside `execute`:

```ts
const navScope =
	command.type === 'nav' &&
	(command.action === 'next' || command.action === 'prev')
		? getNavScope?.()
		: undefined;
```

with:

```ts
const navScope =
	command.type === 'nav' &&
	(command.action === 'next' || command.action === 'prev')
		? command.scope ?? getNavScope?.()
		: undefined;
```

- [ ] **Step 4: Add action-level scope override plumbing**

In `apps/mobile/src/lib/keyboard-actions.ts`, add this type near
`ActionContext`:

```ts
export type RunActionOptions = {
	workmuxNavScopeOverride?: WorkmuxNavScope;
};
```

Change the `runAction` signature from:

```ts
export async function runAction(
	actionId: ActionId,
	context: ActionContext,
): Promise<void> {
```

to:

```ts
export async function runAction(
	actionId: ActionId,
	context: ActionContext,
	options: RunActionOptions = {},
): Promise<void> {
```

Then replace:

```ts
if (workmuxKeyboardCommand) {
	await context.runWorkmuxKeyboardCommand?.(workmuxKeyboardCommand);
	return;
}
```

with:

```ts
if (workmuxKeyboardCommand) {
	const command =
		workmuxKeyboardCommand.type === 'nav' &&
		(workmuxKeyboardCommand.action === 'next' ||
			workmuxKeyboardCommand.action === 'prev') &&
		options.workmuxNavScopeOverride
			? {
					...workmuxKeyboardCommand,
					scope: options.workmuxNavScopeOverride,
				}
			: workmuxKeyboardCommand;
	await context.runWorkmuxKeyboardCommand?.(command);
	return;
}
```

- [ ] **Step 5: Run the action tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts
git commit -m "Support one-shot Workmux nav scopes"
```

## Task 3: Forward Runtime Scope Metadata From Pressed Options

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Add the metadata import**

In `apps/mobile/src/app/shell/detail.tsx`, update the existing
`@/lib/keyboard-actions` import from:

```ts
import {
	HANDLE_DEV_SERVER_URL,
	createWorkmuxKeyboardCommandRunner,
	runAction,
	type ActionContext,
	type ActionId,
	type WorkmuxKeyboardCommand,
} from '@/lib/keyboard-actions';
```

to:

```ts
import {
	HANDLE_DEV_SERVER_URL,
	createWorkmuxKeyboardCommandRunner,
	runAction,
	type ActionContext,
	type ActionId,
	type RunActionOptions,
	type WorkmuxKeyboardCommand,
} from '@/lib/keyboard-actions';
```

Then add this import near the other `@/lib/...` imports:

```ts
import { getWorkmuxNavScopeOverride } from '@/lib/work-key-long-press-options';
```

- [ ] **Step 2: Update `handleAction` to accept override options**

Replace:

```ts
const handleAction = useCallback(
	(actionId: ActionId) => {
		void runAction(actionId, actionContext);
	},
	[actionContext],
);
```

with:

```ts
const handleAction = useCallback(
	(
		actionId: ActionId,
		options?: RunActionOptions,
	) => {
		void runAction(actionId, actionContext, options);
	},
	[actionContext],
);
```

- [ ] **Step 3: Forward override metadata for action slots**

In `handleSlotPress`, replace:

```ts
case 'action':
	handleAction(slot.actionId);
	break;
```

with:

```ts
case 'action':
	handleAction(slot.actionId, {
		workmuxNavScopeOverride: getWorkmuxNavScopeOverride(slot),
	});
	break;
```

- [ ] **Step 4: Run typecheck for the touched path**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "Forward Work key nav scope overrides"
```

## Task 4: Resolve Dynamic Options In TerminalKeyboard And Render Scope Badges

**Files:**
- Modify: `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`

- [ ] **Step 1: Import the Work-key helpers**

In `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`, add this import:

```ts
import {
	getWorkKeyLongPressOptions,
	getWorkmuxLongPressScopeBadge,
	WORKMUX_NAV_SCOPE_BADGE_LABEL,
	type ResolvedKeyboardLongPressOption,
} from '@/lib/work-key-long-press-options';
```

- [ ] **Step 2: Use the shared badge labels**

Delete the local `SCOPE_BADGE_LABEL` constant:

```ts
const SCOPE_BADGE_LABEL: Record<WorkmuxNavScope, string> = {
	active: 'A',
	visible: '+B',
	all: '∀',
};
```

Replace this usage:

```tsx
{SCOPE_BADGE_LABEL[scopeBadge]}
```

with:

```tsx
{WORKMUX_NAV_SCOPE_BADGE_LABEL[scopeBadge]}
```

- [ ] **Step 3: Allow resolved runtime options in popup state**

In the `@/lib/shell-config` import, remove `type KeyboardLongPressOption`
because popup state will no longer use it directly.

Replace:

```ts
type LongPressPopupState = {
	slot: KeyboardSlot;
	options: readonly KeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};
```

with:

```ts
type LongPressPopupState = {
	slot: KeyboardSlot;
	options: readonly ResolvedKeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};
```

- [ ] **Step 4: Resolve Work-key options when opening the popup**

Inside `openLongPressPopup`, replace:

```ts
const options = slot.longPress?.options;
if (!options?.length) return;
```

with:

```ts
const options =
	getWorkKeyLongPressOptions(slot, navScope) ?? slot.longPress?.options;
if (!options?.length) return;
```

Add `navScope` to the `openLongPressPopup` dependency array:

```ts
[clearRepeat, navScope, updateKeyboardRootMetrics],
```

- [ ] **Step 5: Render the scope badge on derived nav options**

Inside the `longPressPopup.options.map` callback, after `const highlighted = ...`,
add:

```ts
const scopeBadge = getWorkmuxLongPressScopeBadge(option);
```

Then, inside the option `<View>` and before the `OptionIcon` block, add:

```tsx
{scopeBadge ? (
	<View
		style={{
			position: 'absolute',
			top: 4,
			left: 4,
			paddingHorizontal: 3,
			borderRadius: 4,
			backgroundColor: theme.colors.primary,
		}}
	>
		<Text
			style={{
				color: theme.colors.textPrimary,
				fontSize: 8,
				lineHeight: 10,
				fontWeight: '700',
			}}
		>
			{WORKMUX_NAV_SCOPE_BADGE_LABEL[scopeBadge]}
		</Text>
	</View>
) : null}
```

Keep the existing `isCurrentScope` background behavior for the three mode setter
options. The new `scopeBadge` is only for derived nav options with
`workmuxNavScopeBadge`.

- [ ] **Step 6: Run focused typecheck and helper/action tests**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
cd apps/mobile && pnpm exec tsx --test test/integration/work-key-long-press-options.test.ts test/integration/keyboard-actions.test.ts
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/app/shell/components/TerminalKeyboard.tsx
git commit -m "Render dynamic Work long-press options"
```

## Task 5: Add Integration Coverage Against Bundled Config

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Add an integration test for the bundled Work slot**

In `apps/mobile/test/integration/keyboard-config.test.ts`, add this import near
the existing imports:

```ts
import { getWorkKeyLongPressOptions } from '../../src/lib/work-key-long-press-options';
```

Then add this test after `phone base Work key long-press sets the nav scope`:

```ts
void test('bundled Work key resolves dynamic long-press options for each nav scope', () => {
	const config = getBundledShellConfig();
	const phoneBase = config.keyboards.find((k) => k.id === 'phone_base');
	assert.ok(phoneBase);
	const workSlot = phoneBase.grid[0]?.[6];
	assert.ok(workSlot);

	const activeOptions = getWorkKeyLongPressOptions(workSlot, 'active');
	const visibleOptions = getWorkKeyLongPressOptions(workSlot, 'visible');
	const allOptions = getWorkKeyLongPressOptions(workSlot, 'all');

	assert.ok(activeOptions);
	assert.ok(visibleOptions);
	assert.ok(allOptions);

	assert.deepEqual(
		activeOptions.map((option) => option.label),
		['Prev Active', 'Prev +Busy', 'Next +Busy', 'Active', '+Busy', 'All'],
	);
	assert.deepEqual(
		visibleOptions.map((option) => option.label),
		['Prev +Busy', 'Prev All', 'Next All', 'Active', '+Busy', 'All'],
	);
	assert.deepEqual(
		allOptions.map((option) => option.label),
		['Prev All', 'Prev All', 'Next All', 'Active', '+Busy', 'All'],
	);
});
```

- [ ] **Step 2: Run the config test**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "Cover bundled Work long-press options"
```

## Task 6: Final Verification

**Files:**
- Verify all changed files from Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/work-key-long-press-options.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the mobile integration suite**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS.

- [ ] **Step 4: Run changed-file lint if repo lint is still blocked**

Run:

```bash
cd apps/mobile && pnpm exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/work-key-long-press-options.ts src/lib/keyboard-actions.ts src/app/shell/detail.tsx src/app/shell/components/TerminalKeyboard.tsx test/integration/work-key-long-press-options.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts
```

Expected: PASS. If full `pnpm --filter @fressh/mobile lint:check` still fails
because of the existing `@typescript-eslint/no-explicit-any` plugin/config issue,
record that as an existing repo lint blocker and keep the changed-file lint
result.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional task changes are committed. The pre-existing
`apps/mobile/android/app/src/main/res/values/strings.xml` modification may still
be present and must not be reverted.
