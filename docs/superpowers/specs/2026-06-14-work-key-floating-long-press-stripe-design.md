# Work Key Floating Long-Press Stripe Design

## Problem

The Work key lives on the top row of the mobile terminal keyboard. Its
long-press stripe currently uses the same "above the key, clamped inside the
keyboard" placement as other keys. Because the Work key is already on the top
row, that clamp pushes the stripe down into the key row. The user's finger can
cover the stripe, so the available Work actions are hard to see.

Other rows work better because there is enough vertical space above the pressed
key for the stripe to appear above the finger.

## Goal

Show the Work long-press stripe above the keyboard when the top row does not
have enough in-keyboard space. The stripe should be visible above the user's
finger while preserving the current forgiving long-press selection behavior.

## Non-Goals

- Do not change the Work key configuration or its long-press options.
- Do not introduce an app-level modal or portal for this narrow placement fix.
- Do not change normal long-press placement for keys that already have enough
  space above their row.
- Do not redesign keyboard styling.

## Chosen Approach

Use a keyboard overflow hybrid.

`TerminalKeyboard` remains responsible for long-press gesture state and popup
rendering. The popup layout helper gains enough geometry to place the stripe
above the keyboard root when the usual above-anchor placement would collide
with the keyboard's top edge. The keyboard root allows visible upward overflow
so a negative popup `top` can render as a floating stripe above the keyboard.

This keeps the change local to the existing keyboard component and long-press
helper. It avoids moving gesture state into the shell screen, while still
allowing the stripe to escape the cramped top row.

## Placement Behavior

For keys with enough room above the anchor, the stripe keeps the current
behavior:

- Center horizontally on the pressed key.
- Clamp horizontally to the keyboard width with the existing side margin.
- Render above the key with the existing vertical gap.

For keys without enough room above the anchor, such as the top-row Work key:

- Keep the same horizontal centering and side clamping.
- Place the stripe above the keyboard root using a negative `top`.
- Keep the existing stripe size and visual style.
- Do not reserve layout space above the keyboard; the stripe floats over the
  terminal area while visible.

## Selection Behavior

Selection must support both precise popup hit testing and the existing forgiving
keyboard-lane model:

1. If the finger releases inside the visible stripe, select the option under
   the finger.
2. If the finger remains inside the keyboard bounds, keep the current
   horizontal-lane behavior. This lets users slide left and right on the
   keyboard without needing to reach the floating stripe exactly.
3. If the finger is outside both the visible stripe and the keyboard bounds,
   cancel the long press.

Move highlighting should follow the same priority: exact stripe hit first,
then keyboard-lane fallback, then no highlight.

## Implementation Surface

- `apps/mobile/src/lib/keyboard-long-press.ts`
  - Extend layout calculation so it can return an overflow-above-keyboard
    layout when the top edge lacks room.
  - Add or adjust hit-testing helpers to check the visible popup bounds before
    falling back to keyboard-bounded horizontal lanes.
  - Keep constants for margins, popup height, option width, and gap centralized
    in this helper.

- `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
  - Continue owning the long-press gesture and popup state.
  - Pass the geometry needed by the layout helper.
  - Allow the keyboard root to render overflow above itself.
  - Preserve existing repeat-key, tap, cancel, and accessibility behavior.

- `apps/mobile/test/integration/keyboard-long-press.test.ts`
  - Cover normal row placement.
  - Cover top-row overflow placement.
  - Cover direct hit testing inside a floating stripe above the keyboard.
  - Cover keyboard-lane fallback inside the keyboard bounds.
  - Cover cancellation outside both the stripe and keyboard bounds.

## Error Handling And Edge Cases

- If keyboard or anchor measurement is missing or zero-sized, preserve current
  defensive behavior by not opening a broken popup.
- If the stripe is wider than the keyboard, keep current horizontal clamping
  behavior rather than resizing options.
- If the finger moves above the keyboard but misses the stripe, do not infer a
  selection by horizontal lane; cancel instead.
- Existing non-top-row keys should not visually regress.

## Testing

Use focused unit/integration tests for the pure long-press helper because the
important behavior is geometry and hit testing. Run the mobile integration test
file that covers keyboard long press:

```sh
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-long-press.test.ts
```

For broader confidence, run the mobile integration suite:

```sh
pnpm --filter @fressh/mobile test:integration
```
