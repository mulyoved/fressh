# Skill Selector Mdev Metadata Design

## Goal

Make opening the `$` skill selector feel immediate in the normal mobile tmux
workflow, while avoiding the known wrong-folder cache bug.

The mobile app currently has to ask the remote host for the pane path, then
resolve the git project root, before it can safely use the local skill cache.
That remote round trip is visible to the user even when skill discovery itself
is cached. The new design moves live tmux/project metadata into the existing
`mdev` command boundary so Fressh can reuse metadata it already learns during
window navigation.

## Context

Fressh currently uses:

- `tmux display-message -p -t <session>: '#{pane_current_path}'` to read the
  active pane path.
- A separate Python command with `git rev-parse --show-toplevel` to resolve the
  project root.
- A local skill cache keyed by stable connection, tmux target, and project root.

The earlier "last project" shortcut was removed because it could show skills
from the wrong folder. The user accepts one specific stale case: if they manually
run `cd` inside an already-known tmux window, `$` may show the last known
project's skills until metadata is refreshed. Users normally switch work by
tmux window, not by `cd` inside the same pane.

## Approach

Add a small project metadata contract to `mdev`, then let Fressh store and reuse
that metadata locally.

`mdev` becomes the owner of tmux window/pane project metadata:

- Add `mdev tmux pane project [target]`.
- It resolves the active pane for the target window/session.
- It returns compact JSON containing the active pane and project identity.
- Extend window navigation commands to return the same JSON after they switch
  windows.

Fressh becomes a consumer of this metadata:

- Parse metadata returned by `mdev`.
- Store the latest known metadata for the visible tmux source.
- Route app-owned tmux window switching actions through `mdev` when metadata is
  needed. The existing `CYCLE_TMUX_WINDOW` action currently sends raw terminal
  bytes, so that path cannot update the metadata cache until it is moved to a
  side-channel `mdev tmux nav ...` command.
- Use that metadata to open `$` from local cache without a remote request.
- Fall back to `mdev tmux pane project [target]` when metadata is missing.

## Mdev Contract

Add `mdev tmux pane project [target]`.

Expected JSON:

```json
{
  "sessionName": "main",
  "windowId": "@3",
  "windowIndex": 3,
  "windowName": "mobile",
  "paneId": "%12",
  "panePath": "/home/muly/fressh/apps/mobile",
  "projectRoot": "/home/muly/fressh",
  "projectName": "fressh"
}
```

Rules:

- `target` follows tmux target conventions and defaults to the current tmux
  target when omitted.
- `panePath` comes from tmux `#{pane_current_path}`.
- `projectRoot` is `git -C <panePath> rev-parse --show-toplevel` when available.
- If git root resolution fails, `projectRoot` is the pane path.
- `projectName` is the basename of `projectRoot`, or `/` for the root path.
- Output is JSON only on success. Errors use the existing `mdev` CLI error
  behavior.

Extend these commands to print the same JSON after successful navigation:

- `mdev tmux nav next`
- `mdev tmux nav prev`
- `mdev tmux nav next-all`
- `mdev tmux nav prev-all`

Do not change `mdev tmux nav cycle`; in the current codebase that command cycles
workmux status, not active windows.

## Fressh Data Flow

Add a mobile-side tmux project metadata cache.

Primary key:

- stable connection id
- tmux session name
- active window id when known

Active pointer key:

- stable connection id
- tmux session name

Value:

- the `mdev` JSON payload
- `updatedAt`

On app-driven window navigation:

1. Fressh calls the appropriate side-channel `mdev tmux nav ...` command for
   window switching actions that need immediate skill-selector metadata.
2. Fressh parses returned metadata.
3. Fressh stores the metadata by window id and also updates the active pointer
   for the connection/session.
4. Future `$` opens can use that metadata immediately.

On `$` open:

1. If the active pointer resolves to metadata and skill cache has a matching
   project-root entry,
   render cached skills immediately without a side-channel request.
2. If metadata exists but skill cache is missing, run skill discovery for that
   project and write the skill cache.
3. If metadata is missing or invalid, call `mdev tmux pane project [target]`.
4. Use the returned project root to read cached skills or run discovery.

On refresh:

- Always perform remote metadata and discovery work.
- Replace both metadata cache and skill cache with fresh results.

## Staleness Policy

Fressh optimizes for the normal workflow: switch work by tmux window.

Accepted stale case:

- If the user manually runs `cd` inside a pane, `$` may still show skills for
  the last known project for that tmux window.

Correction paths:

- Refresh forces fresh metadata and discovery.
- App-driven window navigation updates metadata.
- Missing metadata falls back to `mdev tmux pane project`.

This policy keeps the selector immediate for common use while preserving an
explicit correctness escape hatch.

## Error Handling

If metadata parsing fails:

- Log the malformed output.
- Ignore the metadata cache update.
- Fall back to the current remote metadata path.

If `mdev tmux pane project` fails:

- Show the existing skill selector error state.
- Leave any existing skill cache untouched.

If skill discovery fails after metadata succeeds:

- Preserve existing cached skills for that project if present.
- Show the existing error or refresh-error state depending on whether this was
  an initial open or refresh.

## Testing

`mdev` tests:

- `mdev tmux pane project [target]` returns valid metadata JSON.
- Git root success returns repo root and project name.
- Git root failure falls back to pane path.
- `mdev tmux nav next|prev|next-all|prev-all` returns metadata for the newly
  active window.
- `mdev tmux nav cycle` behavior remains status-only.

Fressh tests:

- Metadata parser accepts the expected JSON shape and rejects malformed payloads.
- Metadata cache separates stable connection, session, and window id.
- Skill selector returns cached skills with zero remote commands when metadata
  and skill cache exist.
- Window action tests prove app-owned navigation calls `mdev`, parses returned
  metadata, and updates the active pointer.
- Missing metadata falls back to one `mdev tmux pane project` command before
  cache/discovery.
- Refresh bypasses local metadata and skill cache.

## Non-Goals

- Do not detect every manual `cd` inside a pane before showing cached skills.
- Do not add polling for all tmux windows.
- Do not use the saved tmux window registry as live current-folder truth.
- Do not guarantee metadata updates for raw terminal tmux shortcuts that bypass
  Fressh action handlers.
- Do not change skill discovery semantics beyond using trusted metadata to skip
  the blocking pane/project lookup.
