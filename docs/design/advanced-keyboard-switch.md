# Advanced Keyboard Switch Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Define advanced keyboard + switch action in configurator source**
  - [x] 🟩 Add `advanced_keyboard` JSON (clone of `phone_base`) in `react-ttyd` data
  - [x] 🟩 Add `OPEN_ADVANCED_KEYBOARD` action and labels/icons in configurator defaults
  - [x] 🟩 Update default grids to place “Advanced” (row 0, col 3) and “Back” (same slot)

- [x] 🟩 **Step 2: Wire runtime behavior in the mobile app**
  - [x] 🟩 Handle `OPEN_ADVANCED_KEYBOARD` and keep menus inactive in action routing
  - [x] 🟩 Implement auto-return to `phone_base` after first advanced key press
  - [x] 🟩 Ensure “Back” key on advanced triggers `OPEN_MAIN_MENU` (auto-return still applies)

- [x] 🟩 **Step 3: Regenerate and verify keyboard output**
  - [x] 🟩 Run keyboard codegen to update `/apps/mobile/src/generated`
  - [x] 🟩 Smoke-check keyboard switching flow in the terminal screen
