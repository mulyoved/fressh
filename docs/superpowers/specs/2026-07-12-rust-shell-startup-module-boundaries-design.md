# Rust Shell-Startup Module Boundaries Design

## Goal

Make Rust shell startup understandable as a short sequence of owned phases
without changing the public `startShell()` API or creating a stack of generic
abstractions.

The design separates PTY negotiation, Workmux probing, shell buffering,
channel-message handling, reader lifetime, and session registration while
preserving current SSH, Workmux, buffering, callback, and cleanup behavior.

## Approved Decisions

- Keep the public Rust, UniFFI, and TypeScript `startShell()` API unchanged.
- Put the shell ring, byte counts, sequence numbers, and broadcaster behind one
  internal `ShellBuffer` type.
- Give readers and sessions a weak reference to a dedicated `ShellRegistry`, not
  the whole `SshConnection`.
- Preserve the current whole-connection disconnect for missing Workmux session
  configuration and probe-detected Workmux attach failure.
- Let the dedicated reader task remove the session and notify closure directly;
  do not add a lifecycle supervisor.
- Share one pure channel-message classifier between Workmux probing and the
  normal reader.
- Use four sibling ownership modules: startup, buffer, reader, and registry.
- Keep PTY and Workmux phase types private inside the startup module.
- Do not add generic traits, builders, services, facades, or a state-machine
  framework.

## Current Problem

`SshConnection::start_shell()` is roughly 394 lines inside the 1,166-line
`ssh_connection.rs`. One function currently owns all of these responsibilities:

- channel opening and startup cleanup;
- terminal mode and dimension normalization;
- PTY request sending and reply negotiation;
- login-shell or Workmux exec selection;
- Workmux command quoting and the 300 ms attach probe;
- bounded Workmux failure output;
- shell ring and broadcast field construction;
- probe-output insertion into the shell buffer;
- channel-message interpretation;
- reader task construction;
- one-time close callbacks;
- session construction;
- registration in the connection's raw shell map; and
- the race where the reader closes before registration finishes.

`ssh_shell.rs` is also 718 lines and exposes the buffer as parallel
synchronization fields on `ShellSession`. `append_and_broadcast()` needs ten
arguments and a `too_many_arguments` allowance because the buffer has no owner
type.

The behavior is mostly tested through small classifiers. The complete startup
sequence and its registration race are difficult to exercise without reading the
large function.

## Scope

In scope:

- interactive shell channel startup;
- PTY defaults and caller overrides;
- request send and success acknowledgement;
- login-shell and Workmux target selection;
- Workmux command quoting, output capture, and attach probing;
- shell buffer creation, append, replay, stats, and live subscription;
- normal channel-message handling;
- reader-task ownership and close notification;
- shell registration, removal, and disconnect snapshots;
- source dependency and size guardrails; and
- focused pure, Tokio race, and in-process SSH tests.

Out of scope:

- public Rust, UniFFI, generated binding, or TypeScript API changes;
- command-channel decomposition in `ssh_command.rs`;
- connection authentication, keepalive, or server-key changes;
- mobile shell or terminal behavior changes;
- Workmux command, timeout, or failure-copy changes;
- shell buffer capacity, chunk size, replay limit, or coalescing changes;
- stored connection, key, or application-data changes; and
- a generic SSH transport or channel-mocking framework.

## Chosen Architecture

The public connection object remains the entry point, then delegates to four
sibling owners:

```text
SshConnection::start_shell
            |
            v
   ssh_shell_startup
      /      |      \
     v       v       v
 buffer    reader   registry
     \       |       /
      \      v      /
          ShellSession
```

These are ownership boundaries, not wrapper layers. The startup coordinator uses
the other units directly. There is no facade over the coordinator and no adapter
between sibling modules.

Dependency direction:

- `ssh_connection` may call `ssh_shell_startup` and own an `Arc<ShellRegistry>`.
- `ssh_shell_startup` may use `ssh_channel`, `ssh_shell`, `ssh_shell_buffer`,
  `ssh_shell_reader`, and `ssh_shell_registry`.
- `ssh_shell_reader` may use the buffer, registry, and public callback types
  from `ssh_shell`.
- `ssh_shell` may use the buffer, reader handle, and weak registry.
- buffer and registry modules do not import `SshConnection`.
- only startup needs the complete `SshConnection` to open or disconnect the SSH
  transport.

## Module Boundaries

### `ssh_connection.rs`

Keeps:

- public connection records and callbacks;
- authentication and server-key handling;
- the russh client handle;
- keepalive and disconnect behavior;
- command entry points; and
- the exported `start_shell()` method.

Changes:

- replace the raw `AsyncMutex<HashMap<u32, Arc<ShellSession>>>` with
  `Arc<ShellRegistry>`;
- make `start_shell()` delegate immediately to
  `ssh_shell_startup::start_shell(self, opts)`; and
- use `ShellRegistry::sessions()` when disconnecting active shells.

It does not retain PTY, Workmux, buffer, reader, or registration policy.

### `ssh_shell_startup.rs`

Owns the ordered startup transaction while the shell is not yet registered:

1. open a session channel;
2. place it under `StartupChannelCloseGuard`;
3. normalize and negotiate the PTY;
4. select and start the login-shell or Workmux target;
5. create the shell buffer;
6. split the channel;
7. run the Workmux probe when required;
8. create the notifier and reader;
9. construct the session;
10. register it; and
11. return it.

Private startup types:

```rust
struct PtyRequest {
    term_name: &'static str,
    modes: Vec<(russh::Pty, u32)>,
    cols: u32,
    rows: u32,
    pixel_width: u32,
    pixel_height: u32,
}

enum ShellTarget {
    LoginShell,
    Workmux { session_name: String },
}

struct WorkmuxAttachProbe {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    channel_ended: bool,
}
```

`PtyRequest::from_options()` owns defaults and terminal-mode overrides.
`ShellTarget::from_options()` trims and validates the Workmux session name. The
Workmux probe owns its bounded diagnostic output and deadline decision.

The module keeps the existing 5-second channel-open, request-send, and
request-success timeouts and the 300 ms Workmux probe timeout.

### `ssh_shell_buffer.rs`

Owns all replay and broadcast state:

```rust
pub(crate) struct ShellBuffer {
    ring: Mutex<VecDeque<Arc<ShellChunk>>>,
    used_bytes: Mutex<usize>,
    ring_bytes_capacity: AtomicUsize,
    dropped_bytes_total: AtomicU64,
    next_seq: AtomicU64,
    head_seq: AtomicU64,
    tail_seq: AtomicU64,
    sender: broadcast::Sender<Arc<ShellChunk>>,
}
```

The current internal `Chunk` moves into this module as `ShellChunk`. It keeps
the sequence, timestamp, stream, and `Bytes` payload together and exposes
crate-private accessors used by listener coalescing. No other module constructs
or mutates a buffered chunk.

Focused methods:

```rust
impl ShellBuffer {
    pub(crate) fn new() -> Arc<Self>;
    pub(crate) fn append(&self, stream: StreamKind, data: &[u8]);
    pub(crate) fn read(&self, cursor: Cursor, max_bytes: Option<u64>)
        -> BufferReadResult;
    pub(crate) fn stats(&self) -> BufferStats;
    pub(crate) fn current_seq(&self) -> u64;
    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Arc<ShellChunk>>;
}
```

It preserves these exact defaults:

- 2 MiB ring byte capacity;
- 16 KiB maximum stored chunk;
- 1,024 broadcast chunk capacity;
- 512 KiB default read limit;
- sequence numbers starting at 1; and
- oldest-first byte eviction with dropped-range reporting.

The buffer does not know about SSH channels, readers, callbacks, connections,
session registration, or listener task coalescing. `ShellSession` keeps the
listener tasks and uses `read()` plus `subscribe()`.

### `ssh_shell_reader.rs`

Owns the shared channel-message vocabulary and the live reader task.

```rust
pub(crate) enum ShellChannelMessage<'a> {
    Stdout(&'a [u8]),
    Stderr(&'a [u8]),
    ExitStatus(u32),
    ExitSignal(String),
    Eof,
    Close,
    Other,
}

pub(crate) fn classify_shell_channel_message(message: &ChannelMsg)
    -> ShellChannelMessage<'_>;
```

Both the Workmux probe and live reader use this classifier. The classifier does
not mutate the buffer, registry, or callback state.

The reader module also owns:

```rust
pub(crate) struct ShellReaderHandle {
    task: JoinHandle<()>,
    ended: Arc<AtomicBool>,
}

pub(crate) struct ShellCloseNotifier {
    callback: Option<Arc<dyn ShellClosedCallback>>,
    channel_id: u32,
    notified: AtomicBool,
}
```

`spawn_shell_reader()` receives the read half, connection/channel identity,
`Arc<ShellBuffer>`, `Weak<ShellRegistry>`, and `Arc<ShellCloseNotifier>`. It
returns `ShellReaderHandle`.

The live reader behavior remains:

- stdout and stderr append to the buffer;
- exit status and exit signal update the last terminal reason used for tracing;
- EOF is traced but does not end the reader;
- Close or `reader.wait() == None` marks the reader ended, notifies once,
  removes the session from the registry, and exits; and
- every other message is ignored after typed classification.

There is no separate supervisor. `ShellReaderHandle::abort()` stops the task;
`has_ended()` exposes the registration-race flag.

### `ssh_shell_registry.rs`

Owns the only raw shell map:

```rust
pub(crate) struct ShellRegistry {
    sessions: AsyncMutex<HashMap<u32, Arc<ShellSession>>>,
}

impl ShellRegistry {
    pub(crate) fn new() -> Arc<Self>;
    pub(crate) async fn register(
        &self,
        session: Arc<ShellSession>,
        reader_ended: &AtomicBool,
    ) -> bool;
    pub(crate) async fn remove(&self, channel_id: u32);
    pub(crate) async fn sessions(&self) -> Vec<Arc<ShellSession>>;
}
```

`register()` inserts while holding the map lock, then checks `reader_ended`. If
the reader already ended, it removes the new entry before releasing the lock and
returns `false`. If the reader ends after that check, its removal waits for the
same lock and then removes the entry. These two paths cover the full race
without generation counters or a second registry state machine.

The registry does not notify callbacks, abort readers, or close channels.

### `ssh_shell.rs`

Keeps the public UniFFI surface:

- terminal, size, mode, cursor, event, and listener types;
- `StartShellOptions`;
- `ShellSessionInfo`;
- `ShellSession` as the exported object;
- send, resize, close, read, stats, current-sequence, and listener methods; and
- listener task coalescing and cancellation.

`ShellSession` becomes a composition of owned units instead of parallel buffer
fields:

```rust
pub struct ShellSession {
    pub info: ShellSessionInfo,
    buffer: Arc<ShellBuffer>,
    writer: AsyncMutex<ChannelWriteHalf<client::Msg>>,
    reader: ShellReaderHandle,
    close_notifier: Arc<ShellCloseNotifier>,
    registry: Weak<ShellRegistry>,
    listener_tasks: Mutex<HashMap<u64, JoinHandle<()>>>,
    next_listener_id: AtomicU64,
    coalesce_ms: AtomicU64,
    runtime: Handle,
}
```

Explicit close retains the current order:

1. abort the reader;
2. abort listener tasks;
3. notify closure once;
4. remove from the registry; and
5. close the writer under the existing close timeout.

Drop aborts reader and listener tasks. It does not start a second asynchronous
registry-removal path; registered sessions are removed by reader end, explicit
close, or connection disconnect.

### `ssh_channel.rs`

`StartupChannelCloseGuard` remains the shared RAII owner for unsplit startup
channels used by both shell and command startup. It is not wrapped in another
shell-specific guard.

## Startup Data Flow

### Channel and PTY

The startup coordinator opens a session channel under the existing 5-second
timeout. A channel-open timeout keeps the current behavior of attempting to
disconnect the connection.

`PtyRequest::from_options()`:

- starts from `DEFAULT_TERMINAL_MODES`;
- replaces an existing mode by opcode;
- appends a recognized new mode;
- ignores unknown opcodes;
- uses the current 80 columns, 24 rows, and zero pixel defaults; and
- maps `TerminalType` to its current SSH terminal name.

The coordinator sends `request_pty(true, ...)`, waits for the send future, then
consumes messages until Success, Failure, Close/EOF, reader end, or timeout.
Non-reply data remains ignored during request acknowledgement, matching current
behavior.

### Login Shell

For `use_tmux == false`, startup sends `request_shell(true)` and waits for the
same success protocol. No Workmux probe runs.

### Workmux

For `use_tmux == true`, startup:

1. trims and validates `tmux_session_name`;
2. builds the current shell-quoted command
   `env PATH="$PATH:$HOME/bin" mdev tmux attach '<session>'`;
3. sends `exec(true, command)` and waits for Success;
4. splits the channel;
5. reads messages until the 300 ms absolute deadline;
6. appends probe stdout/stderr to `ShellBuffer` so no terminal output is lost;
7. records at most 1,024 bytes each of stdout and stderr for failure detail; and
8. returns the read half to the normal reader on a clean timeout.

A nonzero exit status or exit signal is a probe failure. A zero exit status
alone continues probing, matching current behavior. EOF or Close marks the
channel ended but continues probing until an exit status, exit signal, reader
end, or deadline. If the deadline arrives after EOF/Close, the result is
`TmuxAttachFailed("Workmux attach closed the channel...")`.

The output used in failure text remains trimmed, newline-flattened, and prefers
stderr over stdout.

## Failure and Cleanup Semantics

The public result remains `Result<Arc<ShellSession>, SshError>`.

- Channel-open timeout: attempt connection disconnect, then return the existing
  SSH timeout error.
- PTY or login-shell request send/reply failure: return the existing SSH error;
  the startup guard closes the channel.
- Empty Workmux session: attempt connection disconnect and return
  `TmuxAttachFailed("Missing Workmux session name")`.
- Workmux exec send/reply failure: return the existing SSH request error; the
  startup guard closes the channel.
- Probe-detected Workmux failure or reader end: attempt connection disconnect
  and return the bounded `TmuxAttachFailed` detail.
- Probe timeout with an open channel: continue as a live shell.
- Buffer broadcast without subscribers: ignore the send error, as today.
- Close callback panic: contain it through the existing foreign-callback unwind
  boundary and preserve one-time notification.
- Registry removal of an absent channel: succeed as an idempotent no-op.
- Explicit close timeout: remain best-effort and return success, matching the
  current method.

No new public error variants or translated error hierarchy are introduced.

## Public API Compatibility

The following remain unchanged:

- `SshConnection.startShell(options)`;
- `StartShellOptions`, including `useTmux` and `tmuxSessionName`;
- `SshShell` methods and event shapes;
- `ShellSessionInfo` fields;
- UniFFI records, enums, callbacks, and object names;
- generated TypeScript method and property names; and
- the hand-written `packages/react-native-uniffi-russh/src/api.ts` wrapper.

Generated files are rebuilt only if the normal generation check requires it;
they are never edited by hand. The expected implementation changes are internal
and should produce no generated binding diff.

## Testing Strategy

### Pure unit tests

`ssh_shell_startup` tests:

- terminal name and default dimensions;
- terminal mode override, append, and unknown-opcode handling;
- Workmux session trimming and empty rejection;
- shell quoting, including apostrophes;
- request reply classification; and
- Workmux probe state across output, zero and nonzero status, signal, EOF/Close,
  clean timeout, ended-channel timeout, and bounded failure detail.

`ssh_shell_reader` tests:

- every supported `ChannelMsg` classification;
- EOF differs from Close;
- last exit status/signal is retained for close tracing; and
- notifier catches callback panic and fires once.

`ssh_shell_buffer` tests:

- chunk splitting and monotonic sequence numbers;
- byte eviction, head/tail sequence updates, and dropped-byte totals;
- Head, Seq, TimeMs, TailBytes, and Live reads;
- maximum read bytes;
- dropped-range reporting; and
- live broadcast delivery and no-subscriber behavior.

### Tokio race tests

Test the real `ShellRegistry` locking behavior for:

- reader ended before registration;
- reader ends while registration holds the map lock;
- removal after successful registration;
- duplicate removal; and
- snapshot isolation during disconnect.

Test reader and explicit close competing to notify. The callback must fire once
and the registry must end empty.

### In-process SSH tests

Add a test-only russh server fixture under `src/test_support/ssh_server.rs`.
Exercise the real public `SshConnection::start_shell()` boundary without adding
a production channel trait.

Cover:

- PTY acceptance followed by login-shell success;
- PTY request rejection;
- Workmux exec command and quoted session name;
- probe stdout/stderr preserved in the returned shell buffer;
- nonzero Workmux exit with bounded detail;
- Workmux EOF/Close followed by the deadline failure;
- immediate plain-shell close before registration;
- normal reader close, registry removal, and one callback; and
- explicit session close and connection disconnect cleanup.

### Architecture tests

Require:

- `SshConnection::start_shell()` is a short delegate;
- raw session maps appear only in `ssh_shell_registry.rs`;
- raw ring, used-byte, and sequence fields appear only in `ssh_shell_buffer.rs`;
- `ssh_shell_reader.rs` does not import `SshConnection`;
- no new shell-startup trait, facade, service, builder, supervisor, or state
  machine exists;
- the old ten-argument `append_and_broadcast()` function and its Clippy
  allowance are absent; and
- current UniFFI public names remain present.

## Maintainability Guardrails

- `SshConnection::start_shell()` is a short delegate.
- `ssh_connection.rs` stays below 700 nonblank lines.
- `ssh_shell.rs` stays below 450 nonblank lines.
- `ssh_shell_startup.rs` and `ssh_shell_buffer.rs` each stay below 300 nonblank
  lines.
- `ssh_shell_reader.rs` stays below 250 nonblank lines.
- `ssh_shell_registry.rs` stays below 150 nonblank lines.
- No startup function exceeds 120 nonblank lines.
- Raw shell maps exist only in the registry.
- Raw ring and sequence fields exist only in the buffer.
- Public UniFFI data types stay out of buffer and registry policy.
- No generic lifecycle or channel abstraction is introduced.

If a limit cannot be met without splitting a real independent owner, the
implementation must stop for design review rather than add forwarding files.

## Success Criteria

- A reader can understand shell startup by following one short coordinator.
- PTY and Workmux policies are named private types with focused unit tests.
- Probe and live-reader channel messages share one classifier.
- Probe output is preserved in the same buffer used after startup.
- `ShellSession` owns one buffer and one reader handle instead of parallel
  synchronization fields.
- Readers and sessions depend on a weak registry, not a weak connection.
- The registration race is contained in one registry method.
- Reader end and explicit close notify at most once and leave no registered
  session.
- Existing external API and user-visible behavior remain unchanged.
- Failed startup channels and failed Workmux connections retain current cleanup
  behavior.
- Focused tests cover pure policy, concurrency races, and real SSH protocol flow
  without a production mock framework.
- File and function guardrails prevent the decomposition from becoming another
  abstraction stack.
