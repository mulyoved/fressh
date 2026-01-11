# Tmux Scrollback Native Scrolling - Implementation Design

**Status:** Design Complete
**Related:** [mobile-scrolling-terminal.md](./mobile-scrolling-terminal.md) (research/problem statement)

## Overview

Enable native finger-drag scrolling through tmux scrollback in the Fressh mobile SSH client. Users can swipe up to view ~3 pages of terminal history without entering tmux copy-mode.

## Architecture Decision

**Chosen Approach:** Capture-Pane with SSH Exec Channel

Alternatives considered:
- ❌ **Disable alt-screen** (`smcup@:rmcup@`) - Breaks with multi-pane, reattach issues
- ❌ **Tmux control mode (-CC)** - Too complex, requires protocol parser
- ❌ **Mouse wheel injection** - Latency issues, requires copy-mode
- ✅ **Capture-pane via exec channel** - Clean separation, works with existing architecture

## Data Flow

```
User scrolls to top
        ↓
xterm.js detects viewportY === 0
        ↓
Bridge message: { type: 'scrolledToTop' }
        ↓
React Native: detail.tsx
        ↓
Open SSH exec channel (separate from PTY)
        ↓
Run: tmux capture-pane -t <session> -p -S -100 -E -1
        ↓
Parse output, split into lines
        ↓
Bridge message: { type: 'prependHistory', lines: [...] }
        ↓
xterm.js: clear → write history → write separator → write current
        ↓
User sees scrollback above current terminal content
```

---

## Reading List - Files to Modify

### 1. Rust SSH Backend (REQUIRES EAS BUILD)

**File:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`

Add new method to `SshConnection` impl:

```rust
#[uniffi::export(async_runtime = "tokio")]
impl SshConnection {
    // ... existing methods ...

    /// Execute a command via SSH exec channel (non-interactive).
    /// Opens temporary channel, runs command, collects output, closes.
    pub async fn exec_command(&self, command: String) -> Result<ExecResult, SshError> {
        let ch = {
            let client_handle = self.client_handle.lock().await;
            client_handle.channel_open_session().await?
        };

        ch.exec(true, command).await?;

        let (mut reader, _writer) = ch.split();
        let mut output = Vec::new();
        let mut exit_status = None;

        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { data }) => output.extend_from_slice(&data),
                Some(ChannelMsg::ExtendedData { data, .. }) => output.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status: s }) => exit_status = Some(s),
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }

        Ok(ExecResult {
            stdout: output,
            exit_status: exit_status.unwrap_or(0),
        })
    }
}
```

Add new type at module level:

```rust
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ExecResult {
    pub stdout: Vec<u8>,
    pub exit_status: u32,
}
```

---

### 2. TypeScript API Wrapper

**File:** `packages/react-native-uniffi-russh/src/api.ts`

Add type:

```typescript
export type ExecResult = {
  stdout: Uint8Array;
  exitStatus: number;
};
```

Add to `SshConnection` interface (line ~112):

```typescript
export type SshConnection = {
  // ... existing fields ...
  execCommand: (command: string, opts?: { signal?: AbortSignal }) => Promise<ExecResult>;
};
```

Update `wrapConnection()` function (line ~336):

```typescript
function wrapConnection(conn: GeneratedRussh.SshConnectionInterface): SshConnection {
  const info = conn.getInfo();
  return {
    // ... existing fields ...
    execCommand: async (command, opts) => {
      const result = await conn.execCommand(
        command,
        opts?.signal ? { signal: opts.signal } : undefined,
      );
      return {
        stdout: new Uint8Array(result.stdout),
        exitStatus: result.exitStatus,
      };
    },
  };
}
```

---

### 3. Bridge Protocol Extension

**File:** `packages/react-native-xtermjs-webview/src/bridge.ts`

Add to `BridgeOutboundMessage` (line ~15):

```typescript
export type BridgeOutboundMessage =
  | { type: 'write'; bStr: string }
  | { type: 'writeMany'; chunks: string[] }
  | { type: 'prependHistory'; lines: string[] }      // NEW
  | { type: 'getScrollPosition' }                     // NEW
  // ... existing types ...
```

Add to `BridgeInboundMessage` (line ~5):

```typescript
export type BridgeInboundMessage =
  | { type: 'initialized' }
  | { type: 'input'; str: string }
  | { type: 'scrolledToTop' }                                           // NEW
  | { type: 'historyPrepended'; linesAdded: number }                    // NEW
  | { type: 'scrollPosition'; atTop: boolean; lineNumber: number }      // NEW
  // ... existing types ...
```

---

### 4. WebView Terminal Handler

**File:** `packages/react-native-xtermjs-webview/src-internal/main.tsx`

Add scroll detection after terminal initialization (after `term.open()`):

```typescript
// Scroll-to-top detection
let scrollDebounce: number | null = null;
term.onScroll((newPosition: number) => {
  if (scrollDebounce) clearTimeout(scrollDebounce);
  scrollDebounce = window.setTimeout(() => {
    const buffer = term.buffer.active;
    const atTop = newPosition === 0 && buffer.baseY === 0;
    if (atTop) {
      sendToRn({ type: 'scrolledToTop' });
    }
  }, 100);
});
```

Add message handler for `prependHistory` in the switch statement:

```typescript
case 'prependHistory': {
  const { lines } = msg as { type: 'prependHistory'; lines: string[] };
  if (!lines || lines.length === 0) break;

  // Save current terminal content
  const buffer = term.buffer.active;
  const currentLines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) currentLines.push(line.translateToString(true));
  }

  // Clear and rebuild with history prepended
  term.clear();
  term.reset();

  // Write history
  for (const line of lines) {
    term.write(line + '\r\n');
  }

  // Visual separator
  term.write('\x1b[90m--- Earlier Output ---\x1b[0m\r\n');

  // Restore current content
  for (const line of currentLines) {
    term.write(line + '\r\n');
  }

  // Scroll to the separator position (so user sees they loaded history)
  const separatorPosition = lines.length;
  term.scrollToLine(separatorPosition);

  sendToRn({ type: 'historyPrepended', linesAdded: lines.length });
  break;
}
```

---

### 5. React Native Component Props

**File:** `packages/react-native-xtermjs-webview/src/index.tsx`

Add new props to component (around line ~40):

```typescript
export type XtermJsWebViewProps = {
  // ... existing props ...
  onScrolledToTop?: () => void;
  onHistoryPrepended?: (linesAdded: number) => void;
};
```

Add to `XtermWebViewHandle` interface (around line ~60):

```typescript
export type XtermWebViewHandle = {
  // ... existing methods ...
  prependHistory: (lines: string[]) => void;
};
```

Add handle method in `useImperativeHandle` (around line ~130):

```typescript
prependHistory: (lines: string[]) => {
  sendToWebView({ type: 'prependHistory', lines });
},
```

Add message handler in `onMessage` (around line ~180):

```typescript
if (msg.type === 'scrolledToTop') {
  onScrolledToTop?.();
  return;
}
if (msg.type === 'historyPrepended') {
  onHistoryPrepended?.(msg.linesAdded);
  return;
}
```

---

### 6. Tmux History Service (NEW FILE)

**File:** `apps/mobile/src/lib/tmux-history.ts`

```typescript
import type { SshConnection } from '@fressh/react-native-uniffi-russh';

export type TmuxCaptureOptions = {
  /** Number of lines to capture (default: 100) */
  lines?: number;
  /** Tmux pane target (default: current) */
  pane?: string;
};

export type TmuxHistoryResult = {
  lines: string[];
  hasMore: boolean;
};

/**
 * Capture scrollback history from a tmux session.
 * Uses `tmux capture-pane` via SSH exec channel.
 */
export async function captureTmuxScrollback(
  connection: SshConnection,
  sessionName: string,
  opts: TmuxCaptureOptions = {},
): Promise<TmuxHistoryResult> {
  const lineCount = opts.lines ?? 100;
  const paneTarget = opts.pane ?? sessionName;

  // -p: print to stdout
  // -S -N: start N lines before current
  // -E -1: exclude last line (visible area)
  // 2>/dev/null: suppress errors
  // Fallback marker if tmux command fails
  const command = `tmux capture-pane -t ${paneTarget} -p -S -${lineCount} -E -1 2>/dev/null || echo "__TMUX_CAPTURE_FAILED__"`;

  const result = await connection.execCommand(command);
  const output = new TextDecoder().decode(result.stdout);

  if (output.includes('__TMUX_CAPTURE_FAILED__')) {
    return { lines: [], hasMore: false };
  }

  // Split and clean up trailing empty line from split
  const lines = output.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return {
    lines,
    hasMore: lines.length >= lineCount,
  };
}
```

---

### 7. Mobile App Integration

**File:** `apps/mobile/src/app/shell/detail.tsx`

Add imports at top:

```typescript
import { captureTmuxScrollback } from '@/lib/tmux-history';
```

Add state (around line ~250, with other state):

```typescript
const [historyLoading, setHistoryLoading] = useState(false);
const [historyExhausted, setHistoryExhausted] = useState(false);
const historyLoadedLinesRef = useRef(0);
```

Add history loading callback (around line ~600, with other callbacks):

```typescript
const loadTmuxHistory = useCallback(async () => {
  if (!shell || !connection || historyLoading || historyExhausted) return;

  // Only works for tmux sessions - check if session name exists
  // Note: We attached with useTmux=true and tmuxSessionName from connection config
  const sessionName = /* get from connection config or shell info */;
  if (!sessionName) return;

  setHistoryLoading(true);
  try {
    const result = await captureTmuxScrollback(connection, sessionName, {
      lines: 100, // ~3-4 pages at 30 rows
    });

    if (result.lines.length === 0) {
      setHistoryExhausted(true);
      return;
    }

    // Send to terminal via bridge
    xtermRef.current?.prependHistory(result.lines);
    historyLoadedLinesRef.current += result.lines.length;

    if (!result.hasMore) {
      setHistoryExhausted(true);
    }
  } catch (e) {
    logger.warn('Failed to load tmux history', e);
  } finally {
    setHistoryLoading(false);
  }
}, [shell, connection, historyLoading, historyExhausted]);

const handleScrolledToTop = useCallback(() => {
  if (!historyExhausted && !historyLoading) {
    void loadTmuxHistory();
  }
}, [loadTmuxHistory, historyExhausted, historyLoading]);
```

Add props to XtermJsWebView (around line ~850):

```typescript
<XtermJsWebView
  // ... existing props ...
  onScrolledToTop={handleScrolledToTop}
  onHistoryPrepended={(count) => {
    logger.info(`Prepended ${count} lines of history`);
  }}
/>
```

---

## Edge Cases & Error Handling

| Case | Handling |
|------|----------|
| **Tmux not available** | `exec_command` fails gracefully, return empty lines |
| **Session name mismatch** | Capture-pane fails, log warning, set exhausted |
| **Multi-pane windows** | Captures active pane only (MVP behavior) |
| **Large history** | Limit to 100 lines, set `hasMore` for pagination |
| **Connection loss during fetch** | Catch error, log warning, fail silently |
| **Concurrent fetch requests** | Guard with `historyLoading` flag |
| **Non-tmux sessions** | Skip history loading (no session name) |

---

## Build & Deployment Notes

### Rust Changes Require EAS Build

After modifying `ssh_connection.rs`:

```bash
cd apps/mobile
eas build --platform android --profile development
```

See `docs/dev-builds.md` for full UniFFI rebuild procedure.

### TypeScript-Only Changes

Changes to bridge, React Native components, and the mobile app don't require EAS build - hot reload works.

---

## Testing Checklist

- [ ] Scroll to top in tmux session → history loads
- [ ] Scroll multiple times → doesn't duplicate or re-fetch when exhausted
- [ ] Non-tmux session → no errors, graceful skip
- [ ] Connection drop during fetch → graceful failure
- [ ] Large history (1000+ lines) → only fetches ~100, indicates more available
- [ ] Multi-pane tmux → captures active pane only
- [ ] Session name with spaces → properly escaped

---

## Future Enhancements

1. **Pagination**: "Load more" when user scrolls to top of history
2. **Multi-pane support**: UI to select which pane's history to view
3. **History caching**: Store fetched history across reconnects
4. **Search in history**: Find text in captured scrollback
5. **Visual indicator**: Loading spinner while fetching history
