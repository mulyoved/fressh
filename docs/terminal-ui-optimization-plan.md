# Terminal UI Optimization Plan

## Overview
Maximize terminal screen real estate by removing all chrome (headers, borders, tab bars) and consolidating actions into the keyboard toolbar.

## Current State Analysis

### Screenshot Analysis
From the current shell detail screen:
- **Header bar**: Shows "muly@dev-remote-machine-1" with "Close Shell" button (~50px)
- **Terminal borders**: 2px border on all sides + 8px left/right padding
- **Gap**: 4px gap between terminal and keyboard
- **Keyboard toolbar**: 2 rows, 100px height total
- **Bottom tab bar**: Hosts, Shells, Settings (~50px)

### Current File Structure
```
apps/mobile/src/app/(tabs)/
├── _layout.tsx          # Tab bar configuration (NativeTabs)
├── shell/
│   ├── _layout.tsx      # Shell stack configuration
│   ├── index.tsx        # Shell list
│   └── detail.tsx       # Shell terminal view (MAIN FILE TO MODIFY)

packages/react-native-xtermjs-webview/src/
└── index.tsx            # Xterm configuration (font settings)
```

---

## Detailed Implementation Plan

### Step 1: Increase Terminal Font Size

**File:** `/home/muly/fressh/packages/react-native-xtermjs-webview/src/index.tsx`

**Current Code (lines 65-72):**
```typescript
const defaultXtermOptions: Partial<ITerminalOptions> = {
  allowProposedApi: true,
  convertEol: true,
  scrollback: 10000,
  cursorBlink: true,
  fontFamily: 'Menlo, ui-monospace, monospace',
  fontSize: 10,
};
```

**Change to:**
```typescript
const defaultXtermOptions: Partial<ITerminalOptions> = {
  allowProposedApi: true,
  convertEol: true,
  scrollback: 10000,
  cursorBlink: true,
  fontFamily: 'ui-monospace, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", "Roboto Mono", monospace',
  fontSize: 20,
};
```

**Rationale:**
- Double font size (10 → 20) for better readability on tablet
- Use system monospace font stack for maximum compatibility across devices

---

### Step 2: Remove Header from Shell Detail

**File:** `/home/muly/fressh/apps/mobile/src/app/(tabs)/shell/detail.tsx`

**Current Code (lines 170-199):**
```typescript
<Stack.Screen
  options={{
    headerBackVisible: true,
    title: `${connection?.connectionDetails.username}@${connection?.connectionDetails.host}`,
    headerRight: () => (
      <Pressable
        accessibilityLabel="Close Shell"
        // ... Close Shell button
      </Pressable>
    ),
  }}
/>
```

**Change to:**
```typescript
<Stack.Screen
  options={{
    headerShown: false,
  }}
/>
```

**Note:** The "Close Shell" functionality will be moved to the settings button in the keyboard toolbar.

---

### Step 3: Remove Terminal Borders and Padding

**File:** `/home/muly/fressh/apps/mobile/src/app/(tabs)/shell/detail.tsx`

#### 3a. Remove outer View padding (lines 158-168)

**Current:**
```typescript
<View
  style={{
    justifyContent: 'flex-start',
    backgroundColor: theme.colors.background,
    paddingTop: 2,
    paddingLeft: 8,
    paddingRight: 8,
    paddingBottom: 0,
    marginBottom,
    flex: 1,
  }}
>
```

**Change to:**
```typescript
<View
  style={{
    justifyContent: 'flex-start',
    backgroundColor: theme.colors.background,
    paddingTop: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: 0,
    flex: 1,
  }}
>
```

**Note:** Also remove `marginBottom` since we're hiding the tab bar.

#### 3b. Remove KeyboardAvoidingView gap (line 204)

**Current:**
```typescript
<KeyboardAvoidingView
  behavior="height"
  keyboardVerticalOffset={120}
  style={{ flex: 1, gap: 4 }}
>
```

**Change to:**
```typescript
<KeyboardAvoidingView
  behavior="height"
  keyboardVerticalOffset={120}
  style={{ flex: 1, gap: 0 }}
>
```

#### 3c. Remove terminal container border (lines 207-212)

**Current:**
```typescript
<View
  style={{
    flex: 1,
    borderWidth: 2,
    borderColor: theme.colors.border,
  }}
>
```

**Change to:**
```typescript
<View
  style={{
    flex: 1,
  }}
>
```

---

### Step 4: Hide Tab Bar on Shell Detail Screen

**File:** `/home/muly/fressh/apps/mobile/src/app/(tabs)/shell/detail.tsx`

There are multiple approaches to hide the tab bar:

#### Option A: Use Expo Router's native tabs hiding (Recommended)
Add to Stack.Screen options or use a layout effect to hide tabs when this screen is focused.

#### Option B: Remove useBottomTabSpacing
**Current Code (line 123):**
```typescript
const marginBottom = useBottomTabSpacing();
```

This hook adds bottom margin to account for the tab bar. Since we're removing the tab bar on this screen, we can remove this.

#### Option C: Conditional Tab Bar Visibility
Modify `/home/muly/fressh/apps/mobile/src/app/(tabs)/_layout.tsx` to hide tabs based on current route.

**Implementation:** Check Expo Router documentation for `tabBarStyle: { display: 'none' }` or use a context/state to conditionally hide tabs.

---

### Step 5: Add Third Keyboard Row with Settings Button

**File:** `/home/muly/fressh/apps/mobile/src/app/(tabs)/shell/detail.tsx`

#### 5a. Update KeyboardToolbar height

**Current (lines 302-331):**
```typescript
function KeyboardToolbar() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 100,  // 2 rows × 50px each
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
```

**Change to:**
```typescript
function KeyboardToolbar() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 150,  // 3 rows × 50px each
        borderWidth: 0,  // Remove border
      }}
    >
```

#### 5b. Add third row

**Current structure:**
```typescript
<KeyboardToolbarRow>
  {/* Row 1: ESC, /, |, HOME, UP, END, PGUP */}
</KeyboardToolbarRow>
<KeyboardToolbarRow>
  {/* Row 2: TAB, CTRL, ALT, LEFT, DOWN, RIGHT, PGDN */}
</KeyboardToolbarRow>
```

**New structure:**
```typescript
<KeyboardToolbarRow>
  {/* Row 1: ESC, /, |, HOME, UP, END, PGUP */}
</KeyboardToolbarRow>
<KeyboardToolbarRow>
  {/* Row 2: TAB, CTRL, ALT, LEFT, DOWN, RIGHT, PGDN */}
</KeyboardToolbarRow>
<KeyboardToolbarRow>
  {/* Row 3: Settings button + empty slots for future keys */}
  <SettingsButton />
  <EmptySlot />
  <EmptySlot />
  <EmptySlot />
  <EmptySlot />
  <EmptySlot />
  <EmptySlot />
</KeyboardToolbarRow>
```

---

### Step 6: Create Settings Button and Modal

**File:** `/home/muly/fressh/apps/mobile/src/app/(tabs)/shell/detail.tsx`

#### 6a. Add state for modal visibility

```typescript
function ShellDetail() {
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  // ... existing code
}
```

#### 6b. Create SettingsButton component

```typescript
function SettingsButton() {
  const theme = useTheme();
  const { setSettingsModalVisible } = useContextSafe(ShellDetailContext);

  return (
    <Pressable
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
      onPress={() => setSettingsModalVisible(true)}
    >
      <Ionicons name="settings-outline" size={20} color={theme.colors.textPrimary} />
    </Pressable>
  );
}
```

#### 6c. Create Settings Modal

```typescript
function SettingsModal({ visible, onClose, onCloseShell }: {
  visible: boolean;
  onClose: () => void;
  onCloseShell: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <View style={{ backgroundColor: theme.colors.surface, padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <Pressable
            style={{ padding: 16, borderRadius: 8 }}
            onPress={onCloseShell}
          >
            <Text style={{ color: theme.colors.danger, fontSize: 16 }}>Close Shell</Text>
          </Pressable>

          {/* Placeholder for future actions */}
          <Pressable
            style={{ padding: 16, borderRadius: 8, opacity: 0.5 }}
            disabled
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: 16 }}>Reconnect (coming soon)</Text>
          </Pressable>

          <Pressable
            style={{ padding: 16, borderRadius: 8, marginTop: 8 }}
            onPress={onClose}
          >
            <Text style={{ color: theme.colors.textPrimary, fontSize: 16, textAlign: 'center' }}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
```

#### 6d. Add EmptySlot component for future keys

```typescript
function EmptySlot() {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: 0.3,
      }}
    />
  );
}
```

---

## Implementation Order

| Step | Description | Effort | Risk |
|------|-------------|--------|------|
| 1 | Font size & family | Low | Low |
| 2 | Remove header | Low | Low |
| 3 | Remove borders/padding | Low | Low |
| 4 | Hide tab bar | Medium | Medium |
| 5 | Add 3rd keyboard row | Medium | Low |
| 6 | Settings modal | Medium | Low |

**Recommended order:** 1 → 3 → 2 → 5 → 6 → 4

Start with font changes (immediate visual feedback), then structural changes, then navigation changes last (most complex).

---

## Testing Checklist

- [ ] Font size is readable on tablet
- [ ] Terminal uses full screen width (no left/right gaps)
- [ ] Terminal uses full height (no top gap from header)
- [ ] No gap between terminal and keyboard
- [ ] Tab bar is hidden when viewing terminal
- [ ] Third keyboard row displays correctly
- [ ] Settings button opens modal
- [ ] "Close Shell" in modal works correctly
- [ ] Can navigate back to shell list after closing shell
- [ ] Hot reload works during development

---

## Future Enhancements (Out of Scope)

- Add more keys to third row (INSERT, DELETE, etc.)
- Reconnect functionality in settings
- Copy/Paste actions
- Font size adjustment in settings
- Keyboard layout customization
