# Inline Tailscale Connect UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Tailscale recovery controls out of the app-wide overlay and render them inline inside the Connect tab.

**Architecture:** Keep auto-connect and Tailscale recovery policy inside `AutoConnectManager`, but move UI state and action handoff into a tiny Zustand store. The Connect tab subscribes to that store and renders a presentational inline panel above the SSH form card. The root manager registers the same `Open Tailscale`, `Retry`, and `Reset` actions it already owns, without rendering any visual Tailscale component itself.

**Tech Stack:** Expo React Native, TypeScript, Zustand, `node:test` via `tsx --test`, existing `useTheme` styling.

## Global Constraints

- Render Tailscale recovery UI as part of the Connect tab.
- Remove the app-wide overlay behavior for Tailscale attention.
- Keep the existing Tailscale recovery state and actions: `Open Tailscale`, `Retry`, and `Reset`.
- Preserve automatic recovery and reconnect policy in `AutoConnectManager`.
- Make the UI read as an inline connection status panel, not a separate screen or floating banner.
- Do not change Tailscale native recovery behavior.
- Do not change SSH connect, reconnect, saved connection, or foreground service policy.
- Do not show Tailscale recovery UI on Shell, Settings, or other tabs.
- Do not build a new Tailscale setup or onboarding flow.
- The inline visual implementation must not use absolute positioning, safe-area top padding, or app-level z-index.

---

## File Structure

- Create `apps/mobile/src/lib/tailscale-recovery-ui-store.ts`: shared Zustand store for visible recovery state and nullable UI action handlers.
- Create `apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts`: pure store tests for default, visible, clearing, and missing-handler behavior.
- Modify `apps/mobile/src/lib/TailscaleRecoveryBannerPresentation.ts`: keep the existing helper name, add an optional action-availability input, and disable actions when handlers are unavailable.
- Modify `apps/mobile/test/integration/tailscale-recovery-banner.test.ts`: cover the new disabled-actions behavior when handlers are unavailable.
- Create `apps/mobile/src/lib/TailscaleRecoveryPanel.tsx`: inline Connect-tab panel using the existing presentation helper and theme colors.
- Modify `apps/mobile/src/lib/auto-connect.tsx`: remove root overlay rendering, write recovery state to the UI store, and register action handlers.
- Modify `apps/mobile/src/app/(tabs)/index.tsx`: render `TailscaleRecoveryPanel` above the SSH form card inside the existing `ScrollView`.
- Create `apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts`: source-level guard that the Connect tab imports/renders the panel and `AutoConnectManager` no longer imports/renders the old banner.

### Task 1: Shared Tailscale Recovery UI Store

**Files:**
- Create: `apps/mobile/src/lib/tailscale-recovery-ui-store.ts`
- Test: `apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts`

**Interfaces:**
- Consumes: `TailscaleRecoveryBannerState` from `apps/mobile/src/lib/TailscaleRecoveryBannerPresentation.ts`.
- Produces:
  - `hiddenTailscaleRecoveryUiState: TailscaleRecoveryBannerState`
  - `type TailscaleRecoveryUiActions = { openTailscale: () => void; retry: () => void; reset: () => void }`
  - `useTailscaleRecoveryUiStore`, a Zustand hook with:
    - `recoveryState: TailscaleRecoveryBannerState`
    - `actions: TailscaleRecoveryUiActions | null`
    - `setRecoveryState(state: TailscaleRecoveryBannerState): void`
    - `clearRecoveryState(): void`
    - `setActions(actions: TailscaleRecoveryUiActions): void`
    - `clearActions(): void`

- [ ] **Step 1: Write the failing store tests**

Create `apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts`:

```ts
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	hiddenTailscaleRecoveryUiState,
	type TailscaleRecoveryUiActions,
	useTailscaleRecoveryUiStore,
} from '../../src/lib/tailscale-recovery-ui-store';

function resetStore() {
	useTailscaleRecoveryUiStore.setState({
		recoveryState: hiddenTailscaleRecoveryUiState,
		actions: null,
	});
}

beforeEach(() => {
	resetStore();
});

void test('Tailscale recovery UI store starts hidden without actions', () => {
	const state = useTailscaleRecoveryUiStore.getState();

	assert.deepEqual(state.recoveryState, { phase: 'hidden' });
	assert.equal(state.actions, null);
});

void test('Tailscale recovery UI store exposes attention and recovering states', () => {
	const store = useTailscaleRecoveryUiStore.getState();

	store.setRecoveryState({
		phase: 'needsAttention',
		message: 'Open Tailscale, then retry Fressh.',
	});
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'needsAttention',
		message: 'Open Tailscale, then retry Fressh.',
	});

	useTailscaleRecoveryUiStore.getState().setRecoveryState({
		phase: 'recovering',
		message: 'Resetting Tailscale...',
	});
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'recovering',
		message: 'Resetting Tailscale...',
	});
});

void test('Tailscale recovery UI store clears visible state back to hidden', () => {
	useTailscaleRecoveryUiStore.getState().setRecoveryState({
		phase: 'needsAttention',
		message: 'Open Tailscale.',
	});

	useTailscaleRecoveryUiStore.getState().clearRecoveryState();

	assert.deepEqual(
		useTailscaleRecoveryUiStore.getState().recoveryState,
		{ phase: 'hidden' },
	);
});

void test('Tailscale recovery UI store registers and clears action handlers', () => {
	const calls: string[] = [];
	const actions: TailscaleRecoveryUiActions = {
		openTailscale: () => calls.push('open'),
		retry: () => calls.push('retry'),
		reset: () => calls.push('reset'),
	};

	useTailscaleRecoveryUiStore.getState().setActions(actions);
	useTailscaleRecoveryUiStore.getState().actions?.openTailscale();
	useTailscaleRecoveryUiStore.getState().actions?.retry();
	useTailscaleRecoveryUiStore.getState().actions?.reset();

	assert.deepEqual(calls, ['open', 'retry', 'reset']);

	useTailscaleRecoveryUiStore.getState().clearActions();

	assert.equal(useTailscaleRecoveryUiStore.getState().actions, null);
});
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-ui-store.test.ts
```

Expected: FAIL with an import error for `../../src/lib/tailscale-recovery-ui-store`.

- [ ] **Step 3: Implement the UI store**

Create `apps/mobile/src/lib/tailscale-recovery-ui-store.ts`:

```ts
import { create } from 'zustand';
import { type TailscaleRecoveryBannerState } from './TailscaleRecoveryBannerPresentation';

export type TailscaleRecoveryUiActions = {
	openTailscale: () => void;
	retry: () => void;
	reset: () => void;
};

type TailscaleRecoveryUiStore = {
	recoveryState: TailscaleRecoveryBannerState;
	actions: TailscaleRecoveryUiActions | null;
	setRecoveryState: (state: TailscaleRecoveryBannerState) => void;
	clearRecoveryState: () => void;
	setActions: (actions: TailscaleRecoveryUiActions) => void;
	clearActions: () => void;
};

export const hiddenTailscaleRecoveryUiState: TailscaleRecoveryBannerState = {
	phase: 'hidden',
};

export const useTailscaleRecoveryUiStore = create<TailscaleRecoveryUiStore>(
	(set) => ({
		recoveryState: hiddenTailscaleRecoveryUiState,
		actions: null,
		setRecoveryState: (state) => set({ recoveryState: state }),
		clearRecoveryState: () =>
			set({ recoveryState: hiddenTailscaleRecoveryUiState }),
		setActions: (actions) => set({ actions }),
		clearActions: () => set({ actions: null }),
	}),
);
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-ui-store.test.ts
```

Expected: PASS for all four tests.

- [ ] **Step 5: Commit the store task**

```bash
git add apps/mobile/src/lib/tailscale-recovery-ui-store.ts apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts
git commit -m "Add Tailscale recovery UI store"
```

### Task 2: Inline Panel Presentation

**Files:**
- Modify: `apps/mobile/src/lib/TailscaleRecoveryBannerPresentation.ts`
- Modify: `apps/mobile/test/integration/tailscale-recovery-banner.test.ts`
- Create: `apps/mobile/src/lib/TailscaleRecoveryPanel.tsx`

**Interfaces:**
- Consumes:
  - `TailscaleRecoveryBannerState`
  - `TailscaleRecoveryUiActions | null`
  - `useTheme()`
- Produces:
  - `getTailscaleRecoveryBannerPresentation(state, colors, options?)`, where `options?: { actionsAvailable?: boolean }`
  - `TailscaleRecoveryPanel(props: { state: TailscaleRecoveryBannerState; actions: TailscaleRecoveryUiActions | null }): React.ReactElement | null`

- [ ] **Step 1: Write the failing presentation test for missing handlers**

Append this test to `apps/mobile/test/integration/tailscale-recovery-banner.test.ts`:

```ts
void test('Tailscale recovery presentation disables visible actions when handlers are unavailable', () => {
	const presentation = getTailscaleRecoveryBannerPresentation(
		{
			phase: 'needsAttention',
			message: 'Open Tailscale, then retry Fressh.',
		},
		colors,
		{ actionsAvailable: false },
	);

	assert.equal(presentation.visible, true);
	if (!presentation.visible) return;

	assert.deepEqual(
		presentation.actions.map((action) => ({
			id: action.id,
			disabled: action.disabled,
		})),
		[
			{ id: 'openTailscale', disabled: true },
			{ id: 'retry', disabled: true },
			{ id: 'reset', disabled: true },
		],
	);
});
```

- [ ] **Step 2: Run the presentation tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-banner.test.ts
```

Expected: FAIL because visible actions remain enabled when `actionsAvailable` is `false`.

- [ ] **Step 3: Update the presentation helper**

Modify `apps/mobile/src/lib/TailscaleRecoveryBannerPresentation.ts` so the function signature and disabled calculation look like this:

```ts
type TailscaleRecoveryBannerPresentationOptions = {
	actionsAvailable?: boolean;
};

export function getTailscaleRecoveryBannerPresentation(
	state: TailscaleRecoveryBannerState,
	colors: TailscaleRecoveryBannerColors,
	options: TailscaleRecoveryBannerPresentationOptions = {},
): TailscaleRecoveryBannerPresentation {
	if (state.phase === 'hidden') return { visible: false };

	const disabled =
		state.phase === 'recovering' || options.actionsAvailable === false;
	return {
		visible: true,
		title: 'Tailscale connection needs attention',
		message: state.message,
		primaryBackgroundColor: disabled ? colors.primaryDisabled : colors.primary,
		actions: [
			{
				id: 'openTailscale',
				label: 'Open Tailscale',
				disabled,
			},
			{ id: 'retry', label: 'Retry', disabled },
			{ id: 'reset', label: 'Reset', disabled },
		],
	};
}
```

Keep the existing exported state/action/presentation types above this block unchanged.

- [ ] **Step 4: Run the presentation tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-banner.test.ts
```

Expected: PASS for hidden, enabled, recovering, and unavailable-handler cases.

- [ ] **Step 5: Create the inline panel component**

Create `apps/mobile/src/lib/TailscaleRecoveryPanel.tsx`:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
	getTailscaleRecoveryBannerPresentation,
	type TailscaleRecoveryBannerState,
} from './TailscaleRecoveryBannerPresentation';
import { type TailscaleRecoveryUiActions } from './tailscale-recovery-ui-store';
import { useTheme } from './theme';

export function TailscaleRecoveryPanel(props: {
	state: TailscaleRecoveryBannerState;
	actions: TailscaleRecoveryUiActions | null;
}) {
	const theme = useTheme();
	const presentation = getTailscaleRecoveryBannerPresentation(
		props.state,
		theme.colors,
		{ actionsAvailable: props.actions !== null },
	);

	if (!presentation.visible) return null;
	const [openAction, retryAction, resetAction] = presentation.actions;

	return (
		<View
			style={[
				styles.panel,
				{
					backgroundColor: theme.colors.surface,
					borderColor: theme.colors.border,
					shadowColor: theme.colors.shadow,
				},
			]}
		>
			<Text style={[styles.title, { color: theme.colors.textPrimary }]}>
				{presentation.title}
			</Text>
			<Text style={[styles.message, { color: theme.colors.textSecondary }]}>
				{presentation.message}
			</Text>
			<View style={styles.actions}>
				<Pressable
					accessibilityRole="button"
					disabled={openAction.disabled}
					onPress={props.actions?.openTailscale}
					style={[
						styles.button,
						styles.primaryButton,
						{ backgroundColor: presentation.primaryBackgroundColor },
						openAction.disabled && styles.disabledButton,
					]}
				>
					<Text
						style={[
							styles.buttonText,
							{ color: theme.colors.buttonTextOnPrimary },
						]}
					>
						{openAction.label}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={retryAction.disabled}
					onPress={props.actions?.retry}
					style={[
						styles.button,
						styles.secondaryButton,
						{
							backgroundColor: theme.colors.surface,
							borderColor: theme.colors.border,
						},
						retryAction.disabled && styles.disabledButton,
					]}
				>
					<Text style={[styles.buttonText, { color: theme.colors.textPrimary }]}>
						{retryAction.label}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={resetAction.disabled}
					onPress={props.actions?.reset}
					style={[
						styles.button,
						styles.secondaryButton,
						{
							backgroundColor: theme.colors.surface,
							borderColor: theme.colors.border,
						},
						resetAction.disabled && styles.disabledButton,
					]}
				>
					<Text style={[styles.buttonText, { color: theme.colors.textPrimary }]}>
						{resetAction.label}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	panel: {
		borderRadius: 8,
		borderWidth: 1,
		padding: 12,
		gap: 8,
		marginBottom: 16,
		shadowOpacity: 0.18,
		shadowRadius: 10,
		shadowOffset: { width: 0, height: 3 },
		elevation: 5,
	},
	title: {
		fontSize: 14,
		fontWeight: '700',
	},
	message: {
		fontSize: 12,
		lineHeight: 17,
	},
	actions: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 8,
	},
	button: {
		minHeight: 44,
		borderRadius: 6,
		paddingHorizontal: 12,
		paddingVertical: 8,
		alignItems: 'center',
		justifyContent: 'center',
	},
	primaryButton: {
		borderWidth: 0,
	},
	secondaryButton: {
		borderWidth: 1,
	},
	disabledButton: {
		opacity: 0.75,
	},
	buttonText: {
		fontSize: 12,
		fontWeight: '700',
	},
});
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-banner.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the presentation task**

```bash
git add apps/mobile/src/lib/TailscaleRecoveryBannerPresentation.ts apps/mobile/src/lib/TailscaleRecoveryPanel.tsx apps/mobile/test/integration/tailscale-recovery-banner.test.ts
git commit -m "Add inline Tailscale recovery panel"
```

### Task 3: Move AutoConnectManager UI Handoff Into The Store

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Test: `apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts`

**Interfaces:**
- Consumes:
  - `hiddenTailscaleRecoveryUiState`
  - `useTailscaleRecoveryUiStore`
  - `TailscaleRecoveryUiActions`
- Produces:
  - `AutoConnectManager` no longer renders `TailscaleRecoveryBanner`.
  - `AutoConnectManager` updates store state via `setRecoveryState` / `clearRecoveryState`.
  - `AutoConnectManager` registers handlers for `openTailscale`, `retry`, and `reset`.

- [ ] **Step 1: Extend the store test with a source-level no-overlay guard**

Append this test to `apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

void test('AutoConnectManager owns recovery policy without rendering the Tailscale overlay', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/auto-connect.tsx'),
		'utf8',
	);

	assert.match(source, /useTailscaleRecoveryUiStore/);
	assert.doesNotMatch(source, /TailscaleRecoveryBanner/);
	assert.doesNotMatch(source, /<TailscaleRecoveryBanner/);
});
```

When adding the imports, merge them with the existing imports at the top of the file:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, test } from 'node:test';
```

- [ ] **Step 2: Run the store tests to verify the new guard fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-ui-store.test.ts
```

Expected: FAIL because `auto-connect.tsx` still imports or renders `TailscaleRecoveryBanner`.

- [ ] **Step 3: Update `auto-connect.tsx` imports**

In `apps/mobile/src/lib/auto-connect.tsx`, remove this import:

```ts
import {
	TailscaleRecoveryBanner,
	type TailscaleRecoveryBannerState,
} from './TailscaleRecoveryBanner';
```

Add this import:

```ts
import {
	hiddenTailscaleRecoveryUiState,
	type TailscaleRecoveryUiActions,
	useTailscaleRecoveryUiStore,
} from './tailscale-recovery-ui-store';
```

- [ ] **Step 4: Replace local UI state with store writes**

In `apps/mobile/src/lib/auto-connect.tsx`, delete:

```ts
type TailscaleRecoveryUiState = TailscaleRecoveryBannerState;

const hiddenTailscaleRecoveryState: TailscaleRecoveryUiState = {
	phase: 'hidden',
};
```

Then replace the local `useState` and callbacks:

```ts
const [tailscaleRecoveryUiState, setTailscaleRecoveryUiState] =
	React.useState<TailscaleRecoveryUiState>(hiddenTailscaleRecoveryState);
const clearTailscaleAttentionState = React.useCallback(() => {
	setTailscaleRecoveryUiState(hiddenTailscaleRecoveryState);
}, []);
const markTailscaleAttentionState = React.useCallback((message: string) => {
	setTailscaleRecoveryUiState({ phase: 'needsAttention', message });
}, []);
```

with:

```ts
const clearTailscaleAttentionState = React.useCallback(() => {
	useTailscaleRecoveryUiStore
		.getState()
		.setRecoveryState(hiddenTailscaleRecoveryUiState);
}, []);
const markTailscaleAttentionState = React.useCallback((message: string) => {
	useTailscaleRecoveryUiStore.getState().setRecoveryState({
		phase: 'needsAttention',
		message,
	});
}, []);
```

In the coordinator `attention.recovering` callback, replace:

```ts
setTailscaleRecoveryUiState({
	phase: 'recovering',
	message,
});
```

with:

```ts
useTailscaleRecoveryUiStore.getState().setRecoveryState({
	phase: 'recovering',
	message,
});
```

- [ ] **Step 5: Register action handlers in the store**

In `apps/mobile/src/lib/auto-connect.tsx`, after the existing `handleOpenTailscale`, `handleRetryAfterTailscaleRecovery`, and `handleResetTailscale` callbacks are declared, add:

```ts
React.useEffect(() => {
	const actions: TailscaleRecoveryUiActions = {
		openTailscale: handleOpenTailscale,
		retry: handleRetryAfterTailscaleRecovery,
		reset: handleResetTailscale,
	};
	useTailscaleRecoveryUiStore.getState().setActions(actions);
	return () => {
		useTailscaleRecoveryUiStore.getState().clearActions();
	};
}, [
	handleOpenTailscale,
	handleResetTailscale,
	handleRetryAfterTailscaleRecovery,
]);
```

- [ ] **Step 6: Remove root-level Tailscale rendering**

In the `return` block of `AutoConnectManager`, replace:

```tsx
return (
	<>
		<AgentNotificationBridgeManager
			preservePendingWithoutTarget={reconnectExpectedFromShellDrop}
		/>
		<TailscaleRecoveryBanner
			state={tailscaleRecoveryUiState}
			onOpenTailscale={handleOpenTailscale}
			onRetry={handleRetryAfterTailscaleRecovery}
			onReset={handleResetTailscale}
		/>
	</>
);
```

with:

```tsx
return (
	<AgentNotificationBridgeManager
		preservePendingWithoutTarget={reconnectExpectedFromShellDrop}
	/>
);
```

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-ui-store.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: both commands PASS.

- [ ] **Step 8: Commit the AutoConnect handoff task**

```bash
git add apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/tailscale-recovery-ui-store.test.ts
git commit -m "Move Tailscale recovery UI handoff into store"
```

### Task 4: Render The Panel Inside The Connect Tab

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/index.tsx`
- Create: `apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts`

**Interfaces:**
- Consumes:
  - `TailscaleRecoveryPanel`
  - `useTailscaleRecoveryUiStore`
- Produces:
  - Connect tab renders `<TailscaleRecoveryPanel state={tailscaleRecoveryUiState} actions={tailscaleRecoveryActions} />` above the SSH form card.
  - Source-level placement test protects against reintroducing root overlay rendering.

- [ ] **Step 1: Write the failing placement test**

Create `apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

void test('Connect tab owns the inline Tailscale recovery panel', () => {
	const source = readFileSync(
		require.resolve('../../src/app/(tabs)/index.tsx'),
		'utf8',
	);

	assert.match(source, /TailscaleRecoveryPanel/);
	assert.match(source, /useTailscaleRecoveryUiStore/);
	assert.match(source, /state=\{tailscaleRecoveryUiState\}/);
	assert.match(source, /actions=\{tailscaleRecoveryActions\}/);
});

void test('AutoConnectManager does not render Tailscale recovery UI directly', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/auto-connect.tsx'),
		'utf8',
	);

	assert.doesNotMatch(source, /<TailscaleRecoveryPanel/);
	assert.doesNotMatch(source, /<TailscaleRecoveryBanner/);
});

void test('Inline Tailscale panel does not use overlay positioning', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/TailscaleRecoveryPanel.tsx'),
		'utf8',
	);

	assert.doesNotMatch(source, /position:\s*'absolute'/);
	assert.doesNotMatch(source, /zIndex/);
	assert.doesNotMatch(source, /useSafeAreaInsets/);
});
```

- [ ] **Step 2: Run the placement test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-ui-placement.test.ts
```

Expected: FAIL because the Connect tab does not yet import or render `TailscaleRecoveryPanel`.

- [ ] **Step 3: Import the inline panel and store in the Connect tab**

In `apps/mobile/src/app/(tabs)/index.tsx`, add these imports near the existing lib imports:

```ts
import { TailscaleRecoveryPanel } from '@/lib/TailscaleRecoveryPanel';
import { useTailscaleRecoveryUiStore } from '@/lib/tailscale-recovery-ui-store';
```

- [ ] **Step 4: Subscribe to recovery UI state in `Host`**

Inside the `Host` component in `apps/mobile/src/app/(tabs)/index.tsx`, after `const theme = useTheme();`, add:

```ts
const tailscaleRecoveryUiState = useTailscaleRecoveryUiStore(
	(state) => state.recoveryState,
);
const tailscaleRecoveryActions = useTailscaleRecoveryUiStore(
	(state) => state.actions,
);
```

- [ ] **Step 5: Render the panel above the SSH form card**

In `apps/mobile/src/app/(tabs)/index.tsx`, inside the inner padded `<View>`, place the panel after the title block and before the existing form card `<View>`.

The surrounding JSX should look like this:

```tsx
<View style={{ marginBottom: 16, alignItems: 'center' }}>
	<Text
		style={{
			fontSize: 28,
			fontWeight: '800',
			color: theme.colors.textPrimary,
			letterSpacing: 1,
		}}
	>
		fressh
	</Text>
	<Text style={{ marginTop: 4, fontSize: 13, color: theme.colors.muted }}>
		A fast, friendly SSH client
	</Text>
</View>
<TailscaleRecoveryPanel
	state={tailscaleRecoveryUiState}
	actions={tailscaleRecoveryActions}
/>
<View
	style={{
		backgroundColor: theme.colors.surface,
		borderRadius: 20,
		padding: 24,
		marginHorizontal: 4,
		shadowColor: theme.colors.shadow,
		shadowOpacity: 0.3,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: 4 },
		elevation: 8,
		borderWidth: 1,
		borderColor: theme.colors.borderStrong,
	}}
>
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-ui-placement.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the Connect tab placement task**

```bash
git add 'apps/mobile/src/app/(tabs)/index.tsx' apps/mobile/test/integration/tailscale-recovery-ui-placement.test.ts
git commit -m "Render Tailscale recovery panel in Connect tab"
```

### Task 5: Final Verification And Cleanup

**Files:**
- Optional delete: `apps/mobile/src/lib/TailscaleRecoveryBanner.tsx`, only if `rg "TailscaleRecoveryBanner" apps/mobile/src apps/mobile/test` shows no remaining component import except presentation names and tests.
- Modify: no docs required unless implementation intentionally differs from this plan.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified implementation with no app-wide Tailscale overlay and no unused root banner component.

- [ ] **Step 1: Check whether the old overlay component is still imported**

Run:

```bash
rg -n "from './TailscaleRecoveryBanner'|from '@/lib/TailscaleRecoveryBanner'|<TailscaleRecoveryBanner" apps/mobile/src apps/mobile/test/integration
```

Expected: no matches.

- [ ] **Step 2: Delete the unused overlay component if it is unreferenced**

If Step 1 reports no imports, delete `apps/mobile/src/lib/TailscaleRecoveryBanner.tsx`:

```bash
rm apps/mobile/src/lib/TailscaleRecoveryBanner.tsx
```

If the file still has a legitimate import, keep it and document the import in the final handoff.

- [ ] **Step 3: Check for stale overlay styling after cleanup**

Run:

```bash
rg -n "TailscaleRecoveryBanner|position:\\s*'absolute'|zIndex|useSafeAreaInsets" apps/mobile/src/lib apps/mobile/src/app apps/mobile/test/integration
```

Expected: remaining `TailscaleRecoveryBanner` matches are limited to `TailscaleRecoveryBannerPresentation.ts` and `tailscale-recovery-banner.test.ts`. There should be no `position: 'absolute'`, `zIndex`, or `useSafeAreaInsets` match in `TailscaleRecoveryPanel.tsx`.

- [ ] **Step 4: Run the full mobile integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS.

- [ ] **Step 5: Run mobile typecheck and lint check**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
```

Expected: both commands PASS.

- [ ] **Step 6: Manual Android preview verification**

Use an Android preview build or existing preview install. Do not clear app data.

Verify:

1. Trigger or simulate a Tailscale attention state.
2. Open the Connect tab.
3. Confirm the controls appear inline above the SSH form, inside the Connect screen layout.
4. Open Shell and Settings.
5. Confirm neither tab shows a Tailscale popover or panel.
6. Press `Open Tailscale`, `Retry`, and `Reset` from the Connect tab panel.
7. Confirm each action invokes the same recovery behavior as before.

- [ ] **Step 7: Commit cleanup and verification changes**

```bash
git add apps/mobile/src apps/mobile/test/integration
git commit -m "Verify inline Tailscale recovery UI"
```

If Step 2 did not delete any file and no files changed after Task 4, skip this commit and include the verification results in the final handoff.

## Self-Review

- Spec coverage: Task 1 creates the shared state/action handoff; Task 2 creates the inline panel and disabled missing-handler behavior; Task 3 removes root overlay rendering while preserving auto-connect policy; Task 4 renders the UI only inside the Connect tab; Task 5 verifies no overlay behavior remains and covers manual Android preview.
- Placeholder scan: The plan contains no deferred implementation sections. Each code-changing step includes the exact code or replacement snippet needed for the worker.
- Type consistency: `TailscaleRecoveryUiActions`, `useTailscaleRecoveryUiStore`, `recoveryState`, and `actions` are defined in Task 1 and used consistently in Tasks 2-4.
