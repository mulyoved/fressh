# Android Tailscale Recovery Design

## Problem

On Android, Fressh depends on Tailscale for normal SSH reachability. When the
device network changes or Tailscale drops, the user often has to leave Fressh,
open Tailscale, disconnect or reconnect the VPN, verify the SSH host is
reachable, then restart Fressh.

Fressh already has Android auto-connect and reconnect behavior, but it treats
the network as external. Because Tailscale is required for this workflow, the
Android app should actively manage Tailscale during startup and recovery.

## Goals

- Treat Tailscale as a required Android runtime dependency for auto-connect.
- Start or nudge Tailscale before Android SSH auto-connect attempts.
- Recover from network-like SSH failures by sending Tailscale's Android
  `CONNECT_VPN` intent and retrying SSH.
- Verify recovery through the actual SSH connection, not by trusting that an
  Android intent succeeded.
- Provide clear user recovery actions when automatic recovery cannot restore
  SSH.
- Keep existing saved connection, auto-connect, foreground service, and SSH
  retry behavior as the source of truth.

## Non-Goals

- Replacing the SSH connection manager or saved connection model.
- Building a full Tailscale account or tailnet administration client.
- Depending on Tailscale's cloud API for local Android VPN state.
- Automatically disconnecting Tailscale as part of routine recovery.
- Claiming that Tailscale is connected without proving the Fressh SSH target
  is reachable.

## Tailscale Android Contract

Tailscale Android currently exposes an exported broadcast receiver named
`IPNReceiver` with these actions:

- `com.tailscale.ipn.CONNECT_VPN`
- `com.tailscale.ipn.DISCONNECT_VPN`
- `com.tailscale.ipn.USE_EXIT_NODE`

Fressh should call the receiver explicitly for connect and disconnect actions.
These intents are best-effort control signals. Android and Tailscale do not
provide Fressh a reliable local API that proves the target SSH host is usable,
so Fressh must verify by retrying the SSH connection.

## Architecture

Add a small Android-only Tailscale integration below the existing
`AutoConnectManager`.

`TailscaleNative` owns Android interaction:

```ts
type TailscaleNativeApi = {
	connect(): Promise<{ attempted: boolean }>;
	disconnect(): Promise<{ attempted: boolean }>;
	openApp(): Promise<{ attempted: boolean }>;
	isAvailable(): Promise<boolean>;
};
```

On Android, `connect` sends the explicit `CONNECT_VPN` broadcast to
Tailscale's package. `disconnect` sends `DISCONNECT_VPN`. `openApp` launches
the Tailscale app. `isAvailable` checks whether the Tailscale package or
receiver is present. On non-Android platforms, the module reports unavailable.

`tailscale-recovery.ts` owns policy:

- determine whether Tailscale recovery is enabled for the current platform;
- call `connect` before initial Android auto-connect;
- classify SSH failures that look like network reachability failures;
- throttle repeated Tailscale connect attempts;
- decide when to expose user recovery actions.

`AutoConnectManager` remains the orchestration point:

- before `connectAndOpenShell`, call `ensureTailscaleReady`;
- after a network-like SSH failure, call `recoverTailscaleThenRetry`;
- continue using the existing reconnect window and foreground service rules;
- expose a recovery state when automatic Tailscale recovery fails.

## Data Flow

Initial Android launch:

1. `AutoConnectManager` loads the latest saved auto-connect entry.
2. Fressh calls `ensureTailscaleReady`.
3. `TailscaleNative.connect()` sends `CONNECT_VPN` when allowed by cooldown.
4. Fressh waits a short settle delay.
5. Fressh attempts the saved SSH connection and opens the shell as it does
   today.

Reconnect after shell drop:

1. Existing shell-drop detection starts the reconnect loop.
2. Fressh attempts normal reconnect.
3. If SSH fails with a network-like error, Fressh sends `CONNECT_VPN`.
4. Fressh waits a short settle delay and retries SSH.
5. Success stops the reconnect loop.
6. Repeated failure enters a user-visible Tailscale recovery state.

User-visible recovery:

- `Open Tailscale` launches the Tailscale app.
- `Retry` reruns the Fressh recovery path.
- `Reset Tailscale` sends `DISCONNECT_VPN`, waits, sends `CONNECT_VPN`, waits,
  then retries SSH.

## Error Handling And Safety

Automatic recovery is active but bounded:

- `CONNECT_VPN` may run automatically before Android auto-connect and after
  network-like SSH failures.
- `DISCONNECT_VPN` must not run automatically. It is reserved for the manual
  `Reset Tailscale` action because it can interrupt other VPN traffic.
- Recovery attempts use a cooldown, for example one Tailscale connect nudge per
  15-30 seconds.
- Fressh verifies success only by reconnecting SSH.
- If Tailscale is unavailable or Android rejects the intent, Fressh shows the
  recovery state instead of looping silently.
- SSH authentication failures, key failures, host key failures, tmux attach
  failures, and missing saved keys are not classified as Tailscale failures.
- Background recovery follows the existing Android foreground service rules.

## UI Behavior

The normal successful path should be quiet. The user should not see a
Tailscale-specific screen when recovery works automatically.

When recovery fails, show a compact state in the existing auto-connect or shell
surface:

- title: `Tailscale connection needs attention`
- message: `Fressh could not reach the SSH host after restarting Tailscale.`
- primary action: `Open Tailscale`
- secondary actions: `Retry`, `Reset Tailscale`

The UI should avoid saying "Tailscale is connected" unless SSH has been
restored.

## Testing

Add pure TypeScript tests for:

- cooldown behavior;
- platform gating;
- network-like error classification;
- non-network errors bypassing Tailscale recovery;
- retry flow outcomes after successful and failed Tailscale nudges.

Add native-focused tests where practical for:

- Tailscale package/action constants;
- unavailable module behavior on non-Android or missing package paths.

Add integration tests around `AutoConnectManager` behavior:

- Android initial auto-connect calls `ensureTailscaleReady` before SSH.
- A network-like SSH failure triggers Tailscale recovery then retry.
- A tmux attach failure does not trigger Tailscale recovery.
- Repeated failure exposes a recovery state without unbounded retries.

Manual Android preview verification:

1. Install the preview build on a device with Tailscale.
2. Disable or disconnect Tailscale.
3. Open Fressh with an auto-connect saved connection that requires Tailscale.
4. Confirm Fressh sends recovery, waits, and reconnects SSH when Tailscale
   recovers.
5. Force a hard failure and confirm `Open Tailscale`, `Retry`, and
   `Reset Tailscale` behave correctly.

## Acceptance Criteria

- Android auto-connect treats Tailscale as a required dependency and nudges it
  before SSH.
- Network-like SSH reconnect failures trigger bounded Tailscale recovery.
- Manual reset is available but not automatic.
- Fressh verifies recovery through SSH success.
- Non-network SSH failures keep existing behavior and do not blame Tailscale.
- Tests cover policy decisions and reconnect integration.
