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
4. Reconnect through the latest saved entry.
5. Attach to the configured tmux session.
6. Navigate to the new shell/channel on success.
7. On failure or timeout, stop reconnect and navigate to the host page with
   connection/Tailscale recovery state visible.

The old active-connection path can remain only as a non-tmux or explicitly
classified fallback. The normal tmux reconnect path should prefer saved-entry
reconnect because the active SSH transport is the suspect component.

## Trace Contract

Reconnect tracing should be full forensic tracing, not compact success/failure
logging. The trace must explain what failed, what was disposed, what recovery
was attempted, and why the user landed where they landed.

Required event coverage:

- `reconnect.started`: reason, route, visible connection/channel, tmux enabled,
  tmux session, and shell-drop recovery flag.
- `reconnect.transport.invalidated`: old connection id, old channel id, whether
  shell existed, whether bridge/control channel was disposed, and pending bridge
  request count when available.
- `tailscale.ensure-ready.result`: always emitted before saved-entry reconnect on
  Android, including when Tailscale is already ready.
- `tailscale.recovery.result`: emitted whenever recovery is attempted or skipped,
  with skip reason.
- `saved-entry.connect.started`: entry id, host, port, tmux session, and trigger
  `reconnect`.
- `saved-entry.connect.connected`: connection id, channel id, tmux session.
- `saved-entry.connect.failed`: failure class, error summary, and tmux attach
  failure reason when present.
- `mdev-bridge.lifecycle`: stream starting, hello complete, request started,
  request failed, stream closed, and client disposed.
- `reconnect.completed`: final outcome `connected`, `needsAttention`, `timeout`,
  `aborted`, or `navigatedToHost`.
- `reconnect.ui.transition`: terminal overlay shown/hidden, host-page recovery
  panel marked, and route changed.

Reconnect attempt results should no longer be boolean-only at the controller
boundary. They should carry a classified outcome such as:

- `connected`
- `needsAttention`
- `failedNetwork`
- `failedAuth`
- `failedTmuxAttach`
- `timeout`
- `aborted`
- `staleBridge`

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
- Pending bridge requests resolve with a classified stale-transport result, not a
  generic raw `mdev bridge stream closed`.
- Bridge-backed UI actions suppress raw dialogs while reconnect is active.
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
  instead of waiting indefinitely with missing shell state.
