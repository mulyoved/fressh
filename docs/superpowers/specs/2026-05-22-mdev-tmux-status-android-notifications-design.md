# Mdev Tmux Status Android Notifications Design

## Context

Issue 55 requests an Android notification when a Claude/Codex-style agent
finishes and awaits input. In the current workflow, that state is already
represented in tmux with `@workmux_status` icons:

- `💬` for waiting/needs input
- `✅` for done/ready for attention
- `🤖` for working
- `💤` and `🕒` for manual hidden/parked states

Fressh is a React Native Android app connected to the remote host over SSH. The
event happens on the remote host, but the notification must be posted by Android
on the phone. Fressh already has an Android foreground service to keep SSH
sessions alive in the background, so this design uses that foreground-service
lifecycle as the notification bridge. It does not introduce cloud push.

## Goals

- Notify on remote status transitions to waiting (`💬`) or done (`✅`).
- Deliver Android local notifications while the app is backgrounded or open.
- Use a long-lived listener over the existing active SSH connection.
- Keep the remote event source deterministic by emitting events only from
  `mdev tmux set status`.
- Deduplicate notifications per tmux window until the matching window is viewed
  in Fressh.

## Non-Goals

- Do not detect manual `tmux set-option @workmux_status ...` writes.
- Do not poll tmux status periodically.
- Do not add a cloud push broker, FCM route, account identity, or server-side
  delivery path.
- Do not support notification delivery after the Fressh foreground service or
  SSH connection is gone.
- Do not make `working` or `clear` status changes create Android notifications.

## GitHub Tracking

- M-Dev remote event stream:
  [mulyoved/skills#39](https://github.com/mulyoved/skills/issues/39)
- Fressh Android notification bridge:
  [mulyoved/fressh#56](https://github.com/mulyoved/fressh/issues/56)
- Parent request:
  [mulyoved/fressh#55](https://github.com/mulyoved/fressh/issues/55)

## Architecture

Remote `mdev` is the notification-producing boundary. When an agent wrapper or
tool calls:

```sh
mdev tmux set status waiting [target]
mdev tmux set status done [target]
```

`mdev` updates the target window's `@workmux_status` and appends a durable
JSON-line notification event to a small per-user spool. It appends an event only
when the local window status actually changes to `💬` or `✅`.

Fressh starts one listener command for the active tmux-enabled Android
foreground-service connection:

```sh
mdev tmux notifications listen --session main
```

The command blocks and streams newline-delimited JSON events. The React Native
side parses those events, deduplicates them per remote/session/window, and calls
a native Android notification module to post local alert notifications.

Acknowledgement is app-side. When Fressh opens or selects the matching tmux
window, it clears the pending dedupe key for that remote/session/window and
dismisses the notification if it is still visible.

## M-Dev Workstream

The M-Dev workstream belongs in the `mulyoved/skills` repository, under the
`dev-env/mdev` package. It owns the remote event source, event persistence, and
listener CLI.

### M-Dev Scope

M-Dev should:

- Extend `mdev tmux set status waiting|done [target]` so it appends a
  notification event after a real status change.
- Keep `working` and `clear` status behavior unchanged and non-notifying.
- Resolve stable tmux window metadata for each event.
- Persist events to a bounded per-user JSONL spool.
- Expose `mdev tmux notifications listen --session <name>` as a blocking
  JSONL stream of future events.
- Support `--since-id <id>` so Fressh can resume after listener restarts.
- Keep status writes resilient if notification event persistence fails.

M-Dev should not:

- Detect manual `tmux set-option @workmux_status ...` writes.
- Know about Android notification channels, app foreground state, or Fressh
  dedupe state.
- Implement cloud push, account identity, or device registration.

### M-Dev Contract

`mdev tmux set status waiting|done [target]` should:

1. Resolve the target tmux window and metadata.
2. Read the local `@workmux_status` for that target.
3. If the status is already the requested icon, skip the tmux write and skip
   event creation.
4. Otherwise write the new status.
5. Append a JSONL event for `waiting` or `done`.

`mdev tmux set status working|clear [target]` should preserve existing status
behavior but should not append notification events.

The event shape should be stable JSON:

```json
{
  "id": "main:@12:1779434000000:waiting",
  "type": "tmux_status",
  "session": "main",
  "target": "main:4",
  "windowId": "@12",
  "windowIndex": "4",
  "windowName": "fressh",
  "status": "waiting",
  "icon": "💬",
  "createdAtMs": 1779434000000
}
```

Required fields:

- `id`: stable event id suitable for cursoring and duplicate suppression
- `type`: `tmux_status`
- `session`: tmux session name
- `target`: human-readable tmux target used for selection
- `windowId`: stable tmux window id when available
- `windowIndex`: current tmux window index
- `windowName`: current tmux window name
- `status`: `waiting` or `done`
- `icon`: `💬` or `✅`
- `createdAtMs`: event creation time in epoch milliseconds

`mdev tmux notifications listen --session <name>` should follow new events for
that session. By default, it starts at the current end of the spool so opening
Fressh does not replay stale attention events as fresh Android notifications.

The listener should support `--since-id <id>`. When supplied, it replays events
after that id and then follows new events. Fressh keeps the last seen event id
in memory while the foreground-service connection is alive and passes it when
restarting the listener after an unexpected listener exit.

The spool can be a compact JSONL file under the user's runtime/config state. It
should be bounded by either last N events or an age limit such as 24 hours so
long-running environments do not grow without limit.

### M-Dev Tests

Remote `mdev` tests:

- `mdev tmux set status waiting` writes `💬` and appends exactly one event.
- Repeating `waiting` for the same target does not append a duplicate event.
- `done` appends a new event after `waiting`.
- `working` and `clear` do not append notification events.
- `notifications listen` emits valid JSONL for followed events.
- `notifications listen --since-id <id>` replays events after that id and then
  follows new events.
- Event metadata includes session, target, window id/index/name, status, icon,
  and timestamp.
- Event spool retention keeps storage bounded.

## Fressh Workstream

The Fressh workstream belongs in the `mulyoved/fressh` repository. It owns the
Android notification bridge, SSH listener lifecycle, app-side parsing, dedupe,
and acknowledgement behavior.

### Fressh Scope

Fressh should:

- Start a long-lived listener command over the active SSH connection while the
  Android foreground service is keeping a tmux-enabled shell alive.
- Parse newline-delimited `mdev` notification events.
- Post Android local notifications for `waiting` and `done` events.
- Deduplicate pending alerts per `connectionId | session | windowId`.
- Clear pending state when the matching tmux window is visible or selected.
- Restart the listener with capped backoff after unexpected exits.
- Keep the interactive terminal session working even if notification listening
  fails.

Fressh should not:

- Poll tmux status.
- Detect manual remote tmux status writes.
- Deliver notifications after the foreground service or SSH connection is gone.
- Implement cloud push or any server-side delivery mechanism.

### Fressh Behavior

Notification listening follows the Android foreground-service connection
lifecycle:

- Start the listener when Android has an active tmux-enabled SSH connection and
  the foreground service should keep that connection alive.
- Stop the listener when the connection closes, the shell is removed, or the
  foreground service stops.
- Restart the listener with capped backoff if it exits unexpectedly while the
  SSH connection is still alive, passing the in-memory last seen event id when
  available.
- Log listener failures without disrupting the interactive shell.

Notifications should use a separate Android notification channel from the
ongoing SSH foreground-service notification:

- Foreground service: existing low-importance ongoing notification.
- Agent alerts: a new default-importance channel such as `Fressh Agent Alerts`.

Fressh deduplicates pending alerts by:

```text
connectionId | session | windowId
```

If `windowId` is unavailable, Fressh may fall back to `connectionId | session |
windowIndex`, accepting that tmux window renumbering can make that less stable.

When an event arrives for a pending key, Fressh skips posting another
notification. When the matching tmux window becomes visible or selected in
Fressh, Fressh clears the pending key and cancels the corresponding
notification.

Tapping a notification should open Fressh to the shell. If selecting the target
tmux window is safe through `mdev`, tapping may also select the target window.
For the first implementation, it is acceptable for tapping to open the shell and
let acknowledgement occur only when the app observes the matching window as
visible.

### Fressh Tests

Fressh tests:

- JSONL parser accepts valid notification events.
- JSONL parser rejects malformed lines without stopping the listener.
- Dedupe suppresses repeated events for the same
  `connectionId | session | windowId`.
- Viewing/selecting the matching window clears pending dedupe state.
- Listener lifecycle follows foreground-service and SSH connection lifecycle.
- Unexpected listener exit triggers capped restart while connected.
- Native Android agent notifications can post and cancel without affecting the
  ongoing SSH foreground notification.

## Cross-Workstream Error Handling

If `mdev tmux notifications listen` is missing or exits with a command error,
Fressh logs the failure and retries with capped backoff while the SSH connection
remains alive. The terminal session must continue to work.

Malformed listener lines are ignored and logged. One bad JSON line must not kill
the listener loop.

Remote spool write failures should not prevent `mdev tmux set status` from
updating tmux. `mdev` should report the spool failure to stderr and return a
non-zero exit only if the existing status command would normally fail for that
class of error. The notification path should not make agent status updates
fragile.

## Cross-Workstream Manual Verification

1. Build/install an Android preview build.
2. Connect to a tmux-enabled remote session.
3. Background Fressh.
4. On the remote, run `mdev tmux set status waiting <target>`.
5. Confirm Android posts an agent alert notification.
6. Open Fressh and view/select the matching tmux window.
7. Trigger another `waiting` or `done` transition and confirm it notifies again.

## Rollout Notes

Agent wrappers should route attention-worthy state changes through
`mdev tmux set status waiting|done`. Any direct `tmux set-option` usage will not
produce phone notifications by design.

This feature depends on the Android foreground service and active SSH
connection. If Android kills the service or the SSH connection drops, remote
events are not delivered until Fressh reconnects and restarts the listener.
