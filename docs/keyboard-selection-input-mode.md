# Keyboard Focus + Selection Mode Architecture (Mobile Terminal)

## Summary
This document explains how the current keyboard/selection flow is wired, why OS-keyboard focus does not appear reliably on Android, and the tradeoffs around keeping selection enabled while typing. It also summarizes how similar terminal apps handle the same UX problem, and proposes minimal, low-risk improvements.

## Current Architecture (Fressh)

### UI / React Native
- **Screen:** `apps/mobile/src/app/shell/detail.tsx`
  - `TerminalKeyboard` renders the UI rows for extra keys and toggles.
  - `systemKeyboardEnabled` controls whether OS keyboard should be allowed.
  - `selectionModeEnabled` controls a copy/selection mode.
  - `toggleSystemKeyboard` toggles OS keyboard on Android.
  - `toggleSelectionMode` toggles selection mode.

### WebView Terminal Bridge
- **Component:** `packages/react-native-xtermjs-webview/src/index.tsx`
  - Exposes imperative methods via `XtermWebViewHandle`.
  - `focus()` sends a `focus` message to the WebView and calls `requestFocus()` on the native WebView.
  - `setSystemKeyboardEnabled(true)` toggles the hidden textarea to be focusable and focuses it.

### WebView / xterm.js internals
- **WebView script:** `packages/react-native-xtermjs-webview/src-internal/main.tsx`
  - `setSelectionModeEnabled(true)` currently:
    - Sets `term.options.disableStdin = true` (disables input).
    - Enables `screenReaderMode`.
    - Enables the selection service and installs a transparent overlay to capture drag gestures.
  - This is done to make touch selection reliable, but it prevents typing while selection is active.

Relevant internal code (selection mode):

```ts
// packages/react-native-xtermjs-webview/src-internal/main.tsx
if (enabled) {
  try {
    term.options.disableStdin = true;
    term.options.screenReaderMode = true;
  } catch (err) {
    // ...
  }
  selectionService?.enable?.();
  term.element?.classList.remove('enable-mouse-events');
  // ... overlay to capture touch drags
}
```

Relevant internal code (OS keyboard enable):

```ts
// packages/react-native-xtermjs-webview/src/index.tsx
const setSystemKeyboardEnabled = useCallback((enabled: boolean) => {
  const js = `
  (() => {
    const ta = document.querySelector('.xterm-helper-textarea');
    if (!ta) return true;
    ta.setAttribute('inputmode', ${enabled ? "'verbatim'" : "'none'"});
    ta.tabIndex = ${enabled ? 0 : -1};
    if (${enabled ? 'true' : 'false'}) {
      ta.removeAttribute('readonly');
      ta.focus();
    } else {
      ta.setAttribute('readonly', 'true');
      ta.blur();
    }
    return true;
  })();`;
  webViewRef.injectJavaScript(js);
  if (enabled) {
    webViewRef.requestFocus();
  }
}, []);
```

## Problem Recap
- When the user toggles OS keyboard **on**, the focus remains on the toggle button, so Android does not always show the OS keyboard.
- The terminal requires focus on the hidden textarea inside the WebView to open the keyboard consistently (this is a known xterm.js/mobile behavior).
- Selection mode currently disables stdin, so keeping selection always enabled would prevent typing.

## What Similar Projects Do (Research)

### Blink Shell (iOS)
- Uses **gesture-based selection** rather than leaving selection always on.
- Selection mode is activated by tap+drag, and the app provides a context bar for shortcuts.
- This keeps typing the default and selection a temporary mode.

### Termius (iOS/Android)
- Highlights a **keyboard add‑on** for missing keys and gesture support for navigation.
- The emphasis is on providing extra keys + gestures instead of keeping selection always on.

### Termux (Android)
- Provides a **customizable extra‑keys row** (ESC, CTRL, arrows, etc.).
- Users toggle extra keys and keyboard visibility rather than keeping selection always on.

### xterm.js (Web)
- xterm.js provides a `disableStdin` option to explicitly disable input (used by our selection mode).
- xterm.js mobile support issues emphasize the need to focus the **hidden textarea** to get reliable keyboard events on mobile.
 
## External References
- Blink Shell docs: https://docs.blink.sh/
- Termius mobile highlights: https://termius.com/documentation/sync-to-mobile
- Termux extra keys overview: https://mobile-coding-hub.github.io/termux/customisation/extra_keys/
- xterm.js ITerminalOptions (disableStdin): https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
- xterm.js mobile keyboard issue (#1101): https://github.com/xtermjs/xterm.js/issues/1101

## Implications for “Selection Always On”
- Our selection mode intentionally disables input (`disableStdin = true`), so **typing and selection are mutually exclusive** today.
- Keeping selection always enabled would require changing selection mode to **not disable stdin** and to avoid intercepting touch events that should be used for typing.
- This is not a trivial change: selection currently relies on a full‑screen overlay to capture drag gestures, and that overlay would block taps intended to focus/typing.

## Proposed Solutions (from lowest risk to highest)

### Option A (Minimal / Recommended)
**When OS keyboard is toggled on, immediately focus the terminal and disable selection mode.**
- This matches the patterns in Blink/Termius/Termux: selection is a temporary state, typing is the default.
- Minimal change in `ShellDetail` (already implemented in code):

```ts
const toggleSystemKeyboard = useCallback(() => {
  if (Platform.OS !== 'android') return;
  setSystemKeyboardEnabled((prev) => {
    const next = !prev;
    xtermRef.current?.setSystemKeyboardEnabled(next);
    if (next) {
      setSelectionModeEnabled(false);
      xtermRef.current?.setSelectionModeEnabled(false);
      // Defer focus until the pressable releases
      setTimeout(() => {
        xtermRef.current?.focus();
      }, 0);
    } else {
      Keyboard.dismiss();
    }
    return next;
  });
}, []);
```

### Option B (Hybrid “momentary selection”)
**Keep typing enabled but allow selection via a “press-and-hold” overlay.**
- Add a long‑press gesture on the terminal that temporarily enables selection overlay.
- On press end, automatically restore typing mode.
- This keeps typing primary, selection temporary, and avoids UI toggles.

### Option C (Always-on selection + typing)
**Allow selection without disabling stdin.**
- Requires rewriting `applySelectionMode` to avoid `disableStdin` and to only enable selection on explicit drag.
- This is riskier: input, scrolling, and terminal mouse protocols may conflict.
- Would require careful device testing and likely extra heuristics for touch vs. keyboard input.

## Recommendation
Given current constraints and the behavior of comparable terminal apps, **Option A** is the most stable and least risky. It also matches user expectations (tap keyboard → typing works immediately).

If long‑term UX demands “select while typing”, Option B is a safer middle step than Option C. Option C should be treated as a larger product investment with dedicated QA.

## Testing Checklist
- Toggle OS keyboard ON → terminal gains focus, keyboard appears immediately.
- Toggle OS keyboard ON while selection mode is active → selection mode clears and typing works.
- Toggle OS keyboard OFF → keyboard dismisses.
- Re‑enable selection mode → selection overlay works and disables stdin (expected).
