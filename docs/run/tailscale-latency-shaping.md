# Tailscale Latency Shaping Runbook

Use this to test mobile connection code against a slow Tailscale path without
slowing every connection to the development VM.

This is useful for validating SSH connect timeouts, Tailscale recovery, tmux
reattach, workmux control requests, and reconnect UX on high-latency mobile
data.

## What This Does

The VM adds a Linux `tc netem` delay on `tailscale0`, scoped to packets whose
destination is the tablet Tailscale IP. This delays VM-to-tablet responses, so
tablet-initiated SSH/ping traffic sees a higher round trip time.

It should not affect:

- Desktop-to-VM SSH sessions.
- ADB-over-USB through a separate desktop host Tailscale IP.
- Other Tailscale peers.

It will affect traffic from this VM to the tablet Tailscale IP while the rule is
active.

## Preconditions

- The development VM is Linux.
- The VM is connected to Tailscale.
- You have `sudo` for `tc`.
- You know the tablet Tailscale IPv4 address.

Set variables:

```bash
export TAILSCALE_DEV=tailscale0
export TABLET_TS_IP=100.113.210.6
```

## Add About 1 Second RTT For The Tablet

```bash
sudo /sbin/tc qdisc del dev "$TAILSCALE_DEV" root 2>/dev/null || true
sudo /sbin/tc qdisc add dev "$TAILSCALE_DEV" root handle 1: prio
sudo /sbin/tc qdisc add dev "$TAILSCALE_DEV" parent 1:3 handle 30: netem delay 1000ms 100ms
sudo /sbin/tc filter add dev "$TAILSCALE_DEV" protocol ip parent 1: prio 1 \
  u32 match ip dst "$TABLET_TS_IP"/32 flowid 1:3
```

The `100ms` value adds jitter so the path behaves closer to a real mobile
connection.

## Verify The Rule Is Active

```bash
/sbin/tc qdisc show dev "$TAILSCALE_DEV"
/sbin/tc filter show dev "$TAILSCALE_DEV"
```

Expected qdisc shape:

```text
qdisc prio 1: root ...
qdisc netem 30: parent 1:3 ... delay 1s 100ms
```

Expected filter shape:

```text
filter parent 1: protocol ip pref 1 u32 ...
  match <tablet-ip-hex>/ffffffff at 16
```

From the tablet, run a Tailscale ping or app connection attempt to the VM. The
round trip should be roughly one second instead of the normal low-latency value.

## Test Cases To Run

- Press Connect from the host page while latency is active.
- Disconnect and reconnect Tailscale on the tablet, then return to Fressh.
- Switch tmux windows after reconnect.
- Run `Debug connection in Codex` after failures and confirm traces include:
  - `network.preflight.checked`
  - `tailscale.ensure-ready.result`
  - `tailscale.recovery.result` when recovery is attempted
  - workmux/mdev bridge request timing events

## Remove The Latency Rule

Always remove the shaping when the test is done:

```bash
sudo /sbin/tc qdisc del dev "$TAILSCALE_DEV" root
```

Verify it is gone:

```bash
/sbin/tc qdisc show dev "$TAILSCALE_DEV"
/sbin/tc filter show dev "$TAILSCALE_DEV"
```

Expected clean state:

```text
qdisc fq_codel 0: root ...
```

There should be no `netem` qdisc and no `u32` tablet filter.

## Troubleshooting

If deletion fails with `Operation not permitted`, rerun the delete command with
`sudo`.

If ping from the tablet is still fast, check:

- `TABLET_TS_IP` is the tablet's current Tailscale IP.
- The filter uses `match ip dst`, not `match ip src`.
- The interface is `tailscale0`.
- The test traffic is tablet-to-VM so VM responses are delayed.

If unrelated connections slow down, remove the rule immediately and re-add it
only after confirming the filter is scoped to the tablet `/32` IP.
