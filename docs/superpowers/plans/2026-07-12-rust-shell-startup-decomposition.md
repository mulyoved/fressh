# Rust Shell-Startup Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose Rust interactive-shell startup into four focused internal
owners while preserving the complete UniFFI and TypeScript shell API and current
SSH behavior.

**Architecture:** `SshConnection::start_shell()` becomes a short delegate to one
startup coordinator. `ShellBuffer`, `ShellRegistry`, and the shell reader own
their state directly; PTY and Workmux phase types stay private inside startup.
The plan introduces no production channel trait, facade, builder, service, or
lifecycle supervisor.

**Tech Stack:** Rust 2021, russh 0.54.3, Tokio 1.47.1, UniFFI,
`uniffi-bindgen-react-native`, Cargo, pnpm/Turbo, Jest, TypeScript 5.9.

## Prerequisite

Read
`docs/superpowers/specs/2026-07-12-rust-shell-startup-module-boundaries-design.md`
before implementation. This plan implements that approved boundary without
changing public shell behavior.

## Global Constraints

- Start every production change with a focused failing test and observe the
  expected failure before editing production code.
- Keep `SshConnection.startShell(options)`, `StartShellOptions`, `SshShell`,
  `ShellSessionInfo`, all UniFFI names, and all TypeScript property names
  unchanged.
- Keep public UniFFI types defined in `ssh_shell.rs`. Internal owners may
  consume those types but must not redeclare or wrap them.
- Keep the current 5-second channel-open, request-send, and request-success
  timeouts and the 300 ms Workmux attach probe.
- Keep the current Workmux command:
  `env PATH="$PATH:$HOME/bin" mdev tmux attach '<session>'`.
- Keep 1,024 bytes each of bounded Workmux stdout and stderr failure detail,
  with stderr preferred and embedded newlines flattened.
- Keep the current whole-connection disconnect for an empty Workmux session,
  probe failure, or reader end during the probe. Ordinary request protocol
  failure closes only the startup channel through the existing guard.
- Keep the 2 MiB shell ring, 16 KiB maximum chunk, 1,024 broadcast capacity, 512
  KiB default read limit, and sequence numbers starting at 1.
- Keep EOF non-final in the live reader. Close or `reader.wait() == None` is
  final and must notify once and unregister.
- Keep listener replay, coalescing, dropped-range, callback containment, resize,
  send, explicit close, and disconnect behavior unchanged.
- Keep `StartupChannelCloseGuard` shared with command startup. Move the generic
  `channel_msg_summary()` helper into `ssh_channel.rs`; do not couple command
  code to a shell module.
- Do not decompose `ssh_command.rs`, authentication, server-key handling,
  keepalive, mobile code, storage, or generated bindings.
- Do not add a production mock channel, generic trait, builder, facade, service,
  state machine, or lifecycle supervisor.
- Keep `ssh_connection.rs` below 700 nonblank lines and `ssh_shell.rs`
  below 450.
- Keep startup and buffer below 300 nonblank lines each, reader below 250, and
  registry below 150. Test-only submodules do not count toward these production
  limits.
- Keep every startup function below 120 nonblank lines.
- Never hand-edit `src/generated`, `cpp/generated`, or Rust/UniFFI generated
  artifacts.
- Before every GREEN check, run `cargo fmt` on the crate.
- The current baseline is 40 passing Rust library tests. Cargo also prints an
  existing future-incompatibility note for `num-bigint-dig v0.8.4`; do not treat
  that dependency note as a new crate warning or change dependencies in this
  plan.
- Run `$thermo-nuclear-code-quality-review` after automated verification and
  resolve every blocker before merge.

---

## Final File Shape

### New production modules

- `rust/uniffi-russh/src/ssh_shell_buffer.rs` owns `ShellBuffer`, `ShellChunk`,
  ring limits, append, eviction, reads, stats, and broadcast subscription.
- `rust/uniffi-russh/src/ssh_shell_registry.rs` owns the only shell-session map,
  registration, fast-close reconciliation, removal, and snapshots.
- `rust/uniffi-russh/src/ssh_shell_reader.rs` owns the shared message
  classifier, close notifier, reader handle, and reader task.
- `rust/uniffi-russh/src/ssh_shell_startup.rs` owns channel open, PTY, target
  selection, Workmux command/probe, session construction, and registration.

### Existing production modules

- `rust/uniffi-russh/src/ssh_connection.rs` keeps connection/authentication/
  disconnect and delegates shell startup.
- `rust/uniffi-russh/src/ssh_shell.rs` keeps public UniFFI types,
  `ShellSession`, I/O, close, read/stats delegates, and listener tasks.
- `rust/uniffi-russh/src/ssh_channel.rs` keeps the startup guard and the generic
  channel-message trace summary.
- `rust/uniffi-russh/src/ssh_command.rs` changes only its summary-helper import.
- `rust/uniffi-russh/src/lib.rs` declares the four private modules and test
  support.

### Rust tests

- `rust/uniffi-russh/src/ssh_shell_buffer/tests.rs`
- `rust/uniffi-russh/src/ssh_shell_registry/tests.rs`
- `rust/uniffi-russh/src/ssh_shell_reader/tests.rs`
- `rust/uniffi-russh/src/ssh_shell_startup/tests.rs`
- `rust/uniffi-russh/src/test_support/mod.rs`
- `rust/uniffi-russh/src/test_support/ssh_server.rs`
- `rust/uniffi-russh/tests/shell_architecture.rs`

### TypeScript compatibility test

- `packages/react-native-uniffi-russh/src/__tests__/api-shell-wrapper.test.ts`

## Migration and Rollback Boundary

- Tasks 1-4 replace one internal owner at a time while the current
  `SshConnection::start_shell()` sequence remains callable.
- Task 5 is the coordinator cutover. Reverting only that commit restores the
  previous entry-point ownership while retaining the tested buffer, registry,
  notifier, and reader units.
- Task 6 removes only obsolete source and locks the final architecture and
  public wrapper contract.
- No task changes stored data, public bindings, or generated code. Rollback is
  ordinary commit reversion with no migration or application-data action.

---

### Task 1: ShellBuffer Ownership

**Files:**

- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_buffer.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_buffer/tests.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/tests/shell_architecture.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`

**Interfaces:**

- Produces `ShellBuffer::new`, `append`, `read`, `stats`, `current_seq`, and
  `subscribe`.
- Produces immutable `ShellChunk` accessors for listener coalescing.
- Replaces ten parallel append arguments and all raw buffer fields on
  `ShellSession` with `Arc<ShellBuffer>`.

- [ ] **Step 1: Write failing buffer and ownership tests**

Declare `mod ssh_shell_buffer;` in `lib.rs`, add `#[cfg(test)] mod tests;` to
the new module, and write focused tests for:

```rust
#[test]
fn append_splits_chunks_and_sequences_from_one() {
    let buffer = ShellBuffer::new();
    buffer.append(StreamKind::Stdout, &vec![b'x'; DEFAULT_MAX_CHUNK_SIZE + 3]);

    let read = buffer.read(Cursor::Head, None);
    assert_eq!(read.chunks.len(), 2);
    assert_eq!(read.chunks[0].seq, 1);
    assert_eq!(read.chunks[0].bytes.len(), DEFAULT_MAX_CHUNK_SIZE);
    assert_eq!(read.chunks[1].seq, 2);
    assert_eq!(read.chunks[1].bytes, b"xxx");
}

#[test]
fn eviction_reports_dropped_sequences_and_bytes() {
    let buffer = ShellBuffer::new();
    buffer.append(
        StreamKind::Stdout,
        &vec![b'x'; DEFAULT_SHELL_RING_BUFFER_CAPACITY + DEFAULT_MAX_CHUNK_SIZE],
    );

    let stats = buffer.stats();
    assert!(stats.used_bytes <= DEFAULT_SHELL_RING_BUFFER_CAPACITY as u64);
    assert!(stats.dropped_bytes_total > 0);
    let read = buffer.read(Cursor::Seq { seq: 1 }, None);
    assert_eq!(read.dropped.unwrap().from_seq, 1);
}
```

Add cases for Head, Seq, TimeMs, TailBytes, Live, maximum read bytes, broadcast
delivery, and append without subscribers.

In `tests/shell_architecture.rs`, read the three source files through
`env!("CARGO_MANIFEST_DIR")` and assert `append_and_broadcast` and
`#[allow(clippy::too_many_arguments)]` are absent after this task, and raw
`ring`, `used_bytes`, `head_seq`, and `tail_seq` fields occur only in
`ssh_shell_buffer.rs`.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test ssh_shell_buffer -- --nocapture
cargo test --test shell_architecture buffer_state_has_one_owner -- --nocapture
```

Expected: FAIL because `ShellBuffer` is not implemented and raw buffer state
still lives in `ssh_shell.rs` and `ssh_connection.rs`.

- [ ] **Step 3: Implement the buffer owner**

Use this exact production shape:

```rust
pub(crate) struct ShellChunk {
    seq: u64,
    t_ms: f64,
    stream: StreamKind,
    bytes: Bytes,
}

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

impl ShellBuffer {
    pub(crate) fn new() -> Arc<Self>;
    pub(crate) fn append(&self, stream: StreamKind, data: &[u8]);
    pub(crate) fn read(
        &self,
        cursor: Cursor,
        max_bytes: Option<u64>,
    ) -> BufferReadResult;
    pub(crate) fn stats(&self) -> BufferStats;
    pub(crate) fn current_seq(&self) -> u64;
    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Arc<ShellChunk>>;
}
```

Move the four buffer constants into this module. Give `ShellChunk` crate-private
`seq()`, `t_ms()`, `stream()`, `bytes()`, and `to_terminal_chunk()` methods.
Preserve the existing lock order: push under the ring lock, release it, update
used bytes and eviction, then broadcast.

- [ ] **Step 4: Migrate current consumers**

Replace the buffer fields on `ShellSession` with:

```rust
pub(crate) buffer: Arc<ShellBuffer>,
```

Delegate `buffer_stats`, `current_seq`, and `read_buffer`. Update listener
replay to call `buffer.read()` and live follow to call `buffer.subscribe()`.
Update the existing Workmux probe and reader loop in `ssh_connection.rs` to call
`buffer.append()`. Do not move the reader or startup sequence in this task.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt
cargo test ssh_shell_buffer -- --nocapture
cargo test --test shell_architecture buffer_state_has_one_owner -- --nocapture
cargo test --lib
git add src/lib.rs src/ssh_shell_buffer.rs src/ssh_shell_buffer src/ssh_shell.rs src/ssh_connection.rs tests/shell_architecture.rs
git commit -m "Extract Rust shell buffer owner"
```

Expected: buffer, architecture, and all library tests PASS. The library total is
greater than the 40-test baseline.

### Task 2: ShellRegistry and Real SSH Test Fixture

**Files:**

- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_registry.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_registry/tests.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/test_support/mod.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/test_support/ssh_server.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/tests/shell_architecture.rs`

**Interfaces:**

- Produces `ShellRegistry::new`, `register`, `remove`, and `sessions`.
- Produces the test-only `ShellTestServer`, `ShellServerScenario`, and recorded
  `ShellServerEvent` fixture used by Tasks 3-5.
- Removes shell-session dependence on `Weak<SshConnection>` while leaving the
  connection's `self_weak` in place for command streams.

- [ ] **Step 1: Write failing registry ownership and race tests**

Add an architecture test that rejects a raw shell `HashMap` in
`ssh_connection.rs` and a `Weak<SshConnection>` field in `ShellSession`.

Write registry tests for empty snapshots and idempotent removal. Add this real
close-before-registration race using the test server:

```rust
#[tokio::test]
async fn reader_close_before_registration_leaves_registry_empty() {
    let server = ShellTestServer::spawn(ShellServerScenario::PlainShell {
        output: Vec::new(),
        close_after_output: true,
    })
    .await;
    let connection = server.connect().await;
    let callback = Arc::new(CountingShellClosedCallback::default());

    let registry_lock = connection.shells.sessions.lock().await;
    let connection_for_start = connection.clone();
    let callback_for_start = callback.clone();
    let start = tokio::spawn(async move {
        connection_for_start
            .start_shell(plain_shell_options(callback_for_start))
            .await
    });

    server.wait_for_event(ShellServerEvent::CloseSent).await;
    callback.wait_for_count(1).await;
    drop(registry_lock);

    let _session = start.await.unwrap().unwrap();
    assert!(connection.shells.sessions().await.is_empty());
    assert_eq!(callback.count(), 1);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test ssh_shell_registry -- --nocapture
cargo test --test shell_architecture registry_has_one_owner -- --nocapture
```

Expected: FAIL because `ShellRegistry` and the in-process fixture do not exist,
and the raw map still lives on `SshConnection`.

- [ ] **Step 3: Build the in-process russh fixture**

Use the installed russh 0.54.3 server API with `TcpListener` on `127.0.0.1:0`
and `server::run_stream()`. The fixture must define:

```rust
pub(crate) enum ShellServerScenario {
    RejectPty,
    PlainShell {
        output: Vec<u8>,
        close_after_output: bool,
    },
    Workmux {
        stdout: Vec<u8>,
        stderr: Vec<u8>,
        exit_status: Option<u32>,
        send_eof: bool,
        send_close: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ShellServerEvent {
    PtyRequested,
    ShellRequested,
    ExecRequested(Vec<u8>),
    EofSent,
    CloseSent,
    Disconnected,
}
```

The server accepts password authentication, calls `channel_success` or
`channel_failure` from PTY/shell/exec handlers, and emits scenario data through
`Session::data`, `extended_data`, `exit_status_request`, `eof`, and `close`.
Generate an ephemeral Ed25519 host key with existing dependencies. The client
helper calls the crate's real `connect()` with an accept-all server-key callback
and returns `Arc<SshConnection>`. Abort the server task in fixture Drop.

- [ ] **Step 4: Implement the registry owner**

Use:

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

Replace `SshConnection.shells` with `Arc<ShellRegistry>`. Pass a weak registry
to the current inline reader and `ShellSession`. Make reader end and explicit
close call `remove()`. Make disconnect iterate `sessions()`. Make registration
insert and then remove under the same lock when `reader_ended` is already true.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt
cargo test ssh_shell_registry -- --nocapture
cargo test --test shell_architecture registry_has_one_owner -- --nocapture
cargo test --lib
git add src/lib.rs src/ssh_shell_registry.rs src/ssh_shell_registry src/test_support src/ssh_connection.rs src/ssh_shell.rs tests/shell_architecture.rs
git commit -m "Add Rust shell session registry"
```

Expected: registry, close-before-register race, architecture, and library tests
PASS. The public connection and shell types remain unchanged.

### Task 3: Shared Channel Messages and One-Shot Close Notifier

**Files:**

- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_reader.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_reader/tests.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_channel.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_command.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/tests/shell_architecture.rs`

**Interfaces:**

- Produces `classify_shell_channel_message()` shared by probe and live reader.
- Produces `ShellCloseNotifier::new()` and `notify()`.
- Moves `channel_msg_summary()` to the shared channel module.
- Does not move the live reader loop yet.

- [ ] **Step 1: Write failing message and notifier tests**

Test all classifier variants with real `ChannelMsg` values:

```rust
#[test]
fn classifies_data_terminal_and_close_messages() {
    assert!(matches!(
        classify_shell_channel_message(&ChannelMsg::Data {
            data: CryptoVec::from_slice(b"out"),
        }),
        ShellChannelMessage::Stdout(bytes) if bytes == b"out"
    ));
    assert!(matches!(
        classify_shell_channel_message(&ChannelMsg::Eof),
        ShellChannelMessage::Eof
    ));
    assert!(matches!(
        classify_shell_channel_message(&ChannelMsg::Close),
        ShellChannelMessage::Close
    ));
}
```

Add stderr, zero/nonzero exit status, exit signal, Success, Failure, and Other.
Move the existing panic and notify-once tests to `ssh_shell_reader/tests.rs` and
assert `ShellCloseNotifier::notify()` returns true only for the first call.

Extend the architecture test to require the classifier name in both probe and
reader source paths and to reject callback/notification atomics outside the
reader module.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test ssh_shell_reader -- --nocapture
cargo test --test shell_architecture shell_messages_have_one_classifier -- --nocapture
```

Expected: FAIL because the shared classifier and notifier do not exist.

- [ ] **Step 3: Implement the classifier and notifier**

Use:

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

pub(crate) fn classify_shell_channel_message(
    message: &ChannelMsg,
) -> ShellChannelMessage<'_>;

pub(crate) struct ShellCloseNotifier {
    callback: Option<Arc<dyn ShellClosedCallback>>,
    channel_id: u32,
    notified: AtomicBool,
}

impl ShellCloseNotifier {
    pub(crate) fn new(
        callback: Option<Arc<dyn ShellClosedCallback>>,
        channel_id: u32,
    ) -> Arc<Self>;

    pub(crate) fn notify(&self) -> bool;
}
```

`notify()` uses the existing `catch_foreign_callback_unwind()` and an AcqRel
atomic swap. It returns false for duplicate notification or callback panic, but
the atomic remains set after a panic.

- [ ] **Step 4: Migrate both message paths**

Use the classifier in the current Workmux probe and live reader loops. Keep
probe decisions phase-specific: zero exit continues, nonzero exit and signal
fail, EOF/Close marks the probe ended, and data is both recorded and appended.
Keep live EOF non-final and live Close final.

Replace `on_closed_callback` plus `closed_notified` fields on `ShellSession`
with one `Arc<ShellCloseNotifier>`. Move `channel_msg_summary()` into
`ssh_channel.rs` and update both shell and command imports.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt
cargo test ssh_shell_reader -- --nocapture
cargo test --test shell_architecture shell_messages_have_one_classifier -- --nocapture
cargo test --lib
git add src/lib.rs src/ssh_shell_reader.rs src/ssh_shell_reader src/ssh_channel.rs src/ssh_command.rs src/ssh_connection.rs src/ssh_shell.rs tests/shell_architecture.rs
git commit -m "Centralize Rust shell channel messages"
```

Expected: classifier, callback, architecture, command, and shell tests PASS.

### Task 4: Dedicated Shell Reader Task

**Files:**

- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_reader.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_reader/tests.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_registry/tests.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/tests/shell_architecture.rs`

**Interfaces:**

- Produces `spawn_shell_reader(...) -> ShellReaderHandle`.
- Produces `ShellReaderHandle::abort`, `has_ended`, and `ended_flag`.
- Removes all `tokio::spawn` reader code from `ssh_connection.rs`.

- [ ] **Step 1: Write failing reader-lifetime tests**

Extend the real server tests:

```rust
#[tokio::test]
async fn remote_close_buffers_output_notifies_once_and_unregisters() {
    let server = ShellTestServer::spawn(ShellServerScenario::PlainShell {
        output: b"hello\r\n".to_vec(),
        close_after_output: true,
    })
    .await;
    let connection = server.connect().await;
    let callback = Arc::new(CountingShellClosedCallback::default());
    let shell = connection
        .start_shell(plain_shell_options(callback.clone()))
        .await
        .unwrap();

    callback.wait_for_count(1).await;
    let output = shell.read_buffer(Cursor::Head, None);
    assert_eq!(join_bytes(&output.chunks), b"hello\r\n");
    assert!(connection.shells.sessions().await.is_empty());
    assert_eq!(callback.count(), 1);
}
```

Add explicit close racing remote close and assert one callback and an empty
registry. Add an architecture assertion that `ssh_connection.rs` contains
neither `shell-reader begin` nor the reader `tokio::spawn` block.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test ssh_shell_reader -- --nocapture
cargo test --test shell_architecture reader_lifetime_has_one_owner -- --nocapture
```

Expected: FAIL because the live reader still lives inside `start_shell()` and
`ShellSession` still stores the raw join handle.

- [ ] **Step 3: Implement the reader handle and task**

Use the real russh read-half type:

```rust
pub(crate) struct ShellReaderHandle {
    task: JoinHandle<()>,
    ended: Arc<AtomicBool>,
}

impl ShellReaderHandle {
    pub(crate) fn abort(&self);
    pub(crate) fn has_ended(&self) -> bool;
    pub(crate) fn ended_flag(&self) -> Arc<AtomicBool>;
}

pub(crate) fn spawn_shell_reader(
    mut reader: russh::ChannelReadHalf,
    connection_id: String,
    channel_id: u32,
    buffer: Arc<ShellBuffer>,
    registry: Weak<ShellRegistry>,
    notifier: Arc<ShellCloseNotifier>,
) -> ShellReaderHandle;
```

The task uses the shared classifier. On Close or None it stores `ended = true`
with Release ordering, calls `notify()`, awaits registry removal if the weak
reference upgrades, and exits. It tracks exit status/signal only for the final
trace message. EOF traces and continues.

- [ ] **Step 4: Compose the handle into ShellSession**

Replace `reader_task` with `reader: ShellReaderHandle`. Make explicit close and
Drop call `reader.abort()`. Add this focused constructor to `ShellSession`:

```rust
pub(crate) fn new(
    info: ShellSessionInfo,
    writer: russh::ChannelWriteHalf<client::Msg>,
    buffer: Arc<ShellBuffer>,
    reader: ShellReaderHandle,
    notifier: Arc<ShellCloseNotifier>,
    registry: Weak<ShellRegistry>,
) -> Arc<Self>;
```

The constructor initializes listener task state, listener IDs, the 16 ms
coalescing default, and the current Tokio handle. Capture
`let reader_ended = reader.ended_flag()` before moving the handle into the
session, then call `registry.register(session.clone(), reader_ended.as_ref())`.
Do not add a reader supervisor or another lifetime type.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt
cargo test ssh_shell_reader -- --nocapture
cargo test ssh_shell_registry -- --nocapture
cargo test --test shell_architecture reader_lifetime_has_one_owner -- --nocapture
cargo test --lib
git add src/ssh_shell_reader.rs src/ssh_shell_reader src/ssh_connection.rs src/ssh_shell.rs src/ssh_shell_registry tests/shell_architecture.rs
git commit -m "Extract Rust shell reader lifetime"
```

Expected: reader, registry race, architecture, and library tests PASS.

### Task 5: PTY, Workmux, and Startup Coordinator Cutover

**Files:**

- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_startup.rs`
- Create:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_startup/tests.rs`
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/lib.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/test_support/ssh_server.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/tests/shell_architecture.rs`

**Interfaces:**

- Produces `ssh_shell_startup::start_shell(&SshConnection, StartShellOptions)`.
- Keeps `PtyRequest`, `ShellTarget`, `WorkmuxAttachProbe`, and request decisions
  private to the startup module.
- Reduces the exported `SshConnection::start_shell()` to one delegate call.

- [ ] **Step 1: Write failing pure startup tests**

Cover exact PTY normalization:

```rust
#[test]
fn pty_request_uses_defaults_and_overrides_modes_by_opcode() {
    let request = PtyRequest::from_options(&StartShellOptions {
        term: TerminalType::Xterm,
        terminal_mode: Some(vec![TerminalMode {
            opcode: russh::Pty::ECHO as u8,
            value: 0,
        }]),
        terminal_size: None,
        terminal_pixel_size: None,
        use_tmux: false,
        tmux_session_name: None,
        on_closed_callback: None,
    });

    assert_eq!(request.term_name, "xterm");
    assert_eq!((request.cols, request.rows), (80, 24));
    assert_eq!((request.pixel_width, request.pixel_height), (0, 0));
    assert_eq!(request.mode_value(russh::Pty::ECHO), Some(0));
}
```

Add unknown opcode, Workmux trim/empty, apostrophe quoting, request Success/
Failure/Close/EOF, probe stdout/stderr capture, zero/nonzero status, signal,
clean timeout, ended timeout, reader None, 1,024-byte bounds, newline
flattening, and stderr preference.

- [ ] **Step 2: Write failing real protocol tests**

Use `ShellTestServer` to assert:

- PTY term/dimensions/modes are recorded and login shell starts;
- PTY rejection returns the existing SSH request error;
- Workmux receives exactly `env PATH="$PATH:$HOME/bin" mdev tmux attach 'main'`;
- session name `main's work` is sent as `'main'\''s work'`;
- probe stdout and stderr are readable from the returned shell;
- nonzero exit returns `TmuxAttachFailed` with bounded stderr;
- EOF/Close waits for the 300 ms deadline then fails; and
- missing session and probe failure produce the server's Disconnected event.

Add an architecture assertion that `SshConnection::start_shell()` contains only
the delegate and `ssh_connection.rs` contains no PTY, Workmux, probe, reader, or
buffer constants.

- [ ] **Step 3: Run and verify RED**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test ssh_shell_startup -- --nocapture
cargo test --test shell_architecture connection_delegates_shell_startup -- --nocapture
```

Expected: FAIL because the coordinator and private phase types do not exist and
the 394-line startup method remains in `ssh_connection.rs`.

- [ ] **Step 4: Implement the startup module**

Use these private types:

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

Move channel open, request send/reply, quoting, Workmux output formatting, and
probe decisions from `ssh_connection.rs`. The coordinator must use this exact
order:

```rust
pub(crate) async fn start_shell(
    connection: &SshConnection,
    options: StartShellOptions,
) -> Result<Arc<ShellSession>, SshError> {
    let started_at_ms = now_ms();
    let term = options.term;
    let callback = options.on_closed_callback.clone();
    let pty = PtyRequest::from_options(&options);

    let mut guard = open_shell_channel(connection).await?;
    let channel_id: u32 = guard.channel().id().into();
    negotiate_pty(&mut guard, &pty).await?;
    let target = match ShellTarget::from_options(&options) {
        Ok(target) => target,
        Err(error) => {
            connection.disconnect().await.ok();
            return Err(error);
        }
    };
    start_target(&mut guard, &target).await?;

    let buffer = ShellBuffer::new();
    let channel = guard.into_inner();
    let (mut read_half, write_half) = channel.split();
    if let Err(error) = probe_workmux(&mut read_half, &target, buffer.as_ref()).await {
        connection.disconnect().await.ok();
        return Err(error);
    }

    let notifier = ShellCloseNotifier::new(callback, channel_id);
    let registry = Arc::downgrade(&connection.shells);
    let reader = spawn_shell_reader(
        read_half,
        connection.info.connection_id.clone(),
        channel_id,
        buffer.clone(),
        registry.clone(),
        notifier.clone(),
    );
    let reader_ended = reader.ended_flag();
    let session = ShellSession::new(
        ShellSessionInfo {
            channel_id,
            created_at_ms: started_at_ms,
            connected_at_ms: now_ms(),
            term,
            connection_id: connection.info.connection_id.clone(),
        },
        write_half,
        buffer,
        reader,
        notifier,
        registry,
    );
    connection
        .shells
        .register(session.clone(), reader_ended.as_ref())
        .await;
    Ok(session)
}
```

`probe_workmux()` returns immediately for `LoginShell`. Keep the coordinator
below 120 nonblank lines. Preserve guard ownership until channel split. On probe
failure after split, attempt full connection disconnect before returning the
existing `TmuxAttachFailed`.

- [ ] **Step 5: Delegate from SshConnection and move tests**

The exported method becomes:

```rust
pub async fn start_shell(
    &self,
    options: StartShellOptions,
) -> Result<Arc<ShellSession>, SshError> {
    crate::ssh_shell_startup::start_shell(self, options).await
}
```

Move the old shell request and Workmux tests out of the connection test module.
Keep connection callback, server-key, authentication, and disconnect tests
there. Remove all shell-startup imports from `ssh_connection.rs` except
`ShellSession`, `StartShellOptions`, `ShellRegistry`, and the delegate module.

- [ ] **Step 6: Run GREEN checks and commit**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt
cargo test ssh_shell_startup -- --nocapture
cargo test ssh_shell_reader -- --nocapture
cargo test ssh_shell_registry -- --nocapture
cargo test --test shell_architecture connection_delegates_shell_startup -- --nocapture
cargo test
git add src/lib.rs src/ssh_shell_startup.rs src/ssh_shell_startup src/ssh_connection.rs src/ssh_shell.rs src/test_support/ssh_server.rs tests/shell_architecture.rs
git commit -m "Extract Rust shell startup coordinator"
```

Expected: pure startup, real SSH protocol, reader, registry, architecture, and
all crate tests PASS.

### Task 6: Public Compatibility and Architecture Gate

**Files:**

- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/tests/shell_architecture.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_startup.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_buffer.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_reader.rs`
- Modify:
  `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_registry.rs`
- Create:
  `packages/react-native-uniffi-russh/src/__tests__/api-shell-wrapper.test.ts`

**Interfaces:**

- Locks source direction, file/function size, absence of duplicate owners, and
  unchanged TypeScript wrapper behavior.
- Removes any temporary visibility, imports, comments, or forwarding helpers
  left by Tasks 1-5.

- [ ] **Step 1: Add the final failing architecture assertions**

The Rust source test must count nonblank lines and enforce:

```rust
fn function_nonblank_lines(source: &str, start: usize) -> usize {
    let body = &source[start..];
    let mut depth = 0usize;
    let mut opened = false;
    let mut end = body.len();

    for (index, byte) in body.bytes().enumerate() {
        match byte {
            b'{' => {
                opened = true;
                depth += 1;
            }
            b'}' if opened => {
                depth -= 1;
                if depth == 0 {
                    end = index + 1;
                    break;
                }
            }
            _ => {}
        }
    }

    body[..end]
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
}

fn all_function_nonblank_lines(source: &str) -> Vec<usize> {
    source
        .match_indices("fn ")
        .map(|(start, _)| function_nonblank_lines(source, start))
        .collect()
}

assert!(nonblank_lines("src/ssh_connection.rs") < 700);
assert!(nonblank_lines("src/ssh_shell.rs") < 450);
assert!(nonblank_lines("src/ssh_shell_startup.rs") < 300);
assert!(nonblank_lines("src/ssh_shell_buffer.rs") < 300);
assert!(nonblank_lines("src/ssh_shell_reader.rs") < 250);
assert!(nonblank_lines("src/ssh_shell_registry.rs") < 150);
let startup = read_source("src/ssh_shell_startup.rs");
assert!(!all_function_nonblank_lines(&startup).is_empty());
assert!(
    all_function_nonblank_lines(&startup)
        .into_iter()
        .all(|lines| lines <= 120)
);
```

Also assert:

- only registry contains `HashMap<u32, Arc<ShellSession>>`;
- only buffer contains ring, used-byte, and sequence storage;
- reader and registry do not import `SshConnection`;
- startup owns `PtyRequest`, `ShellTarget`, and `WorkmuxAttachProbe` privately;
- no startup function exceeds 120 nonblank lines;
- no new `trait`, `Builder`, `Facade`, `Service`, `Supervisor`, or state-machine
  dependency appears in the four modules;
- `append_and_broadcast` and its Clippy allowance are absent; and
- `StartShellOptions`, `ShellSessionInfo`, and the exported `start_shell` method
  remain in their public modules.

- [ ] **Step 2: Add the TypeScript wrapper contract test**

Mock the generated connection and shell like the command wrapper test. Assert
`startShell()` sends this exact generated input and signal:

```ts
expect(generatedStartShell).toHaveBeenCalledWith(
	{
		term: generated.TerminalType.Xterm,
		onClosedCallback: expect.objectContaining({
			onChange: expect.any(Function),
		}),
		terminalMode: [{ opcode: 53, value: 0 }],
		terminalPixelSize: { pixelWidth: 800, pixelHeight: 600 },
		terminalSize: { colWidth: 80, rowHeight: 24 },
		useTmux: true,
		tmuxSessionName: 'main',
	},
	{ signal },
);
```

Resolve a generated shell and assert the wrapper retains channel ID, timestamps,
terminal type, connection ID, send, resize, close, buffer, cursor, listener, and
remove-listener behavior.

- [ ] **Step 3: Run and verify RED**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test --test shell_architecture -- --nocapture
cd "$(git rev-parse --show-toplevel)"
pnpm --filter @fressh/react-native-uniffi-russh exec jest src/__tests__/api-shell-wrapper.test.ts --runInBand
```

Expected: the TypeScript compatibility test passes immediately. The architecture
test reports any residual ownership, visibility, or size violation. If it also
passes, make no production cleanup in Step 4.

- [ ] **Step 4: Remove residual structure and satisfy the gates**

Delete temporary crate-visible phase helpers, obsolete imports, old buffer/
reader comments, duplicate callback functions, and moved tests. Keep only the
four sibling modules approved by the design. If a size limit cannot be met by
removing residual code and tightening the owning unit, stop for design review;
do not create a forwarding file. Any production cleanup starts with a focused
failing architecture test. Skip this step when the architecture test is already
green.

- [ ] **Step 5: Verify generated bindings are unchanged**

```bash
git diff --exit-code -- packages/react-native-uniffi-russh/src/generated packages/react-native-uniffi-russh/cpp/generated
```

Expected: no diff. Do not run a hand edit or accept generated changes because
the public UniFFI contract did not change.

- [ ] **Step 6: Run GREEN checks and commit**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt
cargo test --test shell_architecture -- --nocapture
cargo test
cd "$(git rev-parse --show-toplevel)"
pnpm --filter @fressh/react-native-uniffi-russh exec jest src/__tests__/api-shell-wrapper.test.ts --runInBand
pnpm --filter @fressh/react-native-uniffi-russh typecheck
git add packages/react-native-uniffi-russh/rust/uniffi-russh/src packages/react-native-uniffi-russh/rust/uniffi-russh/tests packages/react-native-uniffi-russh/src/__tests__/api-shell-wrapper.test.ts
git commit -m "Enforce Rust shell startup boundaries"
```

Expected: architecture, full Rust, wrapper, and TypeScript checks PASS with no
generated diff.

### Task 7: Full Verification and Maintainability Review

**Files:**

- Modify only files required by a failing verification check or a confirmed
  maintainability blocker. Every production fix still starts with a focused
  failing test.

**Interfaces:**

- Verifies the complete Rust decomposition, package compatibility, and source
  ownership without building or deploying a mobile application.

- [ ] **Step 1: Run complete Rust verification**

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo fmt -- --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: formatting, every unit/architecture/real-SSH test, and Clippy PASS.
The known `num-bigint-dig` future-incompatibility note may still print; no new
crate warning is accepted.

- [ ] **Step 2: Run package and repository checks**

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm --filter @fressh/react-native-uniffi-russh test
pnpm --filter @fressh/react-native-uniffi-russh fmt:check
pnpm --filter @fressh/react-native-uniffi-russh lint:check
pnpm --filter @fressh/react-native-uniffi-russh typecheck
pnpm exec turbo lint:check
```

Expected: Jest, Prettier, ESLint, TypeScript, and repository lint checks exit 0.

- [ ] **Step 3: Run final ownership and compatibility checks**

```bash
cd "$(git rev-parse --show-toplevel)"
if rg -n "append_and_broadcast|clippy::too_many_arguments" packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_{connection,shell,channel}.rs packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_{startup,buffer,reader,registry}.rs; then exit 1; fi
if rg -n "Weak<SshConnection>" packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell.rs packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_shell_reader.rs; then exit 1; fi
git diff --exit-code -- packages/react-native-uniffi-russh/src/generated packages/react-native-uniffi-russh/cpp/generated
git diff --check
```

Expected: obsolete ownership patterns are absent, generated bindings are
unchanged, and the diff has no whitespace errors.

- [ ] **Step 4: Check every approved requirement against evidence**

Point each design requirement to a passing test or source gate: unchanged API,
PTY defaults/overrides, login shell, Workmux command/quote/probe, failure
detail, probe output preservation, shared classifier, EOF/Close behavior, buffer
limits, reader/close notification, registration races, disconnect cleanup,
dependency direction, and every file/function limit. Add a new focused failing
test before fixing any uncovered item.

- [ ] **Step 5: Run the thermo-nuclear review**

Invoke `$thermo-nuclear-code-quality-review` on the complete implementation
diff. It must inspect giant-file risk, conditional growth in startup and reader,
parallel state in the buffer, registry/lifetime races, duplicated channel
handling, public API drift, test realism, and abstraction stacking. Resolve
every blocker through a new red-green cycle, then repeat Steps 1-3.

- [ ] **Step 6: Confirm the verified branch state**

```bash
git status --short
git diff --stat
```

Expected: no uncommitted implementation changes remain. Each review fix has its
own test-first commit. Record Rust test count, real-SSH scenario count, Clippy,
package checks, architecture limits, generated-diff result, and thermo-nuclear
result in the pull request. Native builds, EAS, OTA, device installation, and
application-data changes remain outside this plan.
