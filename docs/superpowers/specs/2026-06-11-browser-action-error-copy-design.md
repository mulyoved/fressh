# Browser Action Error Copy Design

## Context

The mobile app has a `Browser` action menu with actions such as `Diff`,
GitHub targets, detected open, and saved URL slots. These actions are handled by
`useBrowserActionsController` in `apps/mobile/src/lib/shell-modals.tsx`.

Failures currently go through a shared `showError(title, message)` callback that
shows a native React Native alert with only an `OK` action. This keeps the UI
simple, but it makes debugging harder because the user has to manually recreate
which Browser action failed and what context was available at the time.

The concrete failure that prompted this is `Browser > Diff`, where
`runHostDiffityOpenRequest` runs the Diffity share command and reports
`Diffity failed` when the command fails, returns no HTTPS URL, or Android cannot
open the resulting URL.

## Goals

- Add a `Copy Error` button to Browser action error alerts.
- Keep the visible error dialog concise and familiar.
- Copy a paste-friendly plain-text report with action context and failure
  details.
- Apply the behavior to all Browser action errors that use the shared
  controller error path, not just Diff.
- Add focused tests for formatting, copy behavior, and Diff-specific context.

## Non-Goals

- Do not replace the native alert with a custom modal.
- Do not add automatic remote log collection.
- Do not change Browser action execution behavior, request cancellation, or
  in-flight guards.
- Do not expose private key material, connection passwords, or other secrets in
  the copied payload.

## User Experience

When a Browser action fails, the user sees the same native alert title and
message they see today, with two actions:

- `Copy Error`
- `OK`

Pressing `Copy Error` writes a structured plain-text report to the clipboard
using `expo-clipboard`. Copy failures are logged and do not show a second alert,
matching the existing Workmux scrollback failure copy behavior.

The alert body stays short. Extra debugging context appears only in the copied
payload.

## Copied Error Format

The copied text uses a stable, line-oriented format:

```text
Fressh Browser Action Error
Action: Diff
Title: Diffity failed
Message: mdev diffity share did not return an HTTPS URL.
Connection: connected
Workmux enabled: true
Tmux target: main
Pane path: /home/muly/fressh
Command: cd '/home/muly/fressh' && mdev diffity share
Output:
<raw command output when available>
```

Fields that are not available are omitted. The formatter does not emit
synthetic labels for missing values.

The baseline fields are:

- `Action`
- `Title`
- `Message`
- `Connection`
- `Workmux enabled`
- `Tmux target`

Optional fields are:

- `Pane path`
- `Command`
- `Output`
- `URL`
- `Details`

## Architecture

Add a small Browser action error model and formatter under `apps/mobile/src/lib`.
The model should be independent of React so it can be unit-tested without
rendering:

```ts
type BrowserActionErrorReport = {
  action: string;
  title: string;
  message: string;
  connectionState: 'connected' | 'missing';
  tmuxEnabled: boolean;
  tmuxTarget: string;
  panePath?: string;
  command?: string;
  output?: string;
  url?: string;
  details?: string;
};
```

`useBrowserActionsController` owns the alert and clipboard wiring because it
already owns the Browser action callbacks and the shared `showError` path. The
current helper becomes an enriched helper that accepts a report input, formats
the copy payload, and calls:

```ts
Alert.alert(title, message, [
  { text: 'Copy Error', onPress: () => Clipboard.setStringAsync(copyText) },
  { text: 'OK' },
]);
```

The clipboard call should catch and log failures only. It should not block the
alert or action cleanup.

## Action Context

All Browser action handlers pass an action name into the shared error helper:

- `Diff`
- `GitHub Issues`
- `GitHub Pull Requests`
- `Open`
- `Pick`
- `URL`
- `Web`
- `Story`

Shared context comes from the controller dependencies and local state:

- `connectionState` is `connected` when `connection` is present and `missing`
  otherwise.
- `tmuxEnabled` is the current controller boolean.
- `tmuxTarget` is the trimmed target name, defaulting to `main` for the report.

URL slot actions already resolve `panePath` before opening or editing saved
values. If an error occurs after `panePath` is known, include it. If resolving
the pane path fails, omit it.

GitHub and detected-open actions should include shared context only unless the
handler already has more specific data available without adding extra remote
commands.

## Diff-Specific Context

Diff should include richer command context because it is the most common
debugging path:

1. Resolve the Browser actions pane path.
2. Build the exact Diffity command with `buildDiffityShareCommand(panePath)`.
3. Run the command.
4. Parse the last HTTPS URL from the output.
5. Open the URL with Android.

If the command output does not contain an HTTPS URL, the report includes:

- action `Diff`
- resolved `panePath`
- exact `command`
- raw `output`
- message derived from the existing failure message

If Android URL opening fails, the report includes:

- action `Diff`
- resolved `panePath`
- exact `command`
- extracted `url`
- Android open failure message

If pane path resolution or command execution fails before output exists, the
report includes only the shared context and the failure message unless the
handler already has a safe command or path value.

## Error Handling

The visible message should remain the primary user-facing failure string. The
copy payload augments it, but does not replace it.

The alert is shown only for the current request, preserving the existing stale
request guards in `runHostDiffityOpenRequest` and the Browser action controller.

Clipboard copy is best-effort. If `Clipboard.setStringAsync` rejects, log a
warning and leave the original alert flow unchanged.

No secrets should be added to the report. Remote command strings in this path
contain pane paths, slot names, and URLs; they should not include private keys
or passwords.

## Testing

Add focused integration or unit tests for:

- Browser action error formatter emits stable plain text, omits unavailable
  fields, and includes multiline output under `Output:`.
- Shared Browser action error alert includes `Copy Error` and `OK`.
- Pressing `Copy Error` calls the supplied clipboard writer with the enriched
  payload.
- Diff missing-HTTPS-output failure includes action, title, message, pane path,
  command, and raw output.
- Diff Android-open failure includes the extracted URL when available.
- Existing stale Diff request behavior remains unchanged.

Existing tests for Browser action intent mapping and modal controller behavior
should not need broad rewrites because execution behavior is not changing.
