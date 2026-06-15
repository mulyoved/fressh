# Work Key Floating Long-Press Stripe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Work key long-press stripe render above the keyboard when the top row has no room, while preserving direct stripe selection and horizontal-lane fallback.

**Architecture:** Keep all gesture state and rendering inside `TerminalKeyboard`. Put geometry and hit-testing rules in `apps/mobile/src/lib/keyboard-long-press.ts`, then have the component pass measured keyboard/key geometry into those helpers and allow upward overflow from the keyboard root.

**Tech Stack:** Expo React Native, TypeScript, Node `tsx --test`, pnpm workspace scripts.

---

## Scope Check

This plan implements one narrow mobile keyboard behavior change. It does not
touch shell configuration, Workmux actions, app-level modal infrastructure, or
Android signing/build settings.

The worktree currently has an unrelated modified file:

- `apps/mobile/android/app/src/main/res/values/strings.xml`

Leave that file untouched unless the user separately asks to modify it.

## File Structure

- Modify `apps/mobile/src/lib/keyboard-long-press.ts`
  - Owns pure layout, movement, hit-testing, and release-decision logic.
  - This is where top-row overflow placement and hybrid popup/lane selection belong.

- Modify `apps/mobile/test/integration/keyboard-long-press.test.ts`
  - Owns focused tests for the pure helper behavior.
  - Tests should prove layout, direct floating-popup hit testing, keyboard-lane fallback, and cancellation.

- Modify `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
  - Owns measured key/root geometry, gesture state, and rendering.
  - This file should only pass geometry to helpers, guard bad measurements, and allow the popup to visibly overflow above the keyboard.

## Implementation Tasks

### Task 1: Add Overflow-Aware Popup Layout

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-long-press.test.ts`
- Modify: `apps/mobile/src/lib/keyboard-long-press.ts`

- [ ] **Step 1: Write failing layout tests**

In `apps/mobile/test/integration/keyboard-long-press.test.ts`, replace the test beginning with:

```ts
void test('long press popup centers above the anchor and clamps to keyboard bounds', () => {
```

with this complete test:

```ts
void test('long press popup centers above the anchor and clamps horizontally', () => {
	assert.deepEqual(
		getLongPressPopupLayout({
			keyboardWidth: 320,
			anchorX: 140,
			anchorY: 200,
			anchorWidth: 40,
			optionCount: 2,
		}),
		{
			left: 74,
			top: 146,
			width: 172,
			height: 44,
			optionWidth: 86,
		},
	);

	assert.equal(
		getLongPressPopupLayout({
			keyboardWidth: 180,
			anchorX: 4,
			anchorY: 200,
			anchorWidth: 40,
			optionCount: 2,
		}).left,
		6,
	);
});

void test('long press popup can overflow above the keyboard for top-row anchors', () => {
	assert.deepEqual(
		getLongPressPopupLayout({
			keyboardWidth: 320,
			anchorX: 140,
			anchorY: 6,
			anchorWidth: 40,
			optionCount: 2,
		}),
		{
			left: 74,
			top: -48,
			width: 172,
			height: 44,
			optionWidth: 86,
		},
	);

	assert.deepEqual(
		getLongPressPopupLayout({
			keyboardWidth: 320,
			anchorX: 140,
			anchorY: 6,
			anchorWidth: 40,
			optionCount: 5,
		}),
		{
			left: 6,
			top: -48,
			width: 430,
			height: 44,
			optionWidth: 86,
		},
	);
});
```

- [ ] **Step 2: Run the focused test and verify the new test fails**

Run:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: FAIL. The new top-row overflow assertion should report an actual `top` of `6` where the test expects `-48`.

- [ ] **Step 3: Implement overflow-aware layout**

In `apps/mobile/src/lib/keyboard-long-press.ts`, replace the `return` block inside `getLongPressPopupLayout` with this complete block:

```ts
	const top = anchorY - popupHeight - popupGap;

	return {
		left: clamp(centeredLeft, horizontalMargin, maxLeft),
		top,
		width,
		height: popupHeight,
		optionWidth,
	};
```

The full function should read:

```ts
export function getLongPressPopupLayout({
	keyboardWidth,
	anchorX,
	anchorY,
	anchorWidth,
	optionCount,
}: {
	keyboardWidth: number;
	anchorX: number;
	anchorY: number;
	anchorWidth: number;
	optionCount: number;
}): LongPressPopupLayout {
	const width = Math.max(optionWidth, optionCount * optionWidth);
	const centeredLeft = anchorX + anchorWidth / 2 - width / 2;
	const maxLeft = Math.max(
		horizontalMargin,
		keyboardWidth - width - horizontalMargin,
	);
	const top = anchorY - popupHeight - popupGap;

	return {
		left: clamp(centeredLeft, horizontalMargin, maxLeft),
		top,
		width,
		height: popupHeight,
		optionWidth,
	};
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: PASS for all tests in `keyboard-long-press.test.ts`.

- [ ] **Step 5: Commit Task 1**

Run:

```sh
git add apps/mobile/src/lib/keyboard-long-press.ts apps/mobile/test/integration/keyboard-long-press.test.ts
git commit -m "Allow long-press popup to overflow above keyboard"
```

Expected: commit succeeds and does not include `apps/mobile/android/app/src/main/res/values/strings.xml`.

### Task 2: Add Hybrid Popup-First Hit Testing

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-long-press.test.ts`
- Modify: `apps/mobile/src/lib/keyboard-long-press.ts`

- [ ] **Step 1: Write failing tracking tests**

In `apps/mobile/test/integration/keyboard-long-press.test.ts`, after the existing test named `long press tracking selects by horizontal lane inside keyboard bounds`, add this complete test:

```ts
void test('long press tracking prioritizes floating popup before keyboard lane fallback', () => {
	const layout = {
		left: 74,
		top: -48,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 0, width: 320, height: 180 };

	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: -30,
			previousIndex: null,
		}),
		1,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 20,
			localY: 80,
			previousIndex: 1,
		}),
		0,
	);
	assert.equal(
		getLongPressTrackedOptionIndex({
			layout,
			keyboardBounds,
			localX: 180,
			localY: -80,
			previousIndex: 1,
		}),
		null,
	);
});
```

- [ ] **Step 2: Write failing release tests**

In `apps/mobile/test/integration/keyboard-long-press.test.ts`, after the existing test named `long press release selects by horizontal lane inside keyboard bounds`, add this complete test:

```ts
void test('long press release prioritizes floating popup before keyboard lane fallback', () => {
	const layout = {
		left: 74,
		top: -48,
		width: 172,
		height: 44,
		optionWidth: 86,
	};
	const keyboardBounds = { left: 0, top: 0, width: 320, height: 180 };

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 20,
			releasePageX: 180,
			releasePageY: -30,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: null,
		}),
		{ type: 'option', optionIndex: 1 },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 20,
			releasePageX: 20,
			releasePageY: 80,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: 1,
		}),
		{ type: 'option', optionIndex: 0 },
	);

	assert.deepEqual(
		getLongPressReleaseDecision({
			longPressFired: true,
			movedBeyondTapSlop: false,
			startPageX: 100,
			startPageY: 20,
			releasePageX: 180,
			releasePageY: -80,
			tapSlopPx: 8,
			rootX: 0,
			rootY: 0,
			popupLayout: layout,
			keyboardBounds,
			highlightedIndex: 1,
		}),
		{ type: 'cancel' },
	);
});
```

- [ ] **Step 3: Run the focused test and verify the new tests fail**

Run:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: FAIL. The first assertion in each new test should return `null` or `{ type: 'cancel' }` instead of option index `1`.

- [ ] **Step 4: Add a popup-first helper**

In `apps/mobile/src/lib/keyboard-long-press.ts`, add this function after `getLongPressKeyboardBoundedOptionIndex`:

```ts
export function getLongPressPopupFirstOptionIndex({
	layout,
	keyboardBounds,
	localX,
	localY,
}: {
	layout: LongPressPopupLayout;
	keyboardBounds?: LongPressKeyboardBounds | null;
	localX: number;
	localY: number;
}): number | null {
	const popupOptionIndex = getLongPressOptionIndexAtPoint({
		layout,
		localX,
		localY,
	});
	if (popupOptionIndex != null) {
		return popupOptionIndex;
	}

	if (!keyboardBounds) {
		return null;
	}

	return getLongPressKeyboardBoundedOptionIndex({
		layout,
		keyboardBounds,
		localX,
		localY,
	});
}
```

- [ ] **Step 5: Use popup-first tracking**

In `apps/mobile/src/lib/keyboard-long-press.ts`, replace the body of `getLongPressTrackedOptionIndex` with this complete body:

```ts
	if (keyboardBounds) {
		return getLongPressPopupFirstOptionIndex({
			layout,
			keyboardBounds,
			localX,
			localY,
		});
	}

	const optionIndex = getLongPressOptionIndexAtPoint({
		layout,
		localX,
		localY,
	});
	if (optionIndex != null || previousIndex == null) {
		return optionIndex;
	}

	const previousLeft = layout.left + previousIndex * layout.optionWidth;
	const previousRight = previousLeft + layout.optionWidth;
	return localX >= previousLeft && localX < previousRight
		? previousIndex
		: null;
```

The full function should read:

```ts
export function getLongPressTrackedOptionIndex({
	layout,
	keyboardBounds,
	localX,
	localY,
	previousIndex,
}: {
	layout: LongPressPopupLayout;
	keyboardBounds?: LongPressKeyboardBounds | null;
	localX: number;
	localY: number;
	previousIndex: number | null;
}): number | null {
	if (keyboardBounds) {
		return getLongPressPopupFirstOptionIndex({
			layout,
			keyboardBounds,
			localX,
			localY,
		});
	}

	const optionIndex = getLongPressOptionIndexAtPoint({
		layout,
		localX,
		localY,
	});
	if (optionIndex != null || previousIndex == null) {
		return optionIndex;
	}

	const previousLeft = layout.left + previousIndex * layout.optionWidth;
	const previousRight = previousLeft + layout.optionWidth;
	return localX >= previousLeft && localX < previousRight
		? previousIndex
		: null;
}
```

- [ ] **Step 6: Use popup-first release decisions**

In `apps/mobile/src/lib/keyboard-long-press.ts`, replace this block inside `getLongPressReleaseDecision`:

```ts
		const optionIndex = keyboardBounds
			? getLongPressKeyboardBoundedOptionIndex({
					layout: popupLayout,
					keyboardBounds,
					localX,
					localY,
				})
			: getLongPressOptionIndexAtPoint({
					layout: popupLayout,
					localX,
					localY,
				});
```

with this block:

```ts
		const optionIndex = getLongPressPopupFirstOptionIndex({
			layout: popupLayout,
			keyboardBounds,
			localX,
			localY,
		});
```

Do not remove the existing highlighted-index fallback that runs when `keyboardBounds` is absent.

- [ ] **Step 7: Run the focused test and verify it passes**

Run:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: PASS for all tests in `keyboard-long-press.test.ts`.

- [ ] **Step 8: Commit Task 2**

Run:

```sh
git add apps/mobile/src/lib/keyboard-long-press.ts apps/mobile/test/integration/keyboard-long-press.test.ts
git commit -m "Support floating long-press hit testing"
```

Expected: commit succeeds and does not include `apps/mobile/android/app/src/main/res/values/strings.xml`.

### Task 3: Wire Floating Rendering Into TerminalKeyboard

**Files:**
- Modify: `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`

- [ ] **Step 1: Guard invalid measurements before opening a popup**

In `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`, inside `openLongPressPopup`, replace this block:

```ts
				const root = keyboardRootWindowRef.current;
				const layout = getLongPressPopupLayout({
					keyboardWidth: keyboardWidthRef.current,
					anchorX: x - root.x,
					anchorY: y - root.y,
					anchorWidth: width,
					optionCount: options.length,
				});
```

with this block:

```ts
				const root = keyboardRootWindowRef.current;
				const keyboardWidth = keyboardWidthRef.current;
				if (keyboardWidth <= 0 || width <= 0) {
					return;
				}

				const layout = getLongPressPopupLayout({
					keyboardWidth,
					anchorX: x - root.x,
					anchorY: y - root.y,
					anchorWidth: width,
					optionCount: options.length,
				});
```

- [ ] **Step 2: Allow the keyboard root to render upward overflow**

In the root `<View>` returned by `TerminalKeyboard`, replace this style block:

```ts
				style={{
					borderTopWidth: 1,
					borderColor: theme.colors.border,
					padding: 6,
					position: 'relative',
				}}
```

with this style block:

```ts
				style={{
					borderTopWidth: 1,
					borderColor: theme.colors.border,
					padding: 6,
					position: 'relative',
					overflow: 'visible',
					zIndex: 1,
				}}
```

- [ ] **Step 3: Ensure the popup draws above sibling keyboard content**

In the long-press popup `<View>` style, replace this block:

```ts
							position: 'absolute',
							left: longPressPopup.layout.left,
							top: longPressPopup.layout.top,
							width: longPressPopup.layout.width,
							height: longPressPopup.layout.height,
```

with this block:

```ts
							position: 'absolute',
							left: longPressPopup.layout.left,
							top: longPressPopup.layout.top,
							width: longPressPopup.layout.width,
							height: longPressPopup.layout.height,
							zIndex: 2,
```

- [ ] **Step 4: Run the focused helper test**

Run:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: PASS for all tests in `keyboard-long-press.test.ts`.

- [ ] **Step 5: Run TypeScript typecheck for the mobile app**

Run:

```sh
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit Task 3**

Run:

```sh
git add apps/mobile/src/app/shell/components/TerminalKeyboard.tsx
git commit -m "Render long-press stripe above top-row keys"
```

Expected: commit succeeds and does not include `apps/mobile/android/app/src/main/res/values/strings.xml`.

### Task 4: Final Verification

**Files:**
- Verify: `apps/mobile/src/lib/keyboard-long-press.ts`
- Verify: `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
- Verify: `apps/mobile/test/integration/keyboard-long-press.test.ts`

- [ ] **Step 1: Run the focused helper test**

Run:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

Expected: PASS for all tests in `keyboard-long-press.test.ts`.

- [ ] **Step 2: Run the mobile integration suite**

Run:

```sh
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS for the mobile integration suite.

- [ ] **Step 3: Run mobile typecheck**

Run:

```sh
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Inspect the final diff**

Run:

```sh
git diff --stat HEAD~3..HEAD
git diff -- apps/mobile/src/lib/keyboard-long-press.ts apps/mobile/src/app/shell/components/TerminalKeyboard.tsx apps/mobile/test/integration/keyboard-long-press.test.ts
git status --short
```

Expected:

- The committed diff only changes `keyboard-long-press.ts`, `TerminalKeyboard.tsx`, and `keyboard-long-press.test.ts`.
- `git status --short` may still show the pre-existing unrelated `apps/mobile/android/app/src/main/res/values/strings.xml` change, but it must not be staged.

- [ ] **Step 5: Manual device check on the preview app**

Use an existing preview/dev install of `com.finalapp.vibe2`. Do not clear app data.

Check this flow:

1. Open a shell session that shows the mobile terminal keyboard.
2. Long-press the top-row Work key.
3. Confirm the stripe appears above the keyboard, not over the Work key.
4. Keep the finger inside the keyboard and slide left/right; confirm highlight follows horizontal lanes.
5. Slide into the visible stripe; confirm highlight follows the exact stripe option under the finger.
6. Release on `Next`; confirm the Work next action runs.
7. Long-press Work again, move above the keyboard but outside the stripe, then release; confirm no Work option runs.

- [ ] **Step 6: Commit verification notes if code changed during verification**

If verification required code changes, make the focused fix, rerun Steps 1-4, then commit the changed files:

```sh
git add apps/mobile/src/lib/keyboard-long-press.ts apps/mobile/src/app/shell/components/TerminalKeyboard.tsx apps/mobile/test/integration/keyboard-long-press.test.ts
git commit -m "Fix Work key floating stripe verification issue"
```

Expected: commit succeeds only when verification produced code changes. If no code changed during verification, skip this commit step.

## Self-Review Checklist

- Spec coverage:
  - Top-row overflow placement is covered by Task 1.
  - Existing non-top-row placement is covered by Task 1's unchanged normal-row assertion.
  - Direct floating-stripe hit testing is covered by Task 2.
  - Keyboard-lane fallback is covered by Task 2 and existing tests.
  - Cancellation outside both stripe and keyboard is covered by Task 2.
  - Keyboard-root overflow rendering and invalid measurement guard are covered by Task 3.
  - Focused and broader verification are covered by Task 4.

- Type consistency:
  - Existing exported types remain `LongPressPopupLayout`, `LongPressReleaseDecision`, `LongPressMoveState`, and `LongPressKeyboardBounds`.
  - New helper name is `getLongPressPopupFirstOptionIndex`.
  - Existing component state shape remains `LongPressPopupState`.

- Scope guard:
  - No task edits `apps/mobile/config/shell-config.json`.
  - No task edits Workmux actions.
  - No task edits Android resource strings.
