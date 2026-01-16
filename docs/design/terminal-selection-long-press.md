# Terminal Long-Press Selection Plan

**Overall Progress:** `88%`

## Tasks:

- [x] 🟩 **Step 1: Remove auto-copy + selection toggle UI (RN)**
  - [x] 🟩 Remove auto-copy on selection change in `apps/mobile/src/app/shell/detail.tsx`
  - [x] 🟩 Remove manual selection toggle from `TerminalKeyboard` wiring
  - [x] 🟩 Keep Copy/Paste actions but make them explicit (no auto-copy)

- [x] 🟩 **Step 2: Add long-press entry to selection mode (WebView)**
  - [x] 🟩 Implement touch long-press detection in `packages/react-native-xtermjs-webview/src-internal/main.tsx`
  - [x] 🟩 On long-press: enable selection mode, set initial selection, expand to word
  - [x] 🟩 Add 300ms guard to prevent immediate hide after selection appears

- [x] 🟩 **Step 3: Add DOM handles for precise selection (WebView)**
  - [x] 🟩 Render start/end handles inside WebView DOM
  - [x] 🟩 Drag logic: map pixel → cell, clamp ordering, update xterm selection
  - [x] 🟩 No autoscroll while dragging

- [x] 🟩 **Step 4: Action bar + exit rules (RN)**
  - [x] 🟩 Show Copy/Paste action bar only when selection is active
  - [x] 🟩 Copy/Paste exits selection mode
  - [x] 🟩 Typing exits selection mode (disable selection before sending input)

- [ ] 🟨 **Step 5: Android-only QA checklist**
  - [x] 🟩 Long-press selects a word and shows handles
  - [ ] 🟥 Drag handles adjust selection correctly (no autoscroll)
  - [ ] 🟥 Copy/Paste exits selection and works
  - [ ] 🟥 Typing exits selection
  - [ ] 🟥 300ms guard prevents immediate cancel
