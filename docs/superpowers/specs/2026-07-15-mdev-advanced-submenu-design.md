# mdev Advanced Submenu Design

## Goal

Shorten the mobile `Cmds > mdev` menu by moving infrequently used commands into
an `Advanced` submenu. Keep the most useful terminal, worktree, and Codex restart
actions directly accessible.

## Scope

This change reorganizes the bundled mobile shell configuration only. It does not
change command-menu navigation, action handlers, remote commands, bridge
operations, labels, or timeouts.

## Menu Structure

The `mdev` menu will use this exact order:

```text
mdev
├── Fit terminal to device
├── New Worktree Workspace
├── Close Worktree Workspace
├── restart codex
└── Advanced
    ├── codex auth refresh
    ├── Debug connection in Codex
    ├── Open Workspace
    ├── Rename Workspace
    ├── Close Workspace
    └── Request a Feature
```

`Advanced` is always the final entry in `mdev`. Its children use the order shown
above.

## Behavior

Every moved entry keeps its existing behavior:

| Entry | Behavior |
| --- | --- |
| `codex auth refresh` | Types `mdev codex auth refresh` and presses Enter. |
| `Debug connection in Codex` | Dispatches `DEBUG_CONNECTION_IN_CODEX`. |
| `Open Workspace` | Types `mdev tmux open-workspace` and presses Enter. |
| `Rename Workspace` | Types `mdev tmux workspace prompt-rename` and presses Enter. |
| `Close Workspace` | Types `mdev tmux workspace close` and presses Enter. |
| `Request a Feature` | Dispatches `OPEN_REPO_FEATURE_REQUEST`. |

The direct `mdev` entries also retain their current action IDs, commands, bridge
operation, and timeout. Selecting `Advanced` uses the command menu's existing
nested-submenu navigation.

## Implementation

Reorder the existing entries in `apps/mobile/config/shell-config.json` and wrap
the six advanced entries in one `submenu` entry labeled `Advanced`. No React,
navigation, schema, action-handler, or remote-command changes are required.

Update the command-menu integration tests so they:

- assert the complete approved hierarchy and ordering;
- find moved actions and presets through `mdev > Advanced`;
- continue asserting each entry's unchanged payload;
- assert the direct worktree actions remain adjacent in the approved order;
- assert `restart codex` remains bridge-backed with its existing timeout.

Any tests that currently depend on old entry indexes or paths will be changed to
reflect the approved hierarchy.

## Error Handling

No new error path is introduced. Preset, native action, bridge, and submenu
selection failures continue through their existing handlers.

## Verification

Run the focused mobile integration tests that cover the bundled command tree and
shell configuration. Then run the mobile typecheck and relevant broader test
suite required by the repository before completion.

## Out of Scope

- Renaming any menu entry.
- Adding section headings or additional submenus.
- Changing the behavior of any command or action.
- Publishing an OTA update or creating a mobile build.
