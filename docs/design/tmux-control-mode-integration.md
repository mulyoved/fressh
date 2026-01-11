# Tmux -CC Control Mode Integration

## Overview

Replace current tmux handling with tmux control mode (`-CC`) to enable **native scrollback** - frontend owns the scrollback buffer, eliminating the need for tmux copy-mode.

## Current vs Proposed Architecture

### Current
```
User Input → SSH → tmux attach → Raw bytes → xterm.js (owns scrollback)
```

### Proposed with -CC
```
User Input → SSH → tmux -CC → Protocol Parser → Decoded bytes → React Native (owns scrollback) → xterm.js
```

## Tmux -CC Protocol Summary

### Notifications (Server → Client)
| Message | Format | Description |
|---------|--------|-------------|
| `%output` | `%output %<pane_id> <escaped>` | Pane output (octal-escaped) |
| `%begin` | `%begin <ts> <cmd_id> <flags>` | Command response start |
| `%end` | `%end <ts> <cmd_id> <flags>` | Command response success |
| `%error` | `%error <ts> <cmd_id> <flags>` | Command response failure |
| `%exit` | `%exit [reason]` | Session terminated |
| `%window-add` | `%window-add @<id>` | Window created |
| `%window-close` | `%window-close @<id>` | Window closed |

### Commands (Client → Server)
| Command | Purpose |
|---------|---------|
| `send-keys -t %<pane> <keys>` | Send user input |
| `refresh-client -C WxH` | Resize client window |
| `capture-pane -p -t %<pane> -S start -E end` | Get pane history |

### Escape Encoding
Characters < 32 (control chars) and backslash become octal `\ooo`:
- `\015` = CR (`\r`)
- `\012` = LF (`\n`)
- `\134` = backslash (`\`)

---

## Implementation Phases

### Phase 1: Rust Protocol Parser

**New file:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/tmux_control.rs`

```rust
use bytes::Bytes;

#[derive(Debug, Clone, PartialEq)]
pub enum TmuxControlEvent {
    Output { pane_id: String, data: Vec<u8> },
    WindowAdd { id: String },
    WindowClose { id: String },
    Exit { reason: Option<String> },
    CommandResponse { cmd_id: u64, success: bool, data: Vec<u8> },
}

pub struct TmuxControlParser {
    buffer: Vec<u8>,
    pending_cmd: Option<PendingCommand>,
}

struct PendingCommand {
    cmd_id: u64,
    data: Vec<u8>,
}

impl TmuxControlParser {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            pending_cmd: None,
        }
    }

    /// Parse incoming data, return complete events
    pub fn parse(&mut self, data: &[u8]) -> Vec<TmuxControlEvent> {
        self.buffer.extend_from_slice(data);
        let mut events = Vec::new();

        // Process complete lines
        while let Some(line_end) = self.buffer.iter().position(|&b| b == b'\n') {
            let line = String::from_utf8_lossy(&self.buffer[..line_end]).to_string();
            self.buffer.drain(..=line_end);

            if let Some(event) = self.parse_line(&line) {
                events.push(event);
            }
        }

        events
    }

    fn parse_line(&mut self, line: &str) -> Option<TmuxControlEvent> {
        if line.starts_with("%output ") {
            self.parse_output(line)
        } else if line.starts_with("%begin ") {
            self.parse_begin(line);
            None
        } else if line.starts_with("%end ") {
            self.parse_end(line, true)
        } else if line.starts_with("%error ") {
            self.parse_end(line, false)
        } else if line.starts_with("%exit") {
            self.parse_exit(line)
        } else if line.starts_with("%window-add ") {
            self.parse_window_add(line)
        } else if line.starts_with("%window-close ") {
            self.parse_window_close(line)
        } else if let Some(ref mut cmd) = self.pending_cmd {
            // Accumulate command response data
            cmd.data.extend_from_slice(line.as_bytes());
            cmd.data.push(b'\n');
            None
        } else {
            None
        }
    }

    fn parse_output(&self, line: &str) -> Option<TmuxControlEvent> {
        // Format: %output %<pane_id> <escaped_data>
        let rest = line.strip_prefix("%output ")?;
        let space_idx = rest.find(' ')?;
        let pane_id = rest[..space_idx].to_string();
        let escaped = &rest[space_idx + 1..];
        let data = Self::decode_escaped(escaped);
        Some(TmuxControlEvent::Output { pane_id, data })
    }

    fn parse_begin(&mut self, line: &str) {
        // Format: %begin <timestamp> <cmd_id> <flags>
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            if let Ok(cmd_id) = parts[2].parse::<u64>() {
                self.pending_cmd = Some(PendingCommand {
                    cmd_id,
                    data: Vec::new(),
                });
            }
        }
    }

    fn parse_end(&mut self, line: &str, success: bool) -> Option<TmuxControlEvent> {
        // Format: %end <timestamp> <cmd_id> <flags>
        let cmd = self.pending_cmd.take()?;
        Some(TmuxControlEvent::CommandResponse {
            cmd_id: cmd.cmd_id,
            success,
            data: cmd.data,
        })
    }

    fn parse_exit(&self, line: &str) -> Option<TmuxControlEvent> {
        let reason = line.strip_prefix("%exit")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        Some(TmuxControlEvent::Exit { reason })
    }

    fn parse_window_add(&self, line: &str) -> Option<TmuxControlEvent> {
        let id = line.strip_prefix("%window-add ")?.to_string();
        Some(TmuxControlEvent::WindowAdd { id })
    }

    fn parse_window_close(&self, line: &str) -> Option<TmuxControlEvent> {
        let id = line.strip_prefix("%window-close ")?.to_string();
        Some(TmuxControlEvent::WindowClose { id })
    }

    /// Decode octal escapes: \ooo -> byte
    pub fn decode_escaped(s: &str) -> Vec<u8> {
        let mut result = Vec::with_capacity(s.len());
        let bytes = s.as_bytes();
        let mut i = 0;

        while i < bytes.len() {
            if bytes[i] == b'\\' && i + 3 < bytes.len() {
                // Check for octal escape \ooo
                let oct = &bytes[i + 1..i + 4];
                if oct.iter().all(|&b| b >= b'0' && b <= b'7') {
                    let val = (oct[0] - b'0') as u8 * 64
                        + (oct[1] - b'0') as u8 * 8
                        + (oct[2] - b'0') as u8;
                    result.push(val);
                    i += 4;
                    continue;
                }
            }
            result.push(bytes[i]);
            i += 1;
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_escaped() {
        // \015 = CR (13), \012 = LF (10)
        let decoded = TmuxControlParser::decode_escaped("hello\\015\\012world");
        assert_eq!(decoded, b"hello\r\nworld");
    }

    #[test]
    fn test_parse_output() {
        let mut parser = TmuxControlParser::new();
        let events = parser.parse(b"%output %0 hello\\015\\012\n");
        assert_eq!(events.len(), 1);
        match &events[0] {
            TmuxControlEvent::Output { pane_id, data } => {
                assert_eq!(pane_id, "%0");
                assert_eq!(data, b"hello\r\n");
            }
            _ => panic!("Expected Output event"),
        }
    }
}
```

**Modify:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
```rust
pub mod tmux_control;
```

---

### Phase 2: Shell Session Types

**Modify:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`

Add new types for control mode:

```rust
// Add to existing enums
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum ShellMode {
    Raw,
    TmuxControl,
}

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum TmuxShellEvent {
    PaneOutput { pane_id: String, data: Vec<u8> },
    WindowAdd { id: String },
    WindowClose { id: String },
    Exit { reason: Option<String> },
}

#[uniffi::export(with_foreign)]
pub trait TmuxShellListener: Send + Sync {
    fn on_event(&self, ev: TmuxShellEvent);
}
```

Extend `StartShellOptions` (around line 94):
```rust
pub struct StartShellOptions {
    pub term: TerminalType,
    pub terminal_mode: Option<Vec<TerminalMode>>,
    pub terminal_size: Option<TerminalSize>,
    pub terminal_pixel_size: Option<TerminalPixelSize>,
    pub use_tmux: bool,
    pub tmux_session_name: Option<String>,
    pub use_control_mode: bool,  // NEW
}
```

---

### Phase 3: Modified Shell Startup

**Modify:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`

Change exec command at line 264:
```rust
if use_tmux {
    let tmux_name = tmux_session_name
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    if tmux_name.is_empty() {
        self.disconnect().await.ok();
        return Err(SshError::TmuxAttachFailed(
            "Missing tmux session name".to_string(),
        ));
    }

    // NEW: Use control mode if requested
    let cmd = if opts.use_control_mode {
        format!("tmux -CC attach -t {tmux_name}")
    } else {
        format!("tmux attach -t {tmux_name}")
    };
    ch.exec(true, cmd).await?;
} else {
    ch.request_shell(true).await?;
}
```

Modify reader task (around line 350) to use parser:
```rust
// Create parser if control mode
let mut parser = if use_control_mode {
    Some(TmuxControlParser::new())
} else {
    None
};

// In the reader loop, after receiving data:
if let Some(ref mut p) = parser {
    for event in p.parse(&data) {
        match event {
            TmuxControlEvent::Output { pane_id, data } => {
                // Store in ring buffer for replay support
                append_and_broadcast(
                    &data,
                    StreamKind::Stdout,
                    &ring_clone,
                    &used_bytes_clone,
                    &ring_bytes_capacity_c,
                    &dropped_bytes_total_c,
                    &head_seq_c,
                    &tail_seq_c,
                    &next_seq_c,
                    &tx_clone,
                    DEFAULT_MAX_CHUNK_SIZE,
                );
                // Also invoke callback for real-time handling
                if let Some(ref cb) = tmux_callback {
                    cb.on_event(TmuxShellEvent::PaneOutput {
                        pane_id,
                        data: data.to_vec()
                    });
                }
            }
            TmuxControlEvent::Exit { reason } => {
                if let Some(ref cb) = tmux_callback {
                    cb.on_event(TmuxShellEvent::Exit { reason });
                }
                break; // Exit reader loop
            }
            TmuxControlEvent::WindowAdd { id } => {
                if let Some(ref cb) = tmux_callback {
                    cb.on_event(TmuxShellEvent::WindowAdd { id });
                }
            }
            TmuxControlEvent::WindowClose { id } => {
                if let Some(ref cb) = tmux_callback {
                    cb.on_event(TmuxShellEvent::WindowClose { id });
                }
            }
            _ => {}
        }
    }
} else {
    // Current raw behavior
    append_and_broadcast(&data, StreamKind::Stdout, ...);
}
```

---

### Phase 4: Control Mode Commands

**Modify:** `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`

Add methods to `ShellSession` impl:

```rust
impl ShellSession {
    // ... existing methods ...

    /// Send user input to a tmux pane
    pub async fn send_keys(&self, pane_id: &str, keys: &str) -> Result<(), SshError> {
        let escaped = Self::escape_tmux_keys(keys);
        let cmd = format!("send-keys -t {pane_id} {escaped}\n");
        self.send_data(cmd.into_bytes()).await
    }

    /// Resize tmux client window
    pub async fn refresh_client_size(&self, cols: u32, rows: u32) -> Result<(), SshError> {
        let cmd = format!("refresh-client -C {cols}x{rows}\n");
        self.send_data(cmd.into_bytes()).await
    }

    /// Capture pane history for seeding scrollback
    /// Returns raw output after command response tracking
    pub async fn capture_pane(
        &self,
        pane_id: &str,
        start_line: i32,
        end_line: i32,
    ) -> Result<Vec<u8>, SshError> {
        let cmd = format!("capture-pane -p -t {pane_id} -S {start_line} -E {end_line}\n");
        // Note: Requires command/response tracking via %begin/%end
        // Implementation depends on how we handle command responses
        self.send_data(cmd.into_bytes()).await?;
        // TODO: Wait for %begin/%end and return captured data
        Ok(Vec::new())
    }

    /// Escape special characters for tmux send-keys
    fn escape_tmux_keys(keys: &str) -> String {
        let mut result = String::with_capacity(keys.len() * 2);
        for ch in keys.chars() {
            match ch {
                '\\' => result.push_str("\\\\"),
                ';' => result.push_str("\\;"),
                '"' => result.push_str("\\\""),
                '\'' => result.push_str("\\'"),
                '#' => result.push_str("\\#"),
                '{' => result.push_str("\\{"),
                '}' => result.push_str("\\}"),
                '\n' => result.push_str(" Enter"),
                '\t' => result.push_str(" Tab"),
                '\x1b' => result.push_str(" Escape"),
                _ => result.push(ch),
            }
        }
        result
    }
}
```

---

### Phase 5: TypeScript API

**Modify:** `packages/react-native-uniffi-russh/src/api.ts`

Add new types:
```typescript
export type TmuxShellEvent =
  | { type: 'paneOutput'; paneId: string; data: ArrayBuffer }
  | { type: 'windowAdd'; id: string }
  | { type: 'windowClose'; id: string }
  | { type: 'exit'; reason?: string };

export type StartShellOptions = {
  term?: TerminalType;
  terminalMode?: TerminalMode[];
  terminalSize?: TerminalSize;
  terminalPixelSize?: TerminalPixelSize;
  useTmux?: boolean;
  tmuxSessionName?: string;
  useControlMode?: boolean;  // NEW
  onTmuxEvent?: (event: TmuxShellEvent) => void;  // NEW
  onClosed?: () => void;
};
```

Extend `SshShell` type:
```typescript
export type SshShell = {
  readonly mode: 'Raw' | 'TmuxControl';

  // Existing methods
  sendData: (data: ArrayBuffer, opts?: { signal?: AbortSignal }) => Promise<void>;
  resizePty: (cols: number, rows: number) => Promise<void>;
  readBuffer: (cursor: Cursor) => ReadBufferResult;
  addListener: (callback: (ev: ListenerEvent) => void, opts?: ListenerOptions) => string;
  removeListener: (id: string) => void;
  close: () => Promise<void>;

  // NEW: Control mode methods
  sendKeys: (paneId: string, keys: string) => Promise<void>;
  refreshClientSize: (cols: number, rows: number) => Promise<void>;
  capturePane: (paneId: string, startLine: number, endLine: number) => Promise<Uint8Array>;
};
```

---

### Phase 6: Terminal UI Integration

**Modify:** `apps/mobile/src/app/shell/detail.tsx`

Add control mode state:
```typescript
const [shellMode, setShellMode] = useState<'Raw' | 'TmuxControl'>('Raw');
const [activePaneId, setActivePaneId] = useState<string | null>(null);
```

Handle tmux events:
```typescript
const handleTmuxEvent = useCallback((event: TmuxShellEvent) => {
  switch (event.type) {
    case 'paneOutput':
      // Write decoded output to xterm
      xtermRef.current?.write(new Uint8Array(event.data));
      break;
    case 'exit':
      // Session ended, navigate back
      router.back();
      break;
    case 'windowAdd':
    case 'windowClose':
      // Future: handle multi-pane support
      logger.info('tmux.window', event);
      break;
  }
}, [router]);
```

Modify `sendBytesRaw` (around line 401):
```typescript
const sendBytesRaw = useCallback((bytes: Uint8Array) => {
  if (!shell) return;

  if (shellMode === 'TmuxControl' && activePaneId) {
    // Control mode: wrap input in send-keys command
    const text = new TextDecoder().decode(bytes);
    shell.sendKeys(activePaneId, text).catch((err) => {
      logger.warn('sendKeys failed', err);
    });
  } else {
    // Raw mode: send directly to PTY
    shell.sendData(bytes.buffer).catch((err) => {
      logger.warn('sendData failed', err);
    });
  }
}, [shell, shellMode, activePaneId]);
```

Modify `handleTerminalResize` (around line 684):
```typescript
const handleTerminalResize = useCallback((cols: number, rows: number) => {
  if (resizeTimeoutRef.current) {
    clearTimeout(resizeTimeoutRef.current);
  }

  resizeTimeoutRef.current = setTimeout(() => {
    if (!shell) return;

    if (shellMode === 'TmuxControl') {
      // Control mode: use refresh-client
      shell.refreshClientSize(cols, rows).catch((err) => {
        logger.warn('refreshClientSize failed', err);
      });
    } else {
      // Raw mode: SSH window-change request
      shell.resizePty(cols, rows).catch((err) => {
        logger.warn('resizePty failed', err);
      });
    }
  }, 100);
}, [shell, shellMode]);
```

Seed history on connect:
```typescript
const seedHistoryFromTmux = useCallback(async () => {
  if (!shell || shellMode !== 'TmuxControl' || !activePaneId) return;

  try {
    // Get last 500 lines of history
    const historyData = await shell.capturePane(activePaneId, -500, -1);
    xtermRef.current?.write(historyData);
  } catch (err) {
    logger.warn('capturePane failed', err);
  }
}, [shell, shellMode, activePaneId]);
```

---

## Files Summary

| File | Type | Changes |
|------|------|---------|
| `rust/uniffi-russh/src/tmux_control.rs` | New | Protocol parser |
| `rust/uniffi-russh/src/lib.rs` | Modify | Add module |
| `rust/uniffi-russh/src/ssh_shell.rs` | Modify | Types, commands |
| `rust/uniffi-russh/src/ssh_connection.rs` | Modify | Startup, reader |
| `react-native-uniffi-russh/src/api.ts` | Modify | TypeScript API |
| `apps/mobile/src/app/shell/detail.tsx` | Modify | UI integration |

---

## Build Strategy

1. **Phases 1-4** (all Rust changes) → single EAS build
2. **Phases 5-6** (TypeScript) → hot reload

---

## Testing

- [ ] Connect to tmux session in control mode
- [ ] Verify output decoding (control chars, Unicode, colors)
- [ ] Test user input via send-keys (Enter, Tab, Escape, special chars)
- [ ] Test resize via refresh-client
- [ ] Verify history seeding with capture-pane
- [ ] Test session exit handling (kill tmux externally)
- [ ] No regression in raw mode (non-tmux shells)
- [ ] Performance comparison vs raw mode

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Protocol parsing bugs | High | Unit tests, fuzzing |
| Breaking raw mode | High | Feature flag, parallel code paths |
| Latency increase | Medium | Benchmark, optimize hot paths |
| Complex state machine | Medium | Clear docs, logging |
