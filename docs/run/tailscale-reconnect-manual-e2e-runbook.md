# Tailscale Reconnect Manual E2E Runbook

Use this runbook to validate the Android reconnect flow when the tablet loses
Tailscale while a tmux-backed shell is open.

## Preconditions

- Tablet is installed with the preview build under test.
- Tablet has a saved SSH entry that uses tmux.
- Host is reachable over Tailscale when Tailscale is connected.
- USB ADB is connected through the desktop host so log collection does not
  depend on tablet Tailscale.
- Logcat capture is running before the disconnect step.

## Setup

1. Open Fressh on the tablet.
2. Connect to the saved tmux-backed host.
3. Confirm typing in the terminal works.
4. Confirm switching tmux windows from the app controls works.
5. Start screenshots or screen recording if available.

Optional slow-network setup:

- Use [Tailscale Latency Shaping](./tailscale-latency-shaping.md) to add about
  one second of VM-to-tablet latency while keeping the delay scoped to the
  tablet Tailscale IP.
- Remove the shaping before ending the test session.

## Reconnect Validation

1. Disconnect Tailscale on the tablet.
2. Return to Fressh and wait for the reconnect UI.
3. Reconnect Tailscale manually.
4. Wait for Fressh to finish the reconnect cycle.
5. Try typing in the terminal if it is visible.
6. Try switching tmux windows if a terminal is visible.
7. If Fressh navigates to the host page, use the visible recovery UI actions.

Expected fixed behavior:

- Fressh briefly shows `Reconnecting...` after Tailscale disconnects.
- Fressh disposes stale SSH/shell/bridge transport and attempts saved-entry tmux
  reconnect.
- After Tailscale reconnects, Fressh either reattaches tmux into a fresh
  shell/channel or navigates to the host page.
- If recovery fails, the host page shows actionable recovery UI.
- Fressh must not leave the terminal visible with no working shell.
- Fressh must not show a raw stale `mdev bridge stream closed.` dialog after
  reconnect has ended.

## Trace Export After Failure

After a failed reconnect, use `Debug connection in Codex` from the app command
menu before reproducing again. The exported diagnostic text should include a
`Recorded reconnect traces` section with:

- `reconnect.started`
- `reconnect.transport.invalidated`
- `tailscale.ensure-ready.result`
- `tailscale.recovery.result` when recovery was attempted or skipped
- `auto-connect.saved-entry.connect.started`
- final `reconnect.completed`
- final `reconnect.ui.transition`

Save the exported text next to the screenshots and logcat artifacts.

## Evidence To Save

- Screen recording or screenshots.
- Logcat covering disconnect through reconnect completion.
- Exported diagnostic text from `Debug connection in Codex`.
- Build identifier and commit hash under test.
- Whether the flow ended in a fresh terminal or the host-page recovery UI.
