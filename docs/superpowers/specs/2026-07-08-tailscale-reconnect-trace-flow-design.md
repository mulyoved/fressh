# Tailscale Reconnect Trace and Flow Design

## Context

The reproduced failure shows that the current reconnect path can leave Fressh in
a dead terminal state:

- Tailscale disconnects while a tmux-backed shell is active.
- Fressh shows `Reconnecting...`.
- The active-shell reopen path retries the stale SSH connection until timeout.
- Manual Tailscale reconnect clears the Android VPN problem, but Fressh does not
  restore a clean shell/bridge state.
- Pressing the Workmux `Work` key surfaces `Workmux action failed` with
  `mdev bridge stream closed.`

The product assumption should be changed: tmux is the durable session boundary.
SSH connections, shell handles, and mdev bridge streams are disposable
transport.

## Goals

- Reconnect by replacing stale SSH transport and reattaching tmux.
- Avoid preserving or repeatedly retrying a stale active SSH connection for the
  normal tmux workflow.
- Produce full forensic traces for reconnect, Tailscale recovery, saved-entry
  reconnect, shell/channel navigation, and mdev bridge lifecycle.
- On failure, route users to the host page and expose actionable recovery UI
  instead of leaving them on a dead terminal.
- Prevent stale bridge closures caused by reconnect disposal from surfacing as
  raw user-facing Workmux errors.

## Non-Goals

- Rewrite every connection subsystem into one global state machine in this
  iteration.
- Remove support for non-tmux connections.
- Change Tailscale's native app behavior or require new Tailscale permissions.
- Clear app data or alter saved host/key storage.

## Architecture

Reconnect should use tmux as the durability boundary and treat SSH, shell, and
mdev bridge state as replaceable transport.

When a shell drops or the shell route detects `connection && !shell`, reconnect
should not repeatedly try to reopen a shell on the old active connection.
Instead:

1. Mark reconnect as active and start a forensic diagnostic trace.
2. Dispose or invalidate current shell-side transport state: active shell handle,
   mdev bridge client/control channel, and pending bridge-backed actions.
3. Run Tailscale readiness and recovery before reconnecting, with trace events.
4. Reconnect through the saved entry that belongs to the dropped connection,
   resolved from the dropped connection's stored connection id. Fall back to
   the latest saved entry only when no stored entry can be resolved. This
   resolution must not filter by `autoConnect`; that flag gates launch
   auto-connect, not recovery of an existing session.
5. Attach to the configured tmux session.
6. Navigate to the new shell/channel on success.
7. On failure or timeout, stop reconnect and navigate to the host page with
   connection/Tailscale recovery state visible.

The old active-connection path can remain only as a non-tmux or explicitly
classified fallback. The normal tmux reconnect path should prefer saved-entry
reconnect because the active SSH transport is the suspect component.

Transport invalidation crosses the React boundary: the mdev bridge client and
Workmux control channel are owned by the shell route (memoized on connection
object identity), while reconnect logic runs outside React. Step 2 therefore
needs an explicit mechanism — a transport registry that reconnect logic can
dispose through, or a reconnect-state subscription in the shell route that
performs the disposal — not an incidental remount. The old SSH connection
object must also be explicitly disconnected and removed from the connection
store when saved-entry reconnect begins, so it cannot linger as an "active"
connection on the host page or be re-selected by the fallback path.

## Trace Contract

Reconnect tracing should be full forensic tracing, not compact success/failure
logging. The trace must explain what failed, what was disposed, what recovery
was attempted, and why the user landed where they landed.

Required event coverage:

- `reconnect.started`: reason, route, visible connection/channel, tmux enabled,
  tmux session, and shell-drop recovery flag.
- `reconnect.shell-dropped`: emitted when an existing shell or connection drops
  while the route is active, with a network-disappeared classification when
  detectable.
- `reconnect.transport.invalidated`: old connection id, old channel id, whether
  shell existed, whether bridge/control channel was disposed, and whether a
  bridge request was in flight (the bridge client holds at most one pending
  request).
- `tailscale.ensure-ready.result`: always emitted before saved-entry reconnect on
  Android, including when Tailscale is already ready.
- `tailscale.recovery.result`: emitted whenever recovery is attempted or skipped,
  with skip reason.
- `auto-connect.saved-entry.connect.started` (existing catalog kind, extended):
  entry id, host, port, tmux session, and trigger `reconnect`.
- `auto-connect.saved-entry.connect.connected` (existing kind): connection id,
  channel id, tmux session.
- `auto-connect.saved-entry.connect.failed` (existing kind, extended): failure
  class, error summary, and tmux attach failure reason when present.
- `mdev-bridge.lifecycle`: one event kind with a `stage` field covering stream
  starting, hello complete, request started, request failed, stream closed, and
  client disposed. The stream-closed stage carries the classification fields
  listed in Bridge Handling. This requires adding an `mdev-bridge` source to
  the diagnostics source union.
- `reconnect.completed`: final classified outcome (`connected`,
  `needsAttention`, `timeout`, `aborted`, or a failure class) plus a separate
  destination field (`terminal` or `hostPage`) — the outcome and where the
  user landed are independent facts and must not share one enum value.
- `reconnect.stale-input`: terminal input arrived after the reconnect UI
  cleared but no live shell was attached; this is the key dead-terminal
  signal.
- `reconnect.ui.transition`: terminal overlay shown/hidden, host-page recovery
  panel marked, and route changed.

Saved-entry events reuse and extend the existing
`auto-connect.saved-entry.connect.*` catalog kinds; do not introduce parallel
event names for the same lifecycle.

Reconnect attempt results should no longer be boolean-only at the controller
boundary. They should carry a classified outcome that extends the existing
`ConnectionAttemptOutcome` union in `connection-attempt-lifecycle` (which
already distinguishes connected, tmux-attach-failed, blocked, failed, aborted,
timed-out, and cleanup-failed) rather than introducing a parallel enum. The
reconnect-level classification adds:

- `needsAttention`: Tailscale readiness/recovery blocked the attempt.
- `failedNetwork` vs `failedAuth`: split using the existing network-like SSH
  error classifier.

Stale-bridge is not a reconnect outcome; it is a bridge request classification
and is covered in Bridge Handling.

### Trace Retrieval

Forensic traces are only useful if they can be retrieved after the failure.
The recorder currently keeps traces in memory only (bounded history with no
consumer, lost on restart), and the existing debug command runs a new probe
instead of exporting the trace that just recorded the failure. This design
requires an export path for already-recorded reconnect traces: surface the
recorded trace history through the debug connection command (and/or an
ADB-accessible dump) so the trace of a failed reconnect can be collected
without reproducing the failure.

## UX Flow

On shell drop or stale shell detection, the terminal route may briefly show
`Reconnecting...` while stale transport is disposed, Tailscale is checked, and
saved-entry tmux reconnect is attempted.

Success path:

1. User remains on the terminal route.
2. Old shell/bridge transport is replaced.
3. Fressh navigates to the fresh shell/channel.
4. Workmux controls use a new mdev bridge stream.
5. No raw stale bridge error appears.

Failure path:

1. Stop reconnect cleanly.
2. Navigate to the host page.
3. Show the existing Tailscale recovery panel when the failure is
   network/Tailscale-related.
4. For non-Tailscale failures, show the host card as disconnected or failed with
   a concise reason.
5. Retry on the host page starts the same disposable-transport reconnect path.
6. Reset remains Tailscale-specific: it stops reconnect, resets Tailscale, then
   retries reconnect.

The terminal route must not land in a state where reconnecting disappears while
terminal input or Workmux controls remain wired to stale shell/bridge state.

## Bridge Handling

The mdev bridge client should become observable and disposable during reconnect.

Behavior requirements:

- When reconnect starts, invalidate any Workmux control channel or mdev bridge
  client tied to the old transport.
- Pending bridge requests resolve with a structured, classified stale-transport
  result at the result boundary — callers branch on the classification field,
  not on error-string matching — instead of a generic raw
  `mdev bridge stream closed`.
- Raw-dialog suppression is driven primarily by classification: a result
  classified as disposed-by-reconnect is never user-facing, regardless of when
  it surfaces (a disposed client can resolve a pending request after reconnect
  has already ended). Suppressing while reconnect is active is a secondary
  guard, not the mechanism.
- After saved-entry reconnect succeeds, bridge usage creates a fresh stream
  against the new SSH connection/channel.
- If a bridge stream closes after hello, trace it as
  `mdev-bridge.stream.closed` with operation in flight, request id, hello
  completion, disposed-vs-remote-closed classification, and timeout context.
- If the stream closes because reconnect disposed it, this is not a user-facing
  failure.
- If the stream closes outside reconnect, keep a user-facing failure, but include
  trace context to diagnose remote mdev exit, SSH transport close, timeout, or
  protocol failure.

## Testing

Use layered automated tests plus the manual E2E runbook.

Automated coverage should include:

- Reconnect controller returns classified outcomes, not only boolean
  success/failure.
- Tmux reconnect path skips active-shell preservation and uses saved-entry
  reconnect.
- Saved-entry reconnect targets the dropped connection's stored entry, not the
  most recently modified `autoConnect` entry, and does not filter recovery by
  the `autoConnect` flag.
- Tailscale readiness is traced before saved-entry reconnect on Android.
- Tailscale recovery failures mark host-page needs-attention and navigate away
  from terminal.
- Successful saved-entry reconnect clears recovery UI and navigates to a fresh
  shell/channel.
- Reconnect disposal invalidates bridge/control channel and suppresses stale
  bridge dialogs.
- Bridge stream closes during reconnect are traced but not shown as user-facing
  Workmux failures.
- Bridge stream closes outside reconnect still surface a user-facing Workmux
  failure.
- Disposed-by-reconnect bridge results that surface after reconnect has ended
  are still suppressed (classification-based, not time-window-based).
- Recorded reconnect traces are exportable through the debug command after the
  reconnect has completed or failed.
- Timeout path emits full trace and routes to host page.
- Abort/reset path emits full trace and does not leave stale reconnect state.

Manual E2E validation should update
`docs/run/tailscale-reconnect-manual-e2e-runbook.md` with the expected fixed
behavior:

- After Tailscale reconnects, Fressh either reattaches tmux cleanly or returns to
  the host page with actionable recovery UI.
- Fressh must not leave a dead terminal.
- Fressh must not show a raw stale `mdev bridge stream closed` dialog from
  Workmux actions after reconnect has ended.

## Implementation Notes

The implementation should stay incremental but avoid preserving the old
active-connection-first assumption for tmux reconnects. Keep boundaries close to
current modules:

- reconnect timing remains in `auto-connect-reconnect-controller`;
- reconnect strategy lives in `auto-connect-attempt`;
- Tailscale recovery remains reusable through the existing recovery helpers;
- bridge lifecycle observability belongs with `mdev-bridge-client` and
  Workmux-control callers;
- terminal route behavior should route away on classified reconnect failure
  instead of waiting indefinitely with missing shell state; the route owns this
  navigation by reacting to the classified reconnect outcome (the controller
  stays router-free), and must not navigate while a reconnect cycle is still in
  progress;
- `reconnect.started` fields such as route, visible connection/channel, and
  tmux settings are not visible to the reconnect controller today; the caller
  that starts the reconnect cycle must plumb them in.
