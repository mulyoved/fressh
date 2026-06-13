# Mobile Detected Open Native Picker Design

## Context

Fressh mobile exposes `Open` and `Pick` browser actions that mirror the remote
tmux shortcuts:

- `Alt+a`: `mdev open auto`
- `Shift+Alt+A`: `mdev open pick`

Detection works today. `mdev open pick` can show the correct tmux picker and
the selected URL is correct. The failure is the final open step: `mdev` emits a
WezTerm-oriented OSC 1337 `tmux_open_url` payload to the pane TTY, while Fressh
mobile does not consume that OSC and convert it into Android
`Linking.openURL`.

Mobile should not depend on terminal escape parsing for browser actions. Fressh
already owns Android browser opening for Diff, GitHub, and saved URL actions.
Detected open should follow the same model.

## Goal

Make mobile `Open` and `Pick` open detected URLs/files through Android by using
machine-readable `mdev` output and a native Fressh picker.

## Non-Goals

- Do not remove or change the existing tmux/WezTerm `mdev open auto`,
  `mdev open pick`, or `--emit` behavior.
- Do not add OSC parsing to the Fressh terminal.
- Do not redesign the Browser actions menu.
- Do not change saved URL, Diffity, or GitHub browser actions.
- Do not move this flow onto `mdev bridge --jsonl`; the existing host browser
  side-channel command path is sufficient for this bounded action.

## Proposed Design

Add URL-returning modes to `mdev open`:

```text
mdev open auto --print-url
mdev open bridge <candidate> --print-url
```

These modes must perform the same detection and local-file/localhost bridging
work as the current commands, but write the final openable URL to stdout as a
plain line instead of emitting OSC to the pane TTY.

Reuse the existing:

```text
mdev open detect --json
```

for candidate discovery.

Fressh mobile changes its detected-open flow:

- `Browser -> Open`
  1. Resolve active Workmux pane context.
  2. Run `mdev open auto --print-url` with `TMUX_PANE`, `TMUX_PANE_TTY`, and
     `TMUX_PANE_PATH`.
  3. Validate the returned URL as `http://` or `https://`.
  4. Open it with Android `Linking.openURL`.

- `Browser -> Pick`
  1. Resolve active Workmux pane context.
  2. Run `mdev open detect --json` with the same pane environment.
  3. Parse the candidate array.
  4. Show a native Fressh modal listing the candidates.
  5. When the user selects one candidate, run
     `mdev open bridge <candidate.raw> --print-url`.
  6. Validate the returned URL as `http://` or `https://`.
  7. Open it with Android `Linking.openURL`.

The native picker must be compact and aligned with existing Browser action modal
styling. Each row must show a clear label derived from the candidate:

- remote URL: `remote-url` plus the display text
- local URL: `local-url` plus the display text
- file: `file` plus the display text

No special in-app explanatory text is needed.

## Data Contracts

`mdev open detect --json` must continue returning an array of detected
candidates with at least:

```ts
type OpenCandidate = {
  kind: 'remote-url' | 'local-url' | 'file';
  raw: string;
  display: string;
  normalized: string;
  path: string | null;
  line: number | null;
  url: string | null;
};
```

Fressh must use `candidate.raw` when calling `mdev open bridge`, matching the
existing tmux picker behavior.

The `--print-url` commands must return exactly one final URL on success. Extra
diagnostics must go to stderr, not stdout.

## Error Handling

If `mdev open auto --print-url` finds no candidate, Fressh shows the existing
Browser action error report for `Open`.

If `mdev open detect --json` finds no candidates, Fressh shows the existing
Browser action error report for `Pick`.

If candidate JSON is malformed, Fressh reports a protocol-style `Pick failed`
message and includes the command/output in the copyable error details.

If `mdev open bridge <candidate> --print-url` fails, Fressh reports `Pick
failed` and includes the selected candidate, pane path, command, and remote
output where available.

If Android cannot open the returned URL, Fressh reports the same
`Android could not open ...` error pattern used by saved URL actions.

## Compatibility

Existing tmux users keep using:

```text
mdev open auto
mdev open pick
mdev open bridge <candidate> --emit
```

Those commands keep emitting the current OSC payload.

Mobile starts using the new `--print-url` forms. On older remote `mdev`
versions, the commands fail with the normal browser action error path, which
points users toward updating `mdev`.

## Code Impact

Expected `mdev` areas:

- `dev-env/mdev/src/commands/open.ts`
  - accept `--print-url` for `auto` and `bridge`;
  - keep `--emit` behavior for existing paths;
  - reject ambiguous combinations such as both `--emit` and `--print-url`;
  - update usage text.
- `dev-env/mdev/test/open-command.test.ts`
  - cover `auto --print-url`, `bridge --print-url`, and invalid flag
    combinations.

Expected Fressh areas:

- `apps/mobile/src/lib/host-browser-actions.ts`
  - add command builders for `mdev open auto --print-url`,
    `mdev open detect --json`, and `mdev open bridge <candidate> --print-url`.
- `apps/mobile/src/lib/detected-open-actions.ts`
  - parse returned URLs and call an injected `openUrl` callback;
  - add candidate parsing and native picker request state.
- `apps/mobile/src/lib/browser-actions-controller-actions.ts`
  - expose detected-open helpers that return candidates/final URLs rather than
    assuming `mdev` opened the browser itself.
- `apps/mobile/src/lib/shell-modals.tsx`
  - wire `Open` to the URL-returning command and `openAndroidUrl`;
  - wire `Pick` to a native candidate picker modal.
- New or existing shell component area
  - add a focused detected-open picker modal if no suitable reusable modal
    exists.

Temporary debug instrumentation from the investigation must be removed before
the implementation is considered complete.

## Testing

`mdev` tests:

- `mdev open auto --print-url` writes the bridged/final URL to stdout.
- `mdev open bridge <candidate> --print-url` writes the final URL to stdout.
- `--emit` still emits OSC.
- invalid flag combinations are rejected.
- `pick` keeps its current tmux menu behavior.

Fressh tests:

- `Open` runs the `--print-url` command and calls `openAndroidUrl` with the
  returned URL.
- `Open` reports an error when the returned output is empty or not `http(s)`.
- `Pick` runs `detect --json`, parses candidates, and opens the native picker.
- Selecting a picker row runs `bridge <candidate.raw> --print-url`.
- Selecting a picker row calls `openAndroidUrl` with the returned URL.
- malformed candidate JSON and bridge failures use copyable Browser action
  errors.
- existing Diff, GitHub, and saved URL browser actions continue to pass.

Manual verification:

1. Place `https://example.com` in the visible pane.
2. Tap `Browser -> Open`; Android opens the URL.
3. Tap `Browser -> Pick`; the native Fressh picker lists the URL.
4. Select the URL; Android opens it.
5. Test a localhost URL and verify the returned Tailscale Serve URL opens.
6. Test a file candidate and verify the bridged file URL opens.

## Rollout

This requires both a remote `mdev` update and a Fressh mobile OTA/app update.
The remote `mdev` update is backward-compatible. Fressh must surface clear
browser action errors until the remote has the new `--print-url` support.
