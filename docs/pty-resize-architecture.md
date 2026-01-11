# PTY Resize Architecture Analysis

## Problem Statement

When connecting to a remote tmux session via Fressh mobile app, the terminal displays at a fixed size (set at connection time) and **never updates** when the screen size changes. The same tmux session viewed from a desktop terminal correctly fills the screen and responds to window resizing.

**Symptoms:**
- tmux status bar (green bar) appears in the middle of the screen instead of the bottom
- Remote applications don't adapt to the mobile screen dimensions
- Resizing the screen (keyboard show/hide, rotation) has no effect on the remote PTY

## Root Cause

The issue is a **three-layer architecture gap** where terminal resize events don't propagate from the UI to the remote SSH PTY:

1. **xterm.js resizes visually** but doesn't report the new dimensions back to React Native
2. **No API exists** in the SSH shell interface to send PTY resize commands
3. **The remote shell/tmux never receives** SSH window-change notifications

## Architecture Analysis

### Current Data Flow (Broken)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Screen Resize  │────▶│  xterm.js fit() │────▶│  Visual resize  │ ✅
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │
                                ▼
                        ❌ NO CALLBACK
                        (cols/rows not reported)
                                │
                                ▼
                        ❌ NO API METHOD
                        (shell.resizePty() missing)
                                │
                                ▼
                        ❌ REMOTE PTY UNCHANGED
                        (tmux stays at initial size)
```

### Expected Data Flow (Fixed)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Screen Resize  │────▶│  xterm.js fit() │────▶│  Visual resize  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │ onResize(c,r)   │  Report new cols/rows
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │ shell.resize()  │  Send to SSH channel
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │ PTY window-change│  SSH protocol message
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │ tmux resizes    │  Remote app adapts
                        └─────────────────┘
```

## Evidence from Codebase

### 1. PTY Size Set Only Once at Shell Startup

**File:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
**Lines:** 231-241

```rust
ch.request_pty(
    true,
    term.as_ssh_name(),
    col_width,      // Set once at startup
    row_height,     // Never updated after
    pixel_width,
    pixel_height,
    &modes,
)
.await?;
ch.request_shell(true).await?;
```

The PTY dimensions are passed during the initial `request_pty()` call and are never updated afterward.

### 2. Shell Interface Missing Resize Method

**File:** `packages/react-native-uniffi-russh/lib/typescript/src/api.ts`
**Lines:** 121-149

```typescript
export type SshShell = {
    readonly channelId: number;
    readonly pty: TerminalType;
    readonly connectionId: string;

    sendData: (data: ArrayBuffer) => Promise<void>;
    close: () => Promise<void>;

    // MISSING:
    // resizePty(cols: number, rows: number): Promise<void>;
};
```

The `SshShell` interface only exposes `sendData()` and `close()`. There is no method to send PTY resize requests.

### 3. Rust Shell Session Lacks Resize Capability

**File:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
**Lines:** 226-242

```rust
impl ShellSession {
    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), SshError>
    pub async fn close(&self) -> Result<(), SshError>
    // No resize_pty() method
}
```

The Rust `ShellSession` struct doesn't implement any PTY resize functionality.

### 4. xterm.js fit() Doesn't Report Back

**File:** `packages/react-native-xtermjs-webview/src/index.tsx`
**Lines:** 220-222

```typescript
const fit = useCallback(() => {
    sendToWebView({ type: 'fit' });  // Fire and forget
}, [sendToWebView]);
```

The `fit()` method sends a message to the webview but receives no response with the new dimensions.

### 5. Bridge Missing Size Change Message

**File:** `packages/react-native-xtermjs-webview/src/bridge.ts`

```typescript
// Inbound messages (WebView → React Native)
export type BridgeInboundMessage =
    | { type: 'initialized' }
    | { type: 'input'; str: string }
    | { type: 'debug'; message: string };
    // MISSING: { type: 'sizeChanged'; cols: number; rows: number }
```

There's no message type for reporting terminal size changes from the webview back to React Native.

### 6. Current onLayout Handler (Incomplete)

**File:** `apps/mobile/src/app/shell/detail.tsx`
**Lines:** 385-388

```typescript
onLayout: () => {
    // Refit terminal when container size changes
    xtermRef.current?.fit();
    // MISSING: Get new size and send to SSH shell
},
```

The layout handler calls `fit()` but doesn't query the new dimensions or update the SSH PTY.

## Required Fixes

### Layer 1: xterm.js WebView Bridge

**Files to modify:**
- `packages/react-native-xtermjs-webview/src/bridge.ts`
- `packages/react-native-xtermjs-webview/src-internal/main.tsx`

**Changes:**
1. Add `sizeChanged` message type to `BridgeInboundMessage`
2. After `fitAddon.fit()`, send new `term.cols` and `term.rows` back to RN

### Layer 2: React Native XtermJsWebView Component

**Files to modify:**
- `packages/react-native-xtermjs-webview/src/index.tsx`

**Changes:**
1. Add `onResize?: (cols: number, rows: number) => void` callback prop
2. Handle incoming `sizeChanged` messages and invoke the callback

### Layer 3: Rust SSH Shell

**Files to modify:**
- `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- `packages/react-native-uniffi-russh/src/api.ts`

**Changes:**
1. Add `resize_pty(cols: u32, rows: u32)` method to `ShellSession`
2. Implement SSH `window-change` request using the channel
3. Export the method via UniFFI bindings
4. Add `resizePty()` to TypeScript interface

### Layer 4: Mobile App Integration

**Files to modify:**
- `apps/mobile/src/app/shell/detail.tsx`

**Changes:**
1. Add `onResize` handler to `XtermJsWebView`
2. Call `shell.resizePty(cols, rows)` when size changes

## SSH Protocol Reference

The SSH protocol supports PTY resize via `SSH_MSG_CHANNEL_REQUEST` with request type `"window-change"`:

```
byte      SSH_MSG_CHANNEL_REQUEST (98)
uint32    recipient channel
string    "window-change"
boolean   want reply (FALSE)
uint32    terminal width, columns
uint32    terminal height, rows
uint32    terminal width, pixels
uint32    terminal height, pixels
```

The russh library should support this via the channel's request mechanism.

## Testing

After implementing the fix:

1. Connect to a remote server with tmux running
2. Verify tmux fills the screen initially
3. Rotate the device - tmux should resize
4. Show/hide the keyboard - tmux should resize
5. The green tmux status bar should always be at the bottom
