# Terminal Selection Handle Drag Offset Plan

**Overall Progress:** `67%`

## Tasks:

- [x] 🟩 **Step 1: Update selection-handle drag behavior in WebView**
  - [x] 🟩 Track pointer-to-anchor offset and drag start threshold (8px)
  - [x] 🟩 Apply offset on move and clamp adjusted coords to screen bounds
  - [x] 🟩 Reset drag state on pointerup/cancel

- [x] 🟩 **Step 2: Sync built WebView HTML**
  - [x] 🟩 Update `packages/react-native-xtermjs-webview/dist-internal/index.html`

- [ ] 🟥 **Step 3: Manual verification**
  - [ ] 🟥 Confirm handle does not jump on tap; drag starts after ~8px; clamp works (Android)
