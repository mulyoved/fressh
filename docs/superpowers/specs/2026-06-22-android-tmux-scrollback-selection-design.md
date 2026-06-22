# Android Tmux Scrollback Selection Design

## Problem

On Android tablet tmux sessions, touch scrolling is app-owned: the WebView
drives remote tmux scrollback while local xterm scrollback is disabled. After
the user scrolls back, the jump-to-live button appears. If the user then
long-presses text in that scrolled-back view, the terminal jumps back before
selection can start, so the intended text cannot be selected.

The code path causing the reset is that the touch-scroll controller pins the
local xterm viewport to bottom on the initial touch down. At that point the
gesture has not yet been classified as a scroll, tap, or long press. A
long-press selection gesture should not mutate scroll position before selection
computes its coordinates.

## Goals

- Preserve the current scrolled-back tmux view when a user long-presses to
  select text.
- Keep existing remote touch-scroll behavior once movement crosses the scroll
  slop threshold.
- Keep the selection and touch-scroll responsibilities separate.
- Add a focused regression test for the premature bottom pin.

## Non-Goals

- Redesigning selection handles or copy UI.
- Changing tmux scrollback command semantics.
- Replacing app-owned touch scrolling with local xterm scrollback.
- Changing phone or non-tmux terminal behavior.

## Approach

Use a simple ownership rule: tracking is observational, scrolling is mutating.

On `pointerdown` or `touchstart`, `touch-scroll-controller` should only record
the active pointer, start coordinates, timestamps, and tracking state. It must
not call `pinLocalViewportToBottom()`, request scrollback entry, or otherwise
change the rendered terminal position.

On `pointermove`, after movement exceeds `slopPx`, the controller owns the
gesture as a scroll. It should keep the current behavior from that point:
cancel pending long-press selection, switch to `Scrolling`, request or maintain
remote scrollback, emit the dragging state, pin local xterm to bottom, capture
the pointer, and batch scroll lines.

On `pointerup` without crossing scroll slop, the controller should end tracking
without pinning or exiting scrollback. This lets `selection-handles` complete a
long-press selection at the currently displayed tmux scrollback position.

## Components

- `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.ts`
  owns remote scroll gestures and local xterm bottom pinning during active
  scrolling.
- `packages/react-native-xtermjs-webview/src-internal/selection-handles.ts`
  owns long-press selection activation and selection range updates.
- `apps/mobile/src/app/shell/detail.tsx` remains the RN bridge owner for
  scrollback mode events, scrollback enter requests, batches, and selection mode
  changes.

No new shared abstraction is needed. The fix should stay inside the existing
touch-scroll controller boundary.

## Data Flow

1. User scrolls back in an Android tablet tmux session.
2. RN marks scrollback active and displays the jump-to-live button.
3. User touches the scrolled-back terminal.
4. Touch-scroll enters `Tracking` only; it does not pin local xterm to bottom.
5. If movement exceeds slop, touch-scroll becomes `Scrolling` and preserves the
   current remote-scroll behavior.
6. If the touch remains still long enough, selection handles enter selection
   mode and seed selection at the current displayed coordinates.

## Error Handling

Existing cleanup paths remain unchanged:

- Lost scrollback enter acknowledgements still time out and clear pending
  requests.
- Pointer cancel still exits or resets pending scrollback state as it does
  today.
- Explicit jump-to-live and remote reset flows still use the existing
  scrollback cleanup logic.

The change only removes the premature bottom pin before a gesture is known to
be scrolling.

## Testing

Add a regression test in
`packages/react-native-xtermjs-webview/src-internal/interaction-state.test.ts`
that enables touch scroll, dispatches `pointerdown`, and asserts that a fake
`scrollToBottom` callback has not been called.

Keep or tighten the existing test that verifies local xterm stays pinned during
remote scroll so it proves the pin still happens after movement crosses scroll
slop and scrolling begins.

## Acceptance Criteria

- In Android tablet tmux scrollback, long-pressing text after scrolling back no
  longer jumps to live before selection starts.
- Drag scrolling still enters tmux scrollback and scrolls with the same batching
  behavior.
- The focused interaction tests pass.
