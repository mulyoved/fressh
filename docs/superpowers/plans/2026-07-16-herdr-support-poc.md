# Herdr Support POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Android-first Herdr provider that opens a saved SSH host, lists
the default session's agents, controls one stable terminal at a time, and
switches agents through the existing Fressh keyboard.

**Architecture:** Keep Herdr outside the ordinary shell controller graph. A
saved-host launcher reuses or creates a registry-owned SSH connection, a pure
snapshot adapter populates one in-memory provider store, and dedicated list and
terminal routes consume that state. A generation-scoped terminal owner is the
only component allowed to operate the Herdr command stream; it validates the
delta protocol before writing to xterm and releases control without owning the
underlying SSH connection.

**Tech Stack:** Expo Router, React Native, TypeScript, Zustand, Zod,
`base64-js`, xterm.js WebView, UniFFI russh command streams, Node test runner,
Jest, pnpm, Prettier, ESLint.

## Global Constraints

- Implement issue [#143](https://github.com/mulyoved/fressh/issues/143) against
  `docs/superpowers/specs/2026-07-16-herdr-support-poc-design.md`.
- Use Herdr's default session only. Do not implement session discovery, session
  names, latest-session selection, or Collie-style session switching.
- Use `terminal_id` as the route, selection, navigation, and controller target.
  Treat `pane_id`, workspace, and tab as mutable presentation metadata only.
- Reuse a matching registered SSH connection. A new connection must go through
  `useSshStore.connect()` and must not call `startShell()`.
- The SSH registry owns connections. Herdr route cleanup must never disconnect a
  registry-owned SSH connection.
- The terminal owner owns at most one Herdr controller stream and admits writes
  only from its current generation.
- Do not change `/home/muly/code/herdr`, the Rust SSH package, generated files,
  or `packages/react-native-xtermjs-webview`.
- Do not route Herdr through `ShellDetail`, shell controllers, Workmux ports,
  tmux copy-mode ownership, or generic host-command actions.
- Preserve all ordinary shell behavior and keyboard behavior.
- Keep the full configured keyboard. The literal `TBD for Herdr` is intentional
  UI copy and is the required result of unsupported shell-specific actions.
- The main `WORKMUX_NAV_NEXT` Work action selects the next displayed agent.
  `WORKMUX_NAV_PREV` and `WORKMUX_NAV_NEXT` in the Work long-press menu select
  the previous and next displayed agents. Workmux scope and all other
  shell-specific actions show `TBD for Herdr`.
- A normal controller conflict must show an explicit **Take Over** action. Never
  add `--takeover` automatically, including retry and foreground reacquisition.
- Treat the terminal output as a delta stream. A missing, malformed, invalid, or
  out-of-order required frame fails the generation; never render later partial
  frames until a fresh generation supplies `full: true`.
- Use a 4 MiB incomplete-line limit, a 16 KiB sanitized stderr tail, a 10-second
  first-frame deadline, and 100 ms resize coalescing.
- In the background AppState callback, call native `SshCommandStream.close()`
  immediately in the same JavaScript turn. Do not put that call behind a timer,
  `await`, or release-promise continuation.
- Do not run `test:e2e:clear-state`, clear `com.finalapp.vibe2` data, uninstall
  the app, or replace its signing lane.
- Use test-driven development. Run each new focused test once while red, make
  the minimum implementation green, then rerun affected regressions.
- Keep diagnostics content-free: log IDs, generations, state transitions,
  sequence numbers, dimensions, byte counts, and sanitized reason classes; never
  log terminal bytes, input, credentials, raw snapshot JSON, or raw stderr.

---

## Binding Contracts

### File layout

Create the provider under one new library namespace and two new routes:

```text
apps/mobile/src/lib/herdr/
  contracts.ts
  snapshot.ts
  provider-store.ts
  host-launcher.ts
  protocol.ts
  terminal-owner.ts
  keyboard-adapter.ts
apps/mobile/src/app/herdr/
  index.tsx
  terminal.tsx
  HerdrAgentListView.tsx
  HerdrTerminalView.tsx
```

The library files remain importable in Node integration tests. React, Expo
Router, React Native, secure storage, and native module imports belong in the
routes or are supplied to the pure library functions through ports.

### Provider domain

`contracts.ts` defines the normalized provider data and route identity:

```ts
export const HERDR_STATUS_ORDER = [
	'blocked',
	'done',
	'working',
	'idle',
	'unknown',
] as const;

export type HerdrAgentStatus = (typeof HERDR_STATUS_ORDER)[number];

export type HerdrAgent = Readonly<{
	terminalId: string;
	paneId: string;
	workspaceId: string;
	workspaceLabel: string;
	tabId: string;
	tabLabel: string;
	label: string;
	status: HerdrAgentStatus;
	cwdBasename: string | null;
	order: number;
}>;

export type HerdrSnapshot = Readonly<{
	version: string;
	protocol: number;
	agents: readonly HerdrAgent[];
}>;

export type HerdrHostState = Readonly<{
	storedConnectionId: string;
	connectionId: string;
	snapshot: HerdrSnapshot;
}>;

export type HerdrAgentGroup = Readonly<{
	status: HerdrAgentStatus;
	label: 'Needs attention' | 'Ready' | 'Working' | 'Idle' | 'Unknown';
	agents: readonly HerdrAgent[];
}>;
```

The adapter returns agents already sorted by status group and stable
workspace/tab/pane order. `nextHerdrTerminalId(agents, current, direction)` uses
that same flattened array, wraps at both ends, and returns `null` for an empty
list or a missing current target. `findHerdrAgent(snapshot, terminalId)`
reconciles route identity against a refreshed snapshot without storing a
selection in the provider store.

### Terminal owner ports and state

`terminal-owner.ts` owns the native stream through narrow structural types so
tests do not load React Native:

```ts
export type HerdrTerminalState =
	| Readonly<{ phase: 'starting'; generation: number }>
	| Readonly<{ phase: 'active'; generation: number }>
	| Readonly<{
			phase: 'owned-elsewhere';
			generation: number;
			reason: string;
	  }>
	| Readonly<{ phase: 'backgrounded'; generation: number }>
	| Readonly<{ phase: 'releasing'; generation: number }>
	| Readonly<{
			phase: 'error';
			generation: number;
			kind: 'synchronization' | 'timeout' | 'closed' | 'transport';
			reason: string;
	  }>;

export type HerdrCommandStream = Readonly<{
	sendData(data: ArrayBuffer): Promise<void>;
	close(): Promise<void>;
}>;

export type HerdrTerminalConnection = Readonly<{
	startCommandStream(input: {
		command: string;
		onEvent(event: HerdrCommandStreamEvent): void;
		abortSignal?: AbortSignal;
	}): Promise<HerdrCommandStream>;
}>;

export type HerdrRendererPort = Readonly<{
	replace(bytes: Uint8Array): void;
	append(bytes: Uint8Array): void;
}>;

export type HerdrTerminalOwner = Readonly<{
	getState(): HerdrTerminalState;
	subscribe(listener: (state: HerdrTerminalState) => void): () => void;
	start(input: { cols: number; rows: number; takeover?: boolean }): void;
	retry(input: { cols: number; rows: number }): void;
	takeOver(input: { cols: number; rows: number }): void;
	sendInput(bytes: Uint8Array): boolean;
	resize(cols: number, rows: number): boolean;
	scroll(direction: 'up' | 'down', lines: number): boolean;
	retire(
		reason: 'back' | 'switch' | 'retry' | 'failure' | 'unmount',
	): Promise<void>;
	background(): void;
}>;
```

`retry()` and a new route target always start without takeover. `takeOver()` is
the sole public API that sets takeover. Foreground reacquisition is implemented
by refreshing the provider snapshot and calling `start()` on a fresh owner (or
fresh owner generation), never by reviving a retired generation.

### Wire protocol

`protocol.ts` is pure and exports:

```ts
export const HERDR_MAX_INCOMPLETE_LINE_BYTES = 4 * 1024 * 1024;
export const HERDR_MAX_STDERR_BYTES = 16 * 1024;
export const HERDR_FIRST_FRAME_TIMEOUT_MS = 10_000;
export const HERDR_RESIZE_COALESCE_MS = 100;
export const HERDR_RELEASE_WAIT_MS = 250;

export type HerdrTerminalRecord =
	| Readonly<{
			type: 'frame';
			seq: number;
			width: number;
			height: number;
			full: boolean;
			bytes: Uint8Array;
	  }>
	| Readonly<{ type: 'closed'; reason: string | null }>
	| Readonly<{ type: 'unknown' }>;

export function buildHerdrControlCommand(input: {
	terminalId: string;
	cols: number;
	rows: number;
	takeover: boolean;
}): string;
export function createHerdrLineDecoder(): {
	push(bytes: Uint8Array): string[];
	finish(): string[];
};
export function parseHerdrTerminalRecord(line: string): HerdrTerminalRecord;
export function encodeHerdrInput(bytes: Uint8Array): Uint8Array;
export function encodeHerdrResize(cols: number, rows: number): Uint8Array;
export function encodeHerdrScroll(
	direction: 'up' | 'down',
	lines: number,
): Uint8Array;
export function encodeHerdrRelease(): Uint8Array;
```

The command uses the existing `quoteShell()` helper. Each encoder emits UTF-8
JSON followed by exactly one newline. Strict Base64 means decode succeeds and
`fromByteArray(decoded)` equals the supplied canonical string.

---

### Task 1: Snapshot Adapter and Stable Agent Navigation

**Files:**

- Create: `apps/mobile/src/lib/herdr/contracts.ts`
- Create: `apps/mobile/src/lib/herdr/snapshot.ts`
- Create: `apps/mobile/test/integration/herdr-snapshot.test.ts`

**Interfaces:**

- Consumes `runRemoteTextCommand()` through an injected one-shot command port.
- Produces `loadHerdrSnapshot()`, `parseHerdrSnapshot()`, `groupHerdrAgents()`,
  `findHerdrAgent()`, and `nextHerdrTerminalId()`.

- [ ] **Step 1: Write the failing raw-snapshot mapping tests**

Use fixtures shaped like Herdr's actual success envelope, not a raw snapshot:

```ts
const response = {
	id: 'request-1',
	result: {
		type: 'session_snapshot',
		snapshot: {
			version: '0.7.2',
			protocol: 1,
			workspaces: [
				{
					workspace_id: 'workspace-a',
					label: 'Fressh',
				},
			],
			tabs: [
				{
					tab_id: 'tab-a',
					workspace_id: 'workspace-a',
					label: 'Agents',
				},
			],
			panes: [
				{
					pane_id: 'pane-old',
					terminal_id: 'terminal-stable',
					workspace_id: 'workspace-a',
					tab_id: 'tab-a',
					label: 'Codex',
				},
			],
			agents: [
				{
					terminal_id: 'terminal-stable',
					pane_id: 'pane-old',
					workspace_id: 'workspace-a',
					tab_id: 'tab-a',
					display_agent: 'Codex',
					agent_status: 'blocked',
					foreground_cwd: '/home/muly/code/fressh',
				},
			],
		},
	},
};
```

Assert the stable terminal ID survives a pane-ID change, unknown/missing status
maps to `unknown`, safe cwd basename is `fressh`, unknown response fields are
accepted, duplicate or empty terminal IDs are rejected, and malformed response
envelopes fail without retaining raw JSON in the error.

- [ ] **Step 2: Write failing ordering, grouping, and wrap tests**

Build shuffled statuses over two workspace arrays, two tab arrays, and several
pane arrays. Assert status order is blocked/done/working/idle/unknown and order
within each group follows the snapshot workspace, tab, then pane array. Assert
next/previous wrap and missing-current behavior use terminal IDs only.

- [ ] **Step 3: Run the focused RED test**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-snapshot.test.ts
```

Expected: fail because the Herdr snapshot modules do not exist.

- [ ] **Step 4: Implement permissive raw validation and strict consumed fields**

Use Zod objects without `.strict()` so future Herdr fields are ignored. Keep
`agent_status` as `unknown().optional()` and normalize with an allow-list. Build
workspace/tab/pane index maps from their array positions and use the agent's
`pane_id` only to locate its current presentation and order.

The one-shot remote command is exactly:

```ts
export const HERDR_SNAPSHOT_COMMAND =
	'command -v herdr >/dev/null 2>&1 && ' +
	'herdr terminal session control --help >/dev/null 2>&1 && ' +
	'herdr api snapshot';

export async function loadHerdrSnapshot(input: {
	run(command: string): Promise<string>;
}): Promise<HerdrSnapshot> {
	const output = await input.run(HERDR_SNAPSHOT_COMMAND);
	return parseHerdrSnapshot(output);
}
```

Return a user-facing Herdr 0.7.2-or-newer availability error when the compound
probe fails, but do not parse a version as the capability gate.

- [ ] **Step 5: Run GREEN and commit**

Run the focused test again, then:

```bash
git add apps/mobile/src/lib/herdr/contracts.ts \
	apps/mobile/src/lib/herdr/snapshot.ts \
	apps/mobile/test/integration/herdr-snapshot.test.ts
git commit -m "Add Herdr snapshot adapter"
```

Expected: snapshot tests pass and the commit contains no UI or native imports.

---

### Task 2: In-Memory Provider Store and Saved-Host Launcher

**Files:**

- Create: `apps/mobile/src/lib/herdr/provider-store.ts`
- Create: `apps/mobile/src/lib/herdr/host-launcher.ts`
- Create: `apps/mobile/test/integration/herdr-provider-store.test.ts`
- Create: `apps/mobile/test/integration/herdr-host-launcher.test.ts`

**Interfaces:**

- Consumes normalized saved connection details, secure key lookup, the SSH
  registry snapshot, `useSshStore.connect`, and `loadHerdrSnapshot` through
  injected ports.
- Produces `useHerdrProviderStore`, `prepareHerdrHost()`, and one current
  `HerdrHostState` held only in memory.

- [ ] **Step 1: Write failing store replacement and reconciliation tests**

Assert the store holds only one active host and replaces its snapshot
atomically. Exercise `findHerdrAgent()` across pane/workspace movement and
verify the same route-local `terminalId` resolves until that terminal ID
disappears. Assert no selected-terminal field, persistence middleware, or
serialization port exists.

- [ ] **Step 2: Write failing active-connection reuse tests**

Supply two registered connections and match with
`getStoredConnectionId(connection.connectionDetails)`. Assert the matching live
connection is reused, key lookup and connect are not called, snapshot is loaded,
and `startShell` is never part of the launcher port.

- [ ] **Step 3: Write failing new-connection and failure tests**

For a missing active connection, assert the launcher:

1. resolves the requested saved entry;
2. normalizes optional connection fields;
3. loads the referenced private key;
4. calls the supplied registry `connect()` with key security and a bounded abort
   signal;
5. loads the snapshot; and
6. returns `{ storedConnectionId, connectionId, snapshot }`.

Assert missing entries, keys, connection failures, and Herdr probe failures do
not publish partial store state or disconnect any registry connection.

- [ ] **Step 4: Run the focused RED tests**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-provider-store.test.ts \
	test/integration/herdr-host-launcher.test.ts
```

Expected: fail because the store and launcher do not exist.

- [ ] **Step 5: Implement the launcher behind dependency ports**

Use this binding contract:

```ts
// Type query only: it is erased and does not load the native module in tests.
type NativeRnRussh = typeof import('@fressh/react-native-uniffi-russh').RnRussh;

export type PrepareHerdrHostPorts = Readonly<{
	getSavedConnection(
		storedConnectionId: string,
	): Promise<StoredConnectionEntry | null>;
	getPrivateKey(keyId: string): Promise<string>;
	getConnections(): Readonly<Record<string, RegisteredSshConnection>>;
	connect: NativeRnRussh['connect'];
	loadSnapshot(connection: RegisteredSshConnection): Promise<HerdrSnapshot>;
}>;

export async function prepareHerdrHost(input: {
	storedConnectionId: string;
	ports: PrepareHerdrHostPorts;
	abortSignal?: AbortSignal;
}): Promise<HerdrHostState>;
```

At the React boundary, adapt `secretsManager.connections.query.get`,
`secretsManager.keys.utils.getPrivateKey`, and `useSshStore.getState()`. Do not
import the secrets manager or native russh API in the pure launcher. Use the
existing pure `connectWithoutRemembering()` flow for timeout/abort and the
repository's current server-key callback behavior. Do not call
`connectAndOpenShell()` because it always enters the shell lifecycle.

- [ ] **Step 6: Run GREEN and commit**

```bash
git add apps/mobile/src/lib/herdr/provider-store.ts \
	apps/mobile/src/lib/herdr/host-launcher.ts \
	apps/mobile/test/integration/herdr-provider-store.test.ts \
	apps/mobile/test/integration/herdr-host-launcher.test.ts
git commit -m "Add Herdr host launcher"
```

Expected: focused tests pass; repository search finds no `startShell` call under
`src/lib/herdr`.

---

### Task 3: Pure Herdr Terminal Protocol Codec

**Files:**

- Create: `apps/mobile/src/lib/herdr/protocol.ts`
- Create: `apps/mobile/test/integration/herdr-protocol.test.ts`

**Interfaces:**

- Consumes `quoteShell()` and `base64-js`.
- Produces the command builder, bounded byte line decoder, known-record parser,
  outbound record encoders, and stderr sanitization helpers.

- [ ] **Step 1: Write failing command and outbound-record tests**

Cover apostrophes and shell metacharacters in terminal IDs, invalid dimensions,
normal versus takeover commands, UTF-8 input, zero bytes, exact Base64, exactly
one trailing newline, resize pixels fixed at zero, scroll direction, and line
clamping to `1..65535`.

Expected commands:

```text
herdr terminal session control 'terminal-1' --cols 120 --rows 40
herdr terminal session control 'terminal-1' --cols 120 --rows 40 --takeover
```

- [ ] **Step 2: Write failing incremental framing tests**

Split UTF-8 code points, JSON tokens, CRLF, and multiple records across
arbitrary stdout chunks. Assert `finish()` returns the final unterminated
record, empty lines are rejected as malformed records, and an incomplete line
over 4 MiB throws before another allocation grows the buffer.

- [ ] **Step 3: Write failing record-validation tests**

Assert:

- known frames require safe positive integer `seq`, width, and height;
- encoding is exactly `ansi`;
- `full` is boolean;
- Base64 must be canonical and valid;
- `terminal.closed` accepts a string or absent/null reason;
- unknown well-formed record types become `{ type: 'unknown' }`; and
- invalid JSON or malformed known records throw a typed protocol error.

- [ ] **Step 4: Write failing bounded-stderr tests**

Feed split chunks larger than 16 KiB and assert only the tail is retained,
control characters are removed, whitespace is collapsed for display, and raw
terminal/input content is never included in the returned error class.

- [ ] **Step 5: Run the focused RED test**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-protocol.test.ts
```

Expected: fail because the codec does not exist.

- [ ] **Step 6: Implement byte-bounded line framing and strict parsing**

Keep pending stdout as a `Uint8Array`, split on byte `0x0a`, strip one trailing
`0x0d`, and decode each complete line with a fatal UTF-8 `TextDecoder`. This is
incremental across SSH chunks while measuring the 4 MiB limit in wire bytes
rather than JavaScript characters.

Encode records with one helper:

```ts
const encoder = new TextEncoder();

function encodeRecord(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(value)}\n`);
}
```

- [ ] **Step 7: Run GREEN and commit**

```bash
git add apps/mobile/src/lib/herdr/protocol.ts \
	apps/mobile/test/integration/herdr-protocol.test.ts
git commit -m "Add Herdr terminal protocol codec"
```

Expected: all codec cases pass without React or native imports.

---

### Task 4: Terminal Owner Frame Integrity and Ordered I/O

**Files:**

- Create: `apps/mobile/src/lib/herdr/terminal-owner.ts`
- Create: `apps/mobile/test/integration/herdr-terminal-owner.test.ts`

**Interfaces:**

- Consumes a `HerdrTerminalConnection`, renderer port, logger port, and injected
  clock/timer functions.
- Produces the stateful `createHerdrTerminalOwner()` contract defined above.

- [ ] **Step 1: Write failing startup and baseline tests**

Assert `start({ cols, rows })` opens exactly one stream with the stable terminal
ID, publishes `starting`, and starts a 10-second first-frame deadline. The first
accepted frame must be `full: true`; it calls `renderer.replace(bytes)` once and
publishes `active`. A first partial frame fails synchronization and renders
nothing.

- [ ] **Step 2: Write failing delta-sequence tests**

After baseline sequence 7, assert sequence 8 appends, duplicate/older sequence 7
is ignored, and sequence 9 arriving before 8 fails the generation. After a
failure, later partial and full records from that same generation cannot render
or publish state. Retry uses a new generation, starts without takeover, and
requires a new full baseline before replacing xterm.

- [ ] **Step 3: Write failing malformed-stream tests**

Exercise invalid JSON, malformed known records, invalid Base64, invalid UTF-8,
and an oversized incomplete line. Every case must:

1. stop renderer delivery immediately;
2. stop admitting input;
3. publish one recoverable synchronization error;
4. begin idempotent release/close; and
5. ignore all late events from the failed generation.

Unknown valid record types remain ignored. A missing first full frame fails as
`timeout` at exactly 10 seconds.

- [ ] **Step 4: Write failing ordered outbound tests**

Make `sendData()` promises settle out of order unless serialized. Interleave
typing, macro bytes, resize, and scroll and assert the native calls preserve
admission order. Resize coalesces for 100 ms and keeps only the newest positive
size. Scroll uses the clamped positive u16 line count. Writes are rejected once
retirement begins.

- [ ] **Step 5: Run the focused RED test**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-terminal-owner.test.ts
```

Expected: fail because the owner does not exist.

- [ ] **Step 6: Implement a generation record and serialized queue**

Each generation owns all mutable stream state:

```ts
type Generation = {
	id: number;
	retired: boolean;
	admitting: boolean;
	releaseQueued: boolean;
	stream: HerdrCommandStream | null;
	streamPromise: Promise<HerdrCommandStream> | null;
	decoder: ReturnType<typeof createHerdrLineDecoder>;
	stderr: ReturnType<typeof createBoundedHerdrStderr>;
	lastSeq: number | null;
	queue: Promise<void>;
	firstFrameTimer: ReturnType<typeof setTimeout> | null;
	resizeTimer: ReturnType<typeof setTimeout> | null;
	pendingResize: { cols: number; rows: number } | null;
};
```

Every event, timer, queue continuation, and stream-resolution continuation first
checks that its generation is current and not retired. Cleanup may finish for an
old generation but may not publish visible state.

- [ ] **Step 7: Implement frame handling before renderer delivery**

Parse every complete line before dispatch. For frames, validate the baseline or
exact next sequence before calling the renderer. Never call `append()` and then
discover a sequence error. Store no terminal bytes after delivery.

- [ ] **Step 8: Run GREEN and commit**

```bash
git add apps/mobile/src/lib/herdr/terminal-owner.ts \
	apps/mobile/test/integration/herdr-terminal-owner.test.ts
git commit -m "Add Herdr terminal owner"
```

Expected: the owner tests pass, including frame loss and malformed-frame
resynchronization cases.

---

### Task 5: Ownership Conflict, Cleanup, and Background Safety

**Files:**

- Modify: `apps/mobile/src/lib/herdr/terminal-owner.ts`
- Modify: `apps/mobile/test/integration/herdr-terminal-owner.test.ts`

**Interfaces:**

- Completes the owner lifecycle for takeover, graceful retirement, background,
  late stream startup, terminal closure, and foreground-created generations.

- [ ] **Step 1: Write failing controller-conflict tests**

Feed a `terminal.closed` reason containing Herdr's stable conflict phrase:

```text
already has an attached client; retry with --takeover
```

Assert normal start publishes `owned-elsewhere`, closes the failed stream, and
does not restart. `takeOver()` creates one fresh generation whose command ends
in `--takeover`. `retry()` and foreground start omit it.

- [ ] **Step 2: Write failing graceful-retirement tests**

For back, switch, retry, failure, and unmount, assert the owner stops admission,
queues at most one `terminal.release`, gives it a bounded best-effort window,
and calls close even when send rejects or never settles. Repeated retirement is
idempotent and all callers receive the same cleanup promise. The underlying
connection is never disconnected. A successor requested by retry or takeover
starts only after close has been invoked for the prior stream.

- [ ] **Step 3: Write the critical background-suspension test**

Keep release `sendData()` pending and do not advance timers or microtasks after
calling `background()`. Assert synchronously, before `background()` returns:

```ts
assert.equal(owner.getState().phase, 'backgrounded');
assert.equal(stream.close.mock.calls.length, 1);
```

Also assert input admission is already closed. This test must fail if native
close is moved into `await`, `.then()`, `setTimeout()`, or the outbound queue.

- [ ] **Step 4: Write failing pending-start and late-event tests**

Background the owner before `startCommandStream()` resolves. When the late
stream handle arrives, assert it is closed immediately and cannot publish or
render. Repeat with a rejected close promise, late stdout, late stderr,
`exitStatus`, `exitSignal`, and `closed` events; cleanup failures are logged
only as bounded metadata.

- [ ] **Step 5: Run the focused RED test**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-terminal-owner.test.ts
```

Expected: new lifecycle cases fail until cleanup behavior is complete.

- [ ] **Step 6: Implement two explicit cleanup paths**

Graceful cleanup may use the serialized queue and a bounded wait. Background
cleanup must begin native close in the current call stack:

```ts
generation.admitting = false;
generation.retired = true;
publish({ phase: 'backgrounded', generation: generation.id });
void bestEffortReleaseWithoutBlockingClose(generation);
if (generation.stream) {
	void generation.stream.close().catch((error) => {
		logCleanupFailure(generation.id, error);
	});
} else {
	generation.closeImmediatelyWhenStarted = true;
}
```

Do not put `close()` inside `bestEffortReleaseWithoutBlockingClose()`.

- [ ] **Step 7: Run GREEN and commit**

```bash
git add apps/mobile/src/lib/herdr/terminal-owner.ts \
	apps/mobile/test/integration/herdr-terminal-owner.test.ts
git commit -m "Harden Herdr controller ownership"
```

Expected: all owner tests pass with fake timers left untouched in the critical
background assertion.

---

### Task 6: Herdr Keyboard Adapter

**Files:**

- Create: `apps/mobile/src/lib/herdr/keyboard-adapter.ts`
- Modify: `apps/mobile/src/app/shell/components/keyboard-component-props.ts`
- Modify: `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
- Modify:
  `apps/mobile/src/app/shell/components/TerminalKeyboardLongPressController.ts`
- Modify: `apps/mobile/test/integration/terminal-keyboard-component.test.ts`
- Create: `apps/mobile/test/integration/herdr-keyboard-adapter.test.ts`

**Interfaces:**

- Consumes `KeyboardExecutableItem`, the current keyboard's macros, terminal
  input, clipboard/selection, fit, keyboard selection, and agent-navigation
  ports.
- Produces provider-safe `onSlotPress`, modifier state, selected keyboard, and
  the props needed by the existing `TerminalKeyboard`.

- [ ] **Step 1: Write failing terminal-input and macro tests**

Assert text uses UTF-8, raw byte slots preserve all bytes, modifiers apply to
the next text/byte input using the current provider-independent encoding rules,
and parsed macro command/text/sequence/step forms preserve their order through
one owner input path. Missing macros produce bounded feedback rather than a
shell command.

- [ ] **Step 2: Write failing local action tests**

Assert:

- keyboard-target actions and rotation change the displayed configured keyboard;
- `PASTE_CLIPBOARD` reads locally and emits terminal input;
- `COPY_SELECTION` reads xterm and writes locally;
- `FIT_TERMINAL_TO_DEVICE` calls xterm fit, with resize sent later from xterm's
  normal `onResize`; and
- selection state only changes xterm/keyboard presentation.

Add a provider-neutral `workKeyLongPressMode` prop whose default is
`'workmux-scoped'`. Assert the existing default still generates scoped Workmux
options, while `'configured'` preserves the configured Work long-press list
(`Prev`, `Next`, then the three scope actions) without the Workmux-only
duplicate Previous option. Herdr uses `'configured'`; ordinary shell keeps the
default.

- [ ] **Step 3: Write failing Work and unsupported-action tests**

Map only `WORKMUX_NAV_PREV` and `WORKMUX_NAV_NEXT` to previous/next agent
navigation. The main Work key already emits `WORKMUX_NAV_NEXT`, so it follows
the same next-agent path. Assert Workmux scope actions, role actions, menus,
commander, browser actions, Wispr, worktrees, host actions, debug/restart, and
unknown actions invoke feedback with exactly `TBD for Herdr` and never receive a
shell session or Workmux command port.

- [ ] **Step 4: Run the focused RED test**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-keyboard-adapter.test.ts
```

Expected: fail because the adapter does not exist.

- [ ] **Step 5: Implement on top of provider-independent keyboard utilities**

Reuse `loadRuntimeShellConfigState()`, `getKeyboardsById()`,
`getActiveKeyboardIds()`, `resolveSelectedKeyboardId()`, `runSlotItem()`, and
the existing modifier/terminal-byte helpers where their contracts do not import
shell ownership. If the step-sequence encoder is still trapped under
`shell-controllers`, move only that pure function to `keyboard-runtime.ts` and
leave a re-export so ordinary shell call sites do not change behavior.

Thread this optional presentation mode through `TerminalKeyboard` and
`buildTerminalKeyboardLongPressPopup()`:

```ts
export type WorkKeyLongPressMode = 'workmux-scoped' | 'configured';

const options =
	workKeyLongPressMode === 'configured'
		? slot.longPress?.options
		: (getWorkKeyLongPressOptions(slot, getNavScope()) ??
			slot.longPress?.options);
```

Default the prop at the shared component boundary so no ordinary shell caller
changes.

The action classifier returns one of these explicit outcomes:

```ts
type HerdrKeyboardAction =
	| { type: 'previous-agent' }
	| { type: 'next-agent' }
	| { type: 'fit' }
	| { type: 'copy-selection' }
	| { type: 'paste-clipboard' }
	| { type: 'keyboard'; actionId: KeyboardTargetActionId | 'ROTATE_KEYBOARD' }
	| { type: 'unsupported'; message: 'TBD for Herdr' };
```

- [ ] **Step 6: Run GREEN and commit**

```bash
git add apps/mobile/src/lib/herdr/keyboard-adapter.ts \
	apps/mobile/test/integration/herdr-keyboard-adapter.test.ts \
	apps/mobile/src/app/shell/components/keyboard-component-props.ts \
	apps/mobile/src/app/shell/components/TerminalKeyboard.tsx \
	apps/mobile/src/app/shell/components/TerminalKeyboardLongPressController.ts \
	apps/mobile/test/integration/terminal-keyboard-component.test.ts \
	apps/mobile/src/lib/keyboard-runtime.ts \
	apps/mobile/src/lib/shell-controllers/keyboard-input-support.ts
git commit -m "Add Herdr keyboard adapter"
```

Only add the last two paths if the pure step helper actually moves. Expected:
the Herdr adapter test and existing keyboard integration tests pass, with the
ordinary shell's scoped Work long-press behavior unchanged.

---

### Task 7: Saved-Host Action and Grouped Agent List Route

**Files:**

- Modify: `apps/mobile/src/app/(tabs)/index.tsx`
- Create: `apps/mobile/src/app/herdr/index.tsx`
- Create: `apps/mobile/src/app/herdr/HerdrAgentListView.tsx`
- Create: `apps/mobile/test/components/herdr-agent-list.test.tsx`
- Create: `apps/mobile/test/components/herdr-saved-host-action.test.tsx`

**Interfaces:**

- Adapts secure storage and `useSshStore` to `prepareHerdrHost()`.
- Publishes successful state to `useHerdrProviderStore` and navigates with only
  `storedConnectionId` and `connectionId` route params.
- Opens terminal routes with `terminalId`; never serializes snapshots or pane
  IDs into route params. The terminal route receives `storedConnectionId`, the
  current `connectionId`, and `terminalId` so it can recover after process or
  SSH reconnection.

- [ ] **Step 1: Write failing saved-host action tests**

Render the connection-actions surface and assert **Open Herdr** appears before
Rename/Delete, closes the modal, shows a bounded loading state, calls the host
launcher with the saved ID, stores only a successful result, and navigates to
`/herdr`. Assert failures remain on the host screen with a retryable message and
do not alter Rename, Delete, Cancel, or row-fill behavior.

- [ ] **Step 2: Write failing agent-list state tests**

Cover `loading`, grouped `ready`, `empty`, and `error`. Assert visible group
labels and order, agent identity/status/cwd/workspace/tab presentation, refresh,
and stable `terminalId` press behavior. A changed pane ID must update row
presentation without losing selection identity.

- [ ] **Step 3: Run focused RED tests**

```bash
pnpm --filter @fressh/mobile exec jest --config jest.config.cjs \
	--runInBand test/components/herdr-agent-list.test.tsx \
	test/components/herdr-saved-host-action.test.tsx
```

Expected: fail because the action and list route do not exist.

- [ ] **Step 4: Implement the Open Herdr action with route-owned progress**

Use the saved row's already-loaded entry when possible, but resolve it again in
the launcher as the source of truth. Adapt native dependencies at the route:

```ts
const host = await prepareHerdrHost({
	storedConnectionId: props.id,
	ports: createNativeHerdrHostPorts({
		getConnections: () => useSshStore.getState().connections,
		connect: useSshStore.getState().connect,
	}),
});
useHerdrProviderStore.getState().setHost(host);
router.push({
	pathname: '/herdr',
	params: {
		storedConnectionId: host.storedConnectionId,
		connectionId: host.connectionId,
	},
});
```

Keep the host-port adapter inside the route or a React-only local helper so the
tested launcher remains native-free.

- [ ] **Step 5: Implement list refresh and reconciliation**

Refresh on first open, explicit Refresh, return focus from terminal, and
foreground while visible. Reuse the current registered connection when present;
otherwise call the same launcher to reconnect from the saved ID. Publish only
successful snapshots. On agent press, route to `/herdr/terminal` with the stable
terminal ID.

- [ ] **Step 6: Run GREEN and commit**

```bash
git add 'apps/mobile/src/app/(tabs)/index.tsx' \
	apps/mobile/src/app/herdr/index.tsx \
	apps/mobile/src/app/herdr/HerdrAgentListView.tsx \
	apps/mobile/test/components/herdr-agent-list.test.tsx \
	apps/mobile/test/components/herdr-saved-host-action.test.tsx
git commit -m "Add Herdr agent list"
```

Expected: focused component tests pass and route params contain no credentials,
snapshot JSON, or pane ID.

---

### Task 8: Herdr Terminal Route and View

**Files:**

- Create: `apps/mobile/src/app/herdr/terminal.tsx`
- Create: `apps/mobile/src/app/herdr/HerdrTerminalView.tsx`
- Create: `apps/mobile/test/components/herdr-terminal-view.test.tsx`
- Create: `apps/mobile/test/components/herdr-terminal-route.test.tsx`

**Interfaces:**

- Adapts the current registered connection to `createHerdrTerminalOwner()`.
- Adapts the owner renderer to `XtermJsWebViewHandle.clear/write` and owner
  input to the keyboard adapter.
- Owns AppState/focus transitions, snapshot refresh, route replacement for Work
  navigation, and terminal error presentation.

- [ ] **Step 1: Write failing terminal-view state tests**

Cover starting, active, releasing, reconnecting/backgrounded, owned elsewhere,
and each error kind. Assert only owned-elsewhere exposes **Take Over**, errors
expose Retry and Back, takeover calls the explicit owner method, and retry
remains non-takeover. The full keyboard stays mounted in active and overlay
states.

- [ ] **Step 2: Write failing xterm adapter tests**

Assert xterm initializes and fits before owner start, the first owner frame
clears/replaces old output, later frames append, xterm input becomes UTF-8
terminal input, selection copy stays local, `onResize` reaches owner resize, and
`onScrollbackBatch` reaches owner scroll with direction and positive lines.

Use `xtermOptions.scrollback: 0` and provider-owned touch scrolling:

```ts
const HERDR_TOUCH_SCROLL_CONFIG = {
	enabled: true,
	pxPerLine: 10,
	slopPx: 10,
	maxLinesPerFrame: 12,
	coalesceMs: 24,
	minFlushMs: 16,
	maxFlushMs: 80,
} as const;
```

Carry over the remaining required `TouchScrollConfig` fields from the existing
provider-owned shell policy rather than changing the xterm package.

- [ ] **Step 3: Write failing Work-switch tests**

Given the provider's flattened list, assert next/previous wraps, current owner
retires with `switch`, its bounded cleanup settles, and only then the route is
replaced with the selected terminal ID. The replacement creates a fresh normal
controller. If the current terminal is missing, refresh by stable terminal ID;
return to the empty/list state when no target remains.

- [ ] **Step 4: Write failing background/foreground route tests**

Dispatch background and assert the route's AppState callback calls
`owner.background()` synchronously. On foreground, refresh/reconnect, reconcile
the same terminal ID despite pane movement, and create a fresh non-takeover
generation. If another controller acquired it, render the ordinary Take Over
choice. If the terminal disappeared, replace the route with the list.

Also open a direct/restored terminal route with an empty in-memory provider
store. Assert it reloads the host and snapshot from `storedConnectionId`,
reconciles the requested `terminalId`, and starts only if that stable target is
still present; otherwise it replaces the route with the refreshed list.

- [ ] **Step 5: Run focused RED tests**

```bash
pnpm --filter @fressh/mobile exec jest --config jest.config.cjs \
	--runInBand test/components/herdr-terminal-view.test.tsx \
	test/components/herdr-terminal-route.test.tsx
```

Expected: fail because the terminal route and view do not exist.

- [ ] **Step 6: Implement one owner per selected route target**

Keep `terminalId` as local route identity and look up current presentation in
the latest provider snapshot. Build renderer ports as:

```ts
const renderer = {
	replace(bytes: Uint8Array) {
		xtermRef.current?.clear();
		xtermRef.current?.write(bytes);
	},
	append(bytes: Uint8Array) {
		xtermRef.current?.write(bytes);
	},
};
```

Wait for both `onInitialized` and the first positive `onResize` before start.
Subscribe owner state with cleanup on target change/unmount. Back and unmount
retire only the Herdr owner; never disconnect the SSH connection. Await bounded
retirement before explicit Back or Work navigation; unmount starts the same
idempotent cleanup without assuming React will await it.

- [ ] **Step 7: Wire the existing keyboard and local feedback**

Load runtime config once, pass the selected definition to `TerminalKeyboard`,
and connect its slot callback to the Herdr adapter. Show unsupported actions
through a small alert/toast with exactly `TBD for Herdr`. Keep selection mode,
clipboard copy, system keyboard focus, and fit local to xterm.

- [ ] **Step 8: Run GREEN and commit**

```bash
git add apps/mobile/src/app/herdr/terminal.tsx \
	apps/mobile/src/app/herdr/HerdrTerminalView.tsx \
	apps/mobile/test/components/herdr-terminal-view.test.tsx \
	apps/mobile/test/components/herdr-terminal-route.test.tsx
git commit -m "Add Herdr terminal route"
```

Expected: terminal component tests pass and no new import from
`src/lib/shell-controllers/session` or `ShellDetail` exists under the Herdr
routes.

---

### Task 9: Regression Gates and Real-Device Acceptance

**Files:**

- Create: `docs/run/herdr-support-poc-evidence.md`
- Modify only previously listed implementation files if verification exposes a
  defect.
- Do not add a fake Maestro flow that requires a Herdr host unavailable to CI.

**Interfaces:**

- Verifies the complete POC contract, ordinary shell isolation, formatting, and
  Android behavior against a real Herdr 0.7.2-or-newer host.

- [ ] **Step 1: Run all focused Herdr integration tests**

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/herdr-*.test.ts
```

Expected: snapshot, provider, launcher, codec, owner, and keyboard tests pass.

- [ ] **Step 2: Run all focused Herdr component tests**

```bash
pnpm --filter @fressh/mobile exec jest --config jest.config.cjs \
	--runInBand test/components/herdr-*.test.tsx
```

Expected: saved action, list, terminal view, and terminal route tests pass.

- [ ] **Step 3: Run ordinary-shell regression lanes**

```bash
pnpm --filter @fressh/mobile test:integration
pnpm --filter @fressh/mobile test:components
```

Expected: all existing integration and component tests pass with unchanged
ordinary shell, Workmux, keyboard, reconnect, selection, and scroll behavior.

- [ ] **Step 4: Run static gates**

```bash
pnpm --filter @fressh/mobile fmt:check
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 5: Build or publish through the approved Android preview lane**

If native dependencies did not change, use preview OTA:

```bash
cd apps/mobile
pnpm exec eas update --channel preview \
	--message "Add Herdr support POC"
```

If the installed preview runtime cannot load the change, use the documented
local preview build without uninstalling or clearing app data:

```bash
cd apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk \
	ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
	EAS_SKIP_AUTO_FINGERPRINT=1 \
	pnpm exec eas build --local --profile preview --platform android
```

- [ ] **Step 6: Run the real-device acceptance matrix**

On a device connected to a saved SSH host running Herdr 0.7.2 or newer, verify:

1. **Open Herdr** reuses an already active SSH connection and opens without
   creating an ordinary shell.
2. A disconnected saved host reconnects with its stored key and lists the
   default session's grouped agents.
3. A pane moved between workspaces keeps the same selected terminal by
   `terminal_id` after refresh.
4. Initial full frame and later deltas display correctly; typing, raw keys,
   macros, paste, selection copy, resize, and touch scroll work.
5. Work and its Previous/Next long-press actions switch agents with wraparound.
6. A shell-specific action shows exactly `TBD for Herdr` and has no remote side
   effect.
7. A second controller produces **Take Over**; it is not taken until pressed.
8. Back and agent switching release control without disconnecting SSH.
9. Background immediately releases native ownership; foreground refreshes and
   reacquires the same terminal ID without takeover.
10. Killing or moving the target returns to a recoverable list/error state and
    never applies stale partial frames.

- [ ] **Step 7: Record evidence, review diagnostics, and commit**

Inspect logs for IDs, states, generations, sequence metadata, and bounded reason
classes only. Confirm there are no terminal payloads, typed input, private keys,
raw snapshots, or raw stderr. Record exact command outputs, commit SHAs,
device/build identity, Herdr version, host alias without credentials, and the
ten acceptance results in `docs/run/herdr-support-poc-evidence.md`.

Commit the evidence and any verification fixes:

```bash
git add apps/mobile docs/run/herdr-support-poc-evidence.md
git commit -m "Verify Herdr support POC"
```

Expected: the final task always ends with a non-empty evidence commit and the
same results can be copied into the pull request testing notes.
