# Android Text Entry Modal Keyboard Focus

## Summary

On Android, the Text Entry modal opens with the text area focused, but the OS
keyboard does not appear until the user taps the text area manually. The goal is
to make the keyboard open automatically as soon as the modal appears.

This document collects relevant code, evidence, and likely causes to help a new
developer investigate without prior project knowledge.

## Expected vs Actual

- Expected: Opening the Text Entry modal shows the Android keyboard immediately.
- Actual: Keyboard stays hidden until the user taps inside the text area.

## Repro Steps (Android)

1) Open a shell session in the app.
2) Tap the on-screen keyboard "Text" action (opens the Text Entry modal).
3) Observe: text area appears focused, but keyboard does not show.
4) Tap the text area manually: keyboard appears immediately.

## Relevant Code (Evidence)

### Text Entry modal (focus is already attempted)

- `apps/mobile/src/app/shell/components/TextEntryModal.tsx`
  - Uses `autoFocus` on the `TextInput`.
  - Also calls `inputRef.current?.focus()` after a 50ms timeout when `open` is
    true.
  - The modal is `transparent` with `animationType="slide"`.

Focus logic:
- `useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) })`
- `TextInput` has `autoFocus`.

### Modal open action (keyboard is explicitly dismissed)

- `apps/mobile/src/app/shell/detail.tsx`
  - `openTextEditor` action:
    - Calls `Keyboard.dismiss()` before `setTextEntryOpen(true)`.
    - This is likely meant to hide the terminal keyboard before showing the
      modal.

### App-level keyboard handling

- `apps/mobile/src/app/_layout.tsx`
  - Wraps the app with `KeyboardProvider` from
    `react-native-keyboard-controller`.
- `apps/mobile/app.config.ts`
  - Android `softwareKeyboardLayoutMode: 'pan'`.

## Why This Is Suspicious

- The modal already tries to focus the text input twice (autoFocus + timeout).
  The keyboard still does not appear.
- Android often requires focus to happen *after* a modal is fully presented.
  The focus is currently triggered before the modal animation finishes.
- Calling `Keyboard.dismiss()` right before opening the modal may prevent a
  programmatic show from succeeding immediately afterward.

## Hypotheses

1) **Timing issue**: `focus()` runs before the modal is fully shown.
2) **Keyboard.dismiss interference**: dismissing the keyboard just before opening
   the modal prevents the automatic show.
3) **Modal + autoFocus limitation** on Android: `TextInput` autoFocus is not
   reliable inside `Modal` without `onShow` or post-animation focus.
4) **Keyboard controller interaction**: `react-native-keyboard-controller` may
   alter default behavior for programmatic keyboard display.
5) **Window mode**: `softwareKeyboardLayoutMode: 'pan'` could impact how/when
   the keyboard is presented in modals.

## Suggested Experiments

1) **Focus on modal show**
   - Use `Modal` `onShow` to call `inputRef.current?.focus()`.
   - Also test `InteractionManager.runAfterInteractions` or a 150-300ms delay.

2) **Remove or delay `Keyboard.dismiss()`**
   - Temporarily remove `Keyboard.dismiss()` in `openTextEditor`.
   - Or move it earlier (before opening the action menu) or later (after modal
     open).

3) **Force keyboard show (if supported)**
   - `react-native-keyboard-controller` exposes `KeyboardController.show()`.
   - Try calling it after focus to verify if the keyboard can be forced open.

4) **Disable animation for test**
   - Set `animationType="none"` temporarily to see if autoFocus works without
     animation delays.

5) **Try `showSoftInputOnFocus`**
   - Set `showSoftInputOnFocus={true}` explicitly on the `TextInput`.

6) **Check layout mode impact**
   - Temporarily change Android `softwareKeyboardLayoutMode` to `resize` and
     compare behavior.

## What To Record

- Device model + Android version
- Whether issue reproduces on emulator vs physical device
- Log timestamps around `TextEntryModal` open and focus
- Whether keyboard appears if focus is delayed longer (e.g. 300ms)

## Goal

Make Android show the keyboard automatically when the Text Entry modal opens,
without requiring a manual tap.

