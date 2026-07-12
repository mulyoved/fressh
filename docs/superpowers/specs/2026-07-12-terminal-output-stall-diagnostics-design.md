# Terminal Output Stall Diagnostics Design

## Problem

The mobile Work key successfully changes the tmux workspace, but the terminal
shown in the Android app does not redraw to the selected workspace.

The failure is reproducible on the tablet connected through ADB at
`100.113.210.6:43239`. The mobile tmux client and desktop tmux client both move
to the new window. tmux reports that it writes the redraw bytes to the mobile
client without discarding them. The Android SSH socket has no unread receive
queue after the switch. This proves the command and server-side tmux paths work,
but it does not identify where output stops inside the app.

The earlier resize fix in commit `82d6f44` is installed and remains in current
`main`. No later terminal-output change exists in `main`.

## Goal

Locate the first app boundary that fails to pass the redraw bytes, then make the
smallest fix at that boundary. A successful fix must update the mobile terminal
immediately after a Work switch, without reconnecting, restarting tmux, losing
bytes, or clearing device data.

## Diagnostic Boundaries

One diagnostic run will record monotonic counts and sequence information at
these boundaries:

1. Native shell ring: current sequence, head/tail sequence, buffered bytes, and
   dropped-byte count before and after the Work request.
2. Native-to-React listener: event count, byte count, last event sequence, and
   dropped-range events.
3. React Native xterm writer: queued byte count, flush count, and bytes sent to
   the WebView.
4. WebView handler: write-message count, received byte count, and completed
   xterm write count.

Each record will include the shell connection/channel identity and terminal
instance identity so events from stale runtimes cannot be mistaken for the
active terminal.

## Diagnostic Behavior

Diagnostics will be structured and rate-limited. They will report cumulative
counts at attachment, immediately around a Work command, and after its result.
They will not log terminal contents, keystrokes, private keys, or raw SSH data.
They will not retry, replay, flush, reconnect, or otherwise change terminal
behavior during the evidence-gathering run.

## Root-Cause Decision

The first counter that does not advance identifies the failing boundary:

- Native ring unchanged: investigate SSH shell reading.
- Ring advances but listener does not: repair listener ownership or callback
  lifetime.
- Listener advances but RN-to-WebView bytes do not: repair RN scheduling or
  flushing.
- WebView receives all bytes but xterm completion does not advance: repair
  WebView/xterm write ordering or completion handling.
- All counters advance: compare xterm buffer state with the selected tmux
  screen and investigate terminal escape-sequence handling.

No production behavior fix will be selected before this run identifies the
failed boundary.

## Testing

Diagnostic helpers will have focused tests for cumulative counts, instance
identity, reset behavior, and redaction. After root cause is known, a separate
failing regression test will reproduce the confirmed defect before production
code is changed.

The final verification will include relevant unit and integration tests, lint
and type checking for changed packages, and repeated Work switches on the
tablet. Tablet app data and the remote tmux session will be preserved.

## Delivery

Use the local Android preview build lane. Install over the existing
`com.finalapp.vibe2` package without uninstalling or clearing data. Remove or
disable temporary high-volume diagnostics after the root-cause fix is verified,
while retaining only low-cost counters that provide useful failure evidence.
