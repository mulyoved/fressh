# Terminal output stall boundary evidence

## Reproduction

On 2026-07-13 UTC, the local Android `preview` APK was installed in place on
the tablet without clearing application data. The installed package remained
`com.finalapp.vibe2`, version `0.0.5` (code `5`), with update time
`2026-07-13 10:46:01`.

The existing saved connection opened successfully. Android accessibility
metadata identified exactly one enabled button labeled `Work`. One controlled
tap completed successfully in 178 ms. The command result reported 334 output
bytes. No terminal contents, command arguments, keystrokes, keys, or raw SSH
data were captured in this evidence.

Both snapshots identify the same terminal path:

- Connection: `muly@dev-remote-machine-1:22:35526`
- Channel: `2`
- Runtime instance: `mrix64a3-zwxrti9p`
- WebView instance: `mrix64a3-zwxrti9p`

## Boundary counters

| Boundary | Before | After | Advanced? |
| --- | ---: | ---: | :---: |
| Native tail sequence | 1084 | 1089 | Yes |
| Listener bytes | 0 | 0 | No |
| RN sent bytes | 7538 | 7538 | No |
| WebView received bytes | 7538 | 7538 | No |
| xterm completed writes | 1 | 1 | No |

First failed boundary: native ring to JavaScript listener delivery. Native
output advanced by five sequence positions, while the registered listener
delivered no events or bytes and every downstream counter remained unchanged.

This evidence identifies where output stopped. It does not select or implement
a production fix.
