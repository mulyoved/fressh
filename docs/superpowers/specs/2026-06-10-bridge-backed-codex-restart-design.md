# Bridge-Backed Codex Restart Design

## Overview

The mobile command menu currently exposes `Cmds > mdev > restart codex` as a
terminal preset. Selecting it writes this shell command into the active terminal
and presses Enter:

```sh
mdev codex restart "$(mdev tmux app context --session main | sed -n 's/.*"target":"\([^"]*\)".*/\1/p')"
```

The mobile tmux keyboard also has a `Restart` key that sends raw `Alt+Shift+X`
bytes into the active terminal. The remote tmux binding for `Alt+Shift+X` works
correctly and is out of scope. The mobile app should not paste or type restart
commands into the active PTY when the user triggers restart from the mobile
command menu or mobile tmux keyboard.

This design makes mobile Codex restart a bridge-backed operation that executes
through the existing persistent `mdev bridge` channel used by Workmux controls.

## Goals

- Run mobile `restart codex` without writing command text into the active PTY.
- Reuse the existing persistent `mdev bridge` channel instead of opening a new
  SSH command/session for the normal path.
- Route both mobile entry points through the same app-side restart behavior:
  command menu and mobile tmux keyboard.
- Keep the remote tmux `Alt+Shift+X` binding unchanged.
- Keep restart structured: mobile should send a typed bridge operation rather
  than a shell string.
- Show a clear update/failure message when the remote `mdev` bridge is too old
  or unavailable.

## Non-Goals

- Do not change the remote tmux key binding for physical/Desktop
  `Alt+Shift+X`.
- Do not add arbitrary shell command execution to the persistent bridge.
- Do not fall back to pasting the restart shell command into the terminal.
- Do not redesign the command menu UI.
- Do not change unrelated command presets such as workspace open, close, or
  rename.

## Command Model

Add a command menu entry type for bridge-backed commands. The entry represents a
structured operation, not a shell command string:

```ts
type CommandBridgeEntry = {
	type: 'bridge';
	label: string;
	operation: 'codex.restart';
	timeoutMs?: number;
};
```

The initial bundled use is:

```json
{
	"type": "bridge",
	"label": "restart codex",
	"operation": "codex.restart",
	"timeoutMs": 10000
}
```

The schema should validate bridge operations against an allowlist. The first
supported operation is `codex.restart`. This keeps the config generic enough for
future structured bridge operations without creating a generic remote shell
executor.

## Mobile Runtime Behavior

Command menu selection should dispatch by entry type:

- `submenu`: navigate into the submenu.
- `preset`: keep the existing terminal step behavior.
- `action`: close the menu and run the existing native action dispatcher.
- `bridge`: close the menu and run the bridge-backed command dispatcher.

The tmux keyboard `Restart` key should stop sending raw `[27, 88]` bytes. It
should become a native action, for example `RESTART_CODEX`, that calls the same
bridge-backed restart dispatcher used by the command menu entry.

The bridge-backed restart dispatcher should:

1. Require an active SSH/Workmux connection.
2. Require tmux/Workmux to be enabled.
3. Resolve the active session name from the connection settings, defaulting to
   `main`.
4. Use the existing persistent Workmux control channel to request current app
   context for that session.
5. Extract the current `target` from the context response.
6. Send a structured `codex.restart` bridge operation with that target.
7. Surface success silently unless the app already has an established lightweight
   success affordance for command actions.

No part of this flow should call `sendTextRaw`, `sendBytesRaw`, `runCommandSteps`,
or write to the terminal PTY.

## Bridge Operation

Extend the mobile bridge operation model with a Codex restart operation:

```ts
{
	operation: 'codex.restart',
	params: { target: string }
}
```

The remote `mdev bridge` must support `codex.restart` as a bounded,
noninteractive command. It should run the same restart behavior as the current
`mdev codex restart <target>` CLI command. The bridge should reject missing or
invalid targets as a request-level command failure.

Mobile should not send the existing shell command string through the bridge.
Resolving context and restarting Codex should happen as two structured bridge
requests on the same persistent channel.

## Error Handling

If there is no active connection, show the existing no-connection style message.

If tmux/Workmux is disabled, show a message equivalent to the existing Workmux
action precondition failure.

If context resolution fails, show the formatted Workmux/mdev update message when
the failure indicates an old or missing bridge operation. Otherwise show the
remote failure text.

If `codex.restart` is unsupported by the remote bridge, show an "Update mdev"
style message. Do not paste the old command into the terminal as fallback.

If restart returns a non-zero remote result, show the bridge failure message.
The command menu should already be closed by this point.

## Testing

Add focused tests for:

- `parseShellConfigData` accepts bridge command entries with supported
  operations.
- `parseShellConfigData` rejects unsupported bridge operations.
- Bundled `shell-config.json` exposes `Cmds > mdev > restart codex` as a bridge
  entry, not a preset.
- The mobile tmux keyboard `Restart` key is an action that maps to the Codex
  restart path, not raw bytes.
- Command menu selection dispatch calls the bridge handler for bridge entries
  and does not call the terminal preset handler.
- The restart dispatcher resolves Workmux context, extracts `target`, and sends
  `codex.restart` on the existing Workmux control channel.
- Old or unsupported bridge failures produce the update-mdev style message.
- Restart failures do not write to terminal input.

Run the focused mobile integration tests for shell config, command menu
selection, keyboard actions, Workmux bridge operations, and any new Codex
restart dispatcher tests.

## Files Expected To Change Later

- `apps/mobile/src/lib/shell-config.ts`
  - add the `bridge` command menu entry type;
  - validate bridge operation names.
- `apps/mobile/src/lib/command-menu-selection.ts`
  - dispatch bridge entries to a bridge handler.
- `apps/mobile/src/app/shell/components/CommandPresetsModal.tsx`
  - render bridge entries like other selectable command rows.
- `apps/mobile/src/app/shell/detail.tsx`
  - provide the bridge handler to the command menu;
  - add or wire the `RESTART_CODEX` action for the mobile tmux keyboard.
- `apps/mobile/src/lib/keyboard-actions.ts`
  - add the restart action id and action-context hook.
- `apps/mobile/src/lib/workmux-bridge-operations.ts`
  - add `codex.restart` operation construction.
- `apps/mobile/src/lib/workmux-control-channel.ts`
  - expose a way to run the structured restart operation through the existing
    persistent bridge client.
- `apps/mobile/config/shell-config.json`
  - convert `mdev > restart codex` from preset to bridge entry;
  - convert the tmux keyboard `Restart` slot from raw bytes to the restart
    action.
- Relevant integration tests under `apps/mobile/test/integration`.
- Remote `mdev` bridge implementation and tests, wherever the `mdev` CLI lives,
  to support the `codex.restart` operation.

## Rollout

This requires both a mobile app/runtime config update and a remote `mdev` update.
New mobile clients should report an update-mdev style failure until the remote
bridge supports `codex.restart`.

Because the old behavior pasted into the PTY, mobile should not silently fall
back to the old preset. Once shipped, mobile restart either executes through the
persistent bridge or fails visibly.
