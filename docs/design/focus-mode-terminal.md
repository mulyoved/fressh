# Focus Mode Terminal Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Separate terminal detail route from tabs**
  - [x] 🟩 Move `apps/mobile/src/app/(tabs)/shell/detail.tsx` to `apps/mobile/src/app/shell/detail.tsx`
  - [x] 🟩 Remove the old `(tabs)` detail file to avoid duplicate routes
  - [x] 🟩 Update `apps/mobile/src/app/(tabs)/shell/_layout.tsx` to drop the `detail` screen

- [x] 🟩 **Step 2: Apply Focus Mode layout to detail screen**
  - [x] 🟩 Keep the existing loading skeleton
  - [x] 🟩 Remove header, outer padding, gaps, and terminal container border
  - [x] 🟩 Remove toolbar container border, keep button borders
  - [x] 🟩 Remove `useBottomTabSpacing` usage
  - [x] 🟩 Use iOS-only `KeyboardAvoidingView` behavior; avoid Android double shifting
  - [x] 🟩 Replace `KeyboardToolBarContext` usage with `.Provider`

- [x] 🟩 **Step 3: Update xterm defaults for tablet focus mode**
  - [x] 🟩 Change `defaultXtermOptions` font stack to JetBrains Mono–preferred list
  - [x] 🟩 Set `fontSize: 16` in `packages/react-native-xtermjs-webview/src/index.tsx`

- [x] 🟩 **Step 4: Verify behavior aligns with decisions**
  - [x] 🟩 Terminal detail has no tab bar or reserved space
  - [x] 🟩 Toolbar always visible; no extra chrome
  - [x] 🟩 Edge-to-edge layout (ignores safe areas)
  - [x] 🟩 Keyboard behavior correct on iOS and Android
