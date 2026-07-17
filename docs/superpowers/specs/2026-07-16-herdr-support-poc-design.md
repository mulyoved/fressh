# Herdr Support POC Design

**Issue:** [#143 — Herdr support](https://github.com/mulyoved/fressh/issues/143)

**Date:** 2026-07-16

**Status:** Approved design

## Purpose

Add Herdr as a separate terminal provider in the Fressh mobile app. A user can
open a saved SSH host, discover agents in that host's default Herdr session,
open one agent's live terminal, interact through the existing renderer and
keyboard, scroll the Herdr terminal, and switch directly to another agent.

The POC validates the complete Android path without adding a daemon, changing
Herdr, changing the Rust SSH implementation, or replacing xterm.js.

## Approved Product Decisions

- Add **Open Herdr** to each saved host's actions.
- Reuse a matching active SSH connection or connect automatically with the saved
  host's credentials. Do not start an ordinary shell just to open Herdr.
- Use Herdr's default session only.
- Defer named-session discovery, session names, latest-session presentation, and
  Collie-style multi-session switching.
- Try normal terminal control first. If another client owns the terminal, show
  an explicit **Take Over** action that retries with `--takeover`.
- Keep the complete configured Fressh keyboard visible.
- Support ordinary terminal input, byte/text macros, selection copying, terminal
  fitting, and touch scrolling.
- Show the exact user-facing message **TBD for Herdr** when an unsupported
  shell-specific action is pressed. This phrase is intentional UI copy, not an
  unfinished requirement.
- Remap the **Work** key on a Herdr terminal to the next agent in the displayed
  agent-list order. Wrap from the last agent to the first.
- Remap the Work key's long-press Previous and Next actions to the preceding and
  following agents. Other Workmux scope actions show **TBD for Herdr**.
- Release Herdr terminal control while the app is backgrounded by immediately
  starting native command-stream closure, then automatically reacquire the same
  agent when the app returns to the foreground.

## External Protocol Baseline

The design is based on the current Herdr 0.7.2-or-newer interfaces documented
and implemented by Herdr:

- [`herdr api snapshot`](https://herdr.dev/docs/socket-api/) prints a one-shot
  JSON `session.snapshot` response.
- `herdr terminal session control <target>` emits newline-delimited
  `terminal.frame` records and accepts newline-delimited control commands on
  stdin.
- The terminal command accepts the snapshot's stable `terminal_id` as its
  target. Public pane IDs describe mutable layout placement and are not used as
  Fressh route or controller identity.
- Control commands include `terminal.input`, `terminal.resize`,
  `terminal.scroll`, and `terminal.release`.
- Only one controller may own a terminal at a time. `--takeover` explicitly
  replaces the current controller.
- [`AltanS/collie`](https://github.com/AltanS/collie) is a reference for future
  multi-session discovery and mobile agent presentation, not an implementation
  dependency for this POC.

Fressh probes capabilities rather than trusting only a parsed version string.
The availability flow verifies that `herdr` exists, that snapshot loading works,
and that the terminal-session command is supported. The UI still reports Herdr
0.7.2 or newer as the user-facing minimum.

## Architecture

Herdr is a separate provider with dedicated agent-list and terminal-detail
routes. It reuses existing presentation and transport primitives without routing
Herdr through the ordinary `ShellDetail` controller graph.

```text
saved host action
    -> Herdr host launcher
    -> existing registered SSH connection
    -> Herdr snapshot adapter
    -> Herdr agent-list route
    -> Herdr terminal route
    -> Herdr terminal owner
    -> SSH command stream
    -> herdr terminal session control
```

The SSH registry remains the sole owner of live SSH connections. A Herdr screen
never disconnects a store-owned SSH connection during ordinary route cleanup.

The Herdr terminal owner owns exactly one command stream and its controller
lease. It releases and closes that stream on back navigation, agent switching,
retry, terminal failure, or unmount. On backgrounding it starts the existing
native stream close immediately; controller release must not depend on a later
JavaScript timer or promise continuation.

The POC may reuse these existing pieces directly:

- `SshConnection.runCommand()` and `startCommandStream()`.
- `XtermJsWebView` and its imperative handle.
- `TerminalKeyboard` and the runtime keyboard configuration.
- Existing theme, selection, terminal-fit, shell-quoting, and terminal-byte
  encoding primitives where their contracts are provider-independent.

It must not make the recently stabilized ordinary shell controllers understand
Herdr. Shared code is extracted only when it is already provider-independent and
both consumers have the same contract.

## Components and Boundaries

### Herdr host launcher

The launcher accepts a saved connection ID.

1. Resolve the saved connection and its key material through the existing
   secure-storage path.
2. Search the SSH registry for a live connection whose stored connection ID
   matches.
3. Reuse that connection when present; otherwise connect through the existing
   SSH store without calling `startShell()`.
4. Run the Herdr capability and snapshot probe.
5. Navigate to the Herdr agent list with the active connection ID and saved
   connection ID.

The saved connection ID remains available for explicit reconnect attempts after
an SSH disconnect.

### Snapshot adapter

The snapshot adapter is the only discovery component that knows the remote
snapshot command and raw Herdr snapshot shape. It:

- Runs `herdr api snapshot` with a bounded one-shot command.
- Requires a successful exit status.
- Parses JSON once and validates only the fields Fressh consumes.
- Accepts additional unknown fields.
- Maps unknown or missing status values to `unknown`.
- Requires each listed agent's `terminal_id` and uses it as the stable route,
  row, navigation, and terminal-control target.
- Retains public pane ID, workspace, tab, agent, status, optional pane label,
  optional terminal label, and safe working-directory basename as presentation
  and ordering data only.
- Produces the ordered agent array used by both the list and Work-key cycling.

Agents are grouped and ordered as follows:

1. `blocked` — Needs attention
2. `done` — Ready
3. `working` — Working
4. `idle` — Idle
5. `unknown` — Unknown

Within a status group, preserve the snapshot's stable workspace/tab/pane order.
The flattened displayed order is the navigation order.

Snapshot refresh reconciles rows and the selected route by `terminal_id`. If a
pane moves, its row presentation and position may change while the selected
terminal remains the same. A target has disappeared only when that terminal ID
is no longer present in the refreshed agent set.

The latest successful snapshot is kept only in memory for the active Herdr host.
There is no durable agent or terminal cache.

### Protocol codec

The protocol codec owns all wire representations:

- Shell-safe construction of the terminal control command.
- Incremental UTF-8 decoding across arbitrary stdout chunks.
- Incremental newline framing across arbitrary chunks.
- A 4 MiB maximum incomplete NDJSON line.
- JSON classification and validation for known terminal records.
- Strict Base64 decoding for ANSI terminal bytes.
- Exact newline-terminated input, resize, scroll, and release records.

The codec is pure and contains no React, navigation, SSH lifecycle, or xterm
logic.

### Herdr terminal owner

The terminal owner is a provider-specific lifecycle object. It owns:

- A monotonically increasing generation.
- Stream startup and the ten-second first-frame deadline.
- Stdout decoding and a bounded 16 KiB sanitized stderr tail.
- Full-frame baseline validation, contiguous frame sequencing, and ordered
  renderer delivery.
- A serialized outbound command queue.
- Resize coalescing.
- Scroll command emission.
- Controller-conflict classification and takeover restart.
- Immediate native background close and foreground reacquisition.
- Idempotent release and close.
- Suppression of events and writes from retired generations.

The owner exposes narrow ports for rendering and input. Views never call the
native SSH API directly.

### Herdr keyboard adapter

The adapter receives the existing keyboard definition and classifies each
action:

- Terminal text, raw bytes, special keys, and macros use `terminal.input`.
- Selection copy remains local to xterm.
- Terminal fit remains local and causes the resulting Herdr resize.
- Work/Previous/Next request agent navigation.
- Unsupported actions invoke the **TBD for Herdr** feedback callback.

The adapter does not receive an ordinary Shell session, Workmux port, tmux
copy-mode owner, or host-command controller. This prevents an unsupported key
from silently targeting the wrong session.

### Routes and views

The provider has two views:

- **Agent list:** availability, loading, grouped agents, empty state, manual
  refresh, and errors.
- **Terminal detail:** xterm, current agent identity, existing keyboard,
  reconnect overlay, takeover prompt, and terminal errors.

Routes carry the stable Herdr `terminal_id`, not pane IDs, serialized snapshots,
or credentials. The latest in-memory provider snapshot supplies current
presentation and Work-key navigation. A direct or restored terminal route
refreshes the snapshot if that navigation state is missing.

## User Flows

### Open Herdr

1. The user opens a saved host's actions and selects **Open Herdr**.
2. Fressh reuses or establishes the SSH connection.
3. Fressh checks Herdr availability and loads the default-session snapshot.
4. Fressh shows the grouped agent list.

The list refreshes when first opened, on manual Refresh, when returning from an
agent terminal, and when the app returns to the foreground while the list is
visible.

### Open an agent

1. The user selects an agent row.
2. The terminal route fits xterm to obtain initial columns and rows.
3. The owner starts normal control without takeover.
4. The first valid `full: true` frame establishes the renderer baseline,
   replaces the loading state, and is written to xterm.
5. Later contiguous frames, input, resize, and scroll remain ordered through the
   owner.

### Controller already owned

1. Normal control reports that the target is controlled elsewhere.
2. Fressh closes the failed stream and shows **Take Over** and Back actions.
3. **Take Over** starts a fresh generation with `--takeover`.
4. No takeover happens without this explicit user action.

### Switch agents with Work

1. Resolve the current target in the flattened displayed order.
2. Select the next or previous terminal ID, wrapping at either end.
3. Retire the current generation and complete its release/close sequence.
4. Navigate to or replace the terminal target with the selected agent.
5. Start a fresh non-takeover controller for the new target.

If the target set is stale, refresh the snapshot and reconcile by terminal ID.
If the selected terminal is no longer in the agent set and no replacement
exists, return to the list's empty state.

### Background and foreground

1. On background, stop admitting input and retire the current stream.
2. In that same AppState callback, invoke the existing native
   `SshCommandStream.close()` directly, without scheduling it in a timer or
   promise continuation and without awaiting a release send. The native close
   owns its own bounded teardown and may continue while JavaScript is suspended.
3. A `terminal.release` send started in the same cleanup turn is best-effort
   only; native stream closure is the ownership-release guarantee.
4. Keep the route's selected terminal ID as local UI state only.
5. On foreground, refresh the snapshot, reconcile that terminal ID to its
   current pane metadata, and reacquire it automatically.
6. If the terminal is no longer in the agent set, return to the refreshed list.
7. If another controller acquired it, show the normal **Take Over** choice.

## Terminal Protocol and Data Flow

### Stream startup

Normal control uses the shell-quoted stable terminal ID from the snapshot:

```text
herdr terminal session control '<terminal_id>' --cols <cols> --rows <rows>
```

Takeover uses the same command with `--takeover`. Numeric dimensions are
validated positive integers before command construction.

### Frames

Known stdout frames have this shape:

```json
{
	"type": "terminal.frame",
	"seq": 1,
	"encoding": "ansi",
	"width": 120,
	"height": 40,
	"full": true,
	"bytes": "...base64..."
}
```

The first accepted terminal frame in every generation must be a valid
`full: true` ANSI frame with a positive sequence number. It establishes xterm's
rendering baseline and the owner's last accepted sequence number. The owner then
accepts only the next sequence number and writes its decoded bytes to xterm in
stream order. Duplicate or older frames are ignored because their effects were
already applied. A forward sequence gap fails the generation; later partial
frames must never be applied to an incomplete baseline.

A malformed NDJSON record, a malformed known terminal record, or invalid Base64
in `terminal.frame` also fails the generation because the owner cannot prove
that a required delta was not lost. An oversized incomplete line fails the
generation to prevent unbounded memory use. Unknown but well-formed record types
are ignored. `terminal.closed` retires the stream and surfaces its sanitized
reason when it was not caused by expected cleanup.

On any frame-integrity failure, the owner stops renderer delivery, retires and
releases/closes the current stream, and presents a recoverable terminal
synchronization error. Retry creates a fresh generation without takeover. No
rendering resumes until that generation supplies its initial `full: true` frame,
which replaces the invalid baseline. A stream that never supplies that frame
fails after ten seconds.

### Input

All terminal input is encoded as bytes so control sequences and UTF-8 text share
one path:

```json
{ "type": "terminal.input", "bytes": "...base64..." }
```

Every record ends with exactly one newline. The outbound queue preserves byte
order across typing, macros, and special keys. Input is rejected once release
begins.

### Resize

Xterm resize events are coalesced for 100 ms and encoded as:

```json
{
	"type": "terminal.resize",
	"cols": 100,
	"rows": 30,
	"cell_width_px": 0,
	"cell_height_px": 0
}
```

Only the latest pending size is sent. Columns and rows must be greater than
zero. Pixel dimensions remain zero until the existing renderer exposes reliable
cell measurements.

### Touch scrolling

Fressh's existing touch-scroll batching supplies direction and line count. The
Herdr adapter emits:

```json
{
	"type": "terminal.scroll",
	"direction": "up",
	"lines": 3,
	"source": "wheel"
}
```

The adapter clamps batches to a positive `u16` line count and preserves their
order relative to input and resize. Herdr remains the source of truth for the
displayed viewport; Fressh does not substitute local-only xterm scrolling.

### Release

Graceful cleanup may enqueue exactly one record:

```json
{ "type": "terminal.release" }
```

The queue stops admitting new work first. For back, switch, retry, failure, and
unmount cleanup, stream close follows the release attempt with a bounded
best-effort wait. Close still runs if release cannot be delivered.

Background cleanup is stricter: it invokes native stream close immediately and
never gates that invocation on the release send or a JavaScript timeout. The
release record is optional best-effort notification in this path; SSH channel
closure is sufficient for Herdr to remove the controller. The owner does not
await the returned close promise to advance lifecycle state; it records the
eventual result when JavaScript can process it. JavaScript suspension therefore
cannot postpone the already-started native close operation.

## State and Ownership Rules

The agent-list states are `loading`, `ready`, `empty`, and `error`.

The terminal states are:

- `starting`
- `active`
- `owned-elsewhere`
- `backgrounded`
- `releasing`
- `error`

Only the current generation may publish state, deliver a frame, or enqueue a
command. Retired generations may finish required cleanup but cannot change the
visible route. Takeover and foreground reacquisition always create a new
generation.

Terminal identity is the Herdr `terminal_id`. Pane ID, workspace, and tab are
mutable placement metadata. They never decide whether a foreground refresh is
reacquiring the same terminal.

The SSH connection and Herdr controller have deliberately different lifetimes:

- The SSH registry owns the connection across screens.
- The terminal owner owns the controller only while its terminal is active in
  the foreground.

## Error Handling

User-facing errors are classified rather than presented as raw process output:

- **Herdr not installed:** explain that the selected host does not have Herdr.
- **Unsupported Herdr:** require Herdr 0.7.2 or a compatible newer terminal
  session interface.
- **Herdr server unavailable:** explain that Herdr must be running on the host.
- **Snapshot failed or invalid:** show Retry and the sanitized failure summary.
- **No agents:** show an empty list with Refresh.
- **Target disappeared:** refresh and return to the list.
- **Owned elsewhere:** show **Take Over** and Back.
- **First-frame timeout:** close the stream, show sanitized stderr when useful,
  and offer Retry.
- **SSH disconnected:** retire the stream and offer reconnect through the saved
  host. A successful reconnect reloads the snapshot before reopening a target.
- **Unexpected exit or close:** show the sanitized reason and offer Retry or
  Back to Agents.
- **Frame synchronization lost:** for a malformed record, invalid frame payload,
  forward sequence gap, or oversized stream, retire and release/close the
  current generation, stop rendering partial frames, and offer Retry. The new
  generation must begin with a full frame before rendering resumes.

There is no indefinite hidden retry loop. Foreground reacquisition is the only
automatic terminal retry. All other retries are explicit user actions.

## Diagnostics and Privacy

POC diagnostics record:

- Saved host ID and active SSH connection ID.
- Herdr terminal ID and terminal generation. Pane IDs may be recorded only as
  non-identity presentation metadata.
- Snapshot duration and agent count.
- Command-stream start and stop.
- Time to first frame.
- Frame count and decoded byte count.
- Invalid record count, synchronization-failure kind, and last accepted sequence
  number.
- Resize and scroll command counts.
- Takeover requests.
- Background, foreground, switch, back, error, and unmount cleanup reasons.
- Background native-close requested and eventual completion/failure.
- Exit status, exit signal, and sanitized stderr length/message.

Diagnostics never record:

- Passwords, private keys, or other credentials.
- Keyboard input or encoded input payloads.
- Terminal frame bytes or decoded terminal content.
- Full working-directory paths.
- Raw snapshots.

Shell targets are always quoted with the existing tested shell-quoting helper.
Stream buffers, one-shot output, stderr, and log fields remain bounded.

## Testing

### Unit tests

#### Snapshot mapping

- Multiple workspaces, tabs, panes, and agents.
- Required stable terminal IDs and public pane IDs as presentation metadata.
- The same terminal ID after a cross-workspace pane move updates presentation
  without changing route or controller identity.
- Stable order within status groups.
- Missing labels and working directories.
- Unknown or missing status.
- Pane-linked agents.
- No agents.
- Unknown additional fields.
- Malformed required fields.

#### NDJSON and UTF-8

- One record in one chunk.
- One record split across chunks.
- Multiple records in one chunk.
- Empty lines and CRLF.
- UTF-8 split across chunks.
- Malformed JSON is reported as a fatal protocol error.
- Oversized incomplete line.
- Final line without a newline at process exit.

#### Protocol codecs

- Valid and invalid Base64 ANSI frames.
- Empty frames.
- Required initial full frame.
- Duplicate and older sequence numbers are ignored.
- Forward sequence gaps fail the generation.
- Exact input, resize, scroll, and release JSON.
- Exactly one trailing newline per command.
- Positive dimension and line-count validation.
- Normal and takeover command construction with a terminal-ID target.
- Shell quoting for spaces, quotes, and metacharacters.

#### Navigation

- Status-group ordering.
- Next and previous agent.
- Wrap in both directions.
- Current terminal preserved after its pane ID and placement change.
- Current terminal missing from the refreshed agent set.
- One-agent list.

### Fake-stream integration tests

The fake SSH command stream can emit stdout chunks, stderr chunks, exit status,
exit signal, and close events; capture stdin; delay startup and sends; and
simulate close failures.

Verify:

- First valid full frame reaches xterm.
- A partial first frame retires the generation without reaching xterm.
- Multiple frames retain order.
- Text and every required special key become exact input bytes.
- Resize coalescing sends only the latest size.
- Finger-drag batches become ordered Herdr scroll commands.
- Back, switch, retry, failure, and unmount attempt release at most once.
- Their close follows a failed or timed-out release.
- Background retirement invokes native close immediately even when the release
  send and its promise never settle and JavaScript timers do not advance.
- The native close request occurs before the AppState callback returns.
- Background release is best-effort and cannot delay or cancel native close.
- No writes are accepted after retirement.
- Late frames and failures from old generations are ignored.
- Controller conflict exposes takeover without taking over automatically.
- Explicit takeover starts a new `--takeover` generation.
- Foreground reacquires the same terminal ID after its pane placement changes.
- Missing foreground target returns to the refreshed list.
- First-frame timeout closes the stream.
- Unknown well-formed records are ignored.
- Malformed JSON, malformed frame payloads, invalid frame Base64, and forward
  sequence gaps retire the generation without crashing the app.
- No partial frame reaches xterm after synchronization is lost.
- Explicit Retry starts a fresh non-takeover generation, and rendering resumes
  only after its initial full frame.

### Component tests

- Saved-host action and connection reuse/connect states.
- Herdr availability errors.
- Grouped agent-list rendering and Refresh.
- Stable terminal-ID route selection across pane placement changes.
- Empty and malformed-snapshot states.
- Agent selection and Back to Agents.
- Take Over and Retry actions.
- Full keyboard rendering.
- Work-key next/previous behavior.
- Unsupported action **TBD for Herdr** feedback.
- Background and foreground presentation.

### Regression tests

- Ordinary saved-host Connect still starts the configured SSH/tmux shell.
- Existing Shells list and `ShellDetail` behavior remain unchanged.
- Existing keyboard actions retain their ordinary-shell behavior.
- SSH connection ownership and disconnect behavior remain unchanged.

### Real-device acceptance

Use the repository's local Android `preview` build lane and a real device with a
saved Fressh host, Herdr 0.7.2 or newer, and at least two agents.

Verify:

1. Open Herdr from a saved host.
2. Confirm workspace, agent, and status presentation.
3. Open a Codex terminal and render its current screen.
4. Confirm colors, cursor motion, clearing, and full-screen redraws.
5. Send text, Enter, Escape, Tab, arrows, and Ctrl+C.
6. Run a byte/text macro.
7. Finger-scroll up and down through Herdr's viewport.
8. Rotate the device and open/close the soft keyboard.
9. Use Work, Previous, and Next to switch agents and wrap.
10. Trigger an unsupported action and confirm **TBD for Herdr**.
11. Background and foreground the app and confirm automatic reacquisition.
    Confirm another client can control the terminal while Fressh remains
    backgrounded without requiring takeover from a stale Fressh stream.
12. Exercise controller conflict and explicit takeover.
13. Disconnect SSH and use explicit reconnect.
14. Return to the list and manually refresh.
15. Open an ordinary SSH shell and confirm unchanged behavior.

## Included Scope

- Saved-host Herdr entry and automatic SSH connection.
- Default-session availability and snapshot discovery.
- Grouped agent list and statuses.
- Manual and foreground list refresh.
- One selected live terminal at a time.
- Existing xterm renderer and configured keyboard.
- Terminal input, resize, Herdr scrolling, release, and explicit takeover.
- Work-key agent cycling.
- Native background close and terminal-ID foreground reacquisition.
- Basic typed errors, diagnostics, automated tests, and real-device acceptance.

## Explicit Non-Goals

- Named Herdr session discovery or switching.
- Latest-session or recently-used-session UI.
- Multi-host merged dashboards.
- Collie, a Fressh relay, a daemon, HTTP, WebSockets, or public endpoints.
- Raw Herdr socket integration.
- Live agent-list subscriptions or background monitoring.
- Push notifications.
- Multiple simultaneous terminal controllers or visible terminals.
- Durable agent or terminal caching.
- Persistent complete Codex history.
- Structured Codex messages, approvals, tool calls, or file diffs.
- Starting, stopping, or creating agents, workspaces, or Herdr sessions.
- Production-grade compatibility across older Herdr versions.
- Changes to Herdr, the Rust SSH implementation, or the terminal renderer.
- Adapting Workmux, tmux copy mode, browser actions, workspace actions, Wispr,
  or other ordinary-shell workflows to Herdr in this POC.

## Acceptance Criteria

The POC is complete when, on a real Android device:

- A saved host can open its default Herdr session without starting an ordinary
  shell.
- Agents show their workspace and status in the approved order.
- Selecting a Codex agent displays and controls its current terminal faithfully.
- Required text and special-key input works through the existing keyboard.
- Finger dragging scrolls the Herdr-owned terminal viewport.
- Rotation and terminal resizing update Herdr.
- Work, Previous, and Next switch agents in list order with wraparound.
- Unsupported shell-specific actions show **TBD for Herdr**.
- Controller conflict requires explicit takeover.
- Back, switching, backgrounding, failure, and unmount release the controller;
  background closure does not depend on JavaScript timers.
- Foreground automatically reacquires the selected terminal when it still
  exists, even if its pane placement changed.
- SSH disconnect, missing target, missing Herdr, malformed records, and stream
  failure are recoverable and do not crash the app.
- Existing ordinary SSH behavior and tests remain unchanged.
