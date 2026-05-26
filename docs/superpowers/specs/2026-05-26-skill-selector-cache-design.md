# Skill Selector Cache Design

## Goal

Opening the `$` skill selector should feel instant after skills have been
loaded once for a project. Skill discovery can still use the existing SSH/tmux
side-channel command, but it should run only when the current project has no
cache or when the user explicitly refreshes.

## Current Behavior

The selector currently resolves the tmux pane path and runs skill discovery
every time it opens. The modal clears the skill list while loading, so users see
the slow path even when they recently loaded the same project. The existing
modal has retry plumbing, and the selector already has a source key based on the
connection/channel/tmux target.

## Cache Model

Add a `skill-discovery-cache` module backed by MMKV. Cache entries are keyed by
connection/source plus project folder:

```text
stableConnectionId + tmuxTarget + projectRoot
```

`stableConnectionId` is `connectionStoredConnectionId` when present, otherwise
the runtime `connectionId`.

Each entry stores parsed data:

- `projectRoot`: resolved git root or folder used for discovery.
- `projectName`: basename shown in the UI.
- `skills`: parsed `DiscoveredSkill[]`.
- `updatedAt`: timestamp for display and debugging.

The cache stores parsed skill metadata, not raw command output or full
`SKILL.md` contents. Refresh still reads `SKILL.md` content remotely so names
and descriptions stay accurate after the user asks for fresh data.

Malformed cache records are ignored and deleted. Refresh errors are not written
as cache data.

## Data Flow

Opening `$` follows a cache-first path:

1. Resolve the current tmux pane path and project root.
2. Read the persisted cache for that connection/source/project.
3. If cache exists, show cached skills immediately and do not run discovery.
4. If cache is missing, run discovery once, parse the result, write the cache,
   and show the skills.
5. If the user taps Refresh, run discovery for the current project and replace
   that cache entry.

The selector should keep request-id/source-key guards so stale async work cannot
update a modal that has been closed or switched to another connection.

Project root resolution must be explicit. The app can either add a small
project-resolution command before cache lookup or extend the discovery command
to return `{ projectRoot, records }`. The implementation should prefer one
remote command on cache miss and refresh, while cache-hit opens should only do
the lightweight pane/project resolution needed to choose the cache entry.

## UI Behavior

The modal keeps the existing search and selection behavior. It adds:

- A project label near the top, using `projectName`.
- A Refresh button near Close.
- A refresh/loading indicator that does not clear the existing cached list.
- A short error message when refresh fails.

When cached skills exist and refresh fails, the modal keeps showing the cached
skills. When no cache exists and discovery fails, the modal keeps the current
empty/error retry behavior. Retry can call the same refresh path.

The cache data shape supports grouping by project folder. The first
implementation may show only the current project group because the selector is
opened from one active tmux pane, but the UI should avoid hard-coding a flat
list-only model.

## Non-Goals

- No background refresh on open.
- No TTL-based invalidation.
- No cross-device sync.
- No separate grouping by `.agents`, `.claude`, or `.codex` skill root.
- No change to the `$skill` insertion behavior.

## Components

- `skill-discovery-cache` module:
  - Builds stable cache keys.
  - Reads and validates cache records.
  - Writes successful discovery results.
  - Deletes malformed or explicitly refreshed records when needed.
- `skill-discovery` module:
  - Keeps parser and command builders.
  - Exposes helpers for deriving the project display name from paths.
  - Parses discovery output that includes project metadata and skill records.
- `ShellDetail` skill selector state:
  - Tracks current project metadata, cached skills, loading state, and refresh
    state.
  - Opens from cache when possible.
  - Uses the existing side-channel command only for cache misses or refresh.
- `SkillSelectorModal`:
  - Accepts project metadata and refresh callback.
  - Displays cached results while refresh is pending.

## Error Handling

Cache read failures should not block the selector. The app should treat them as
a cache miss and fall back to discovery. Invalid stored JSON should be deleted.

Discovery failures should be scoped to the current project/source request. If
cached skills exist, the error is secondary and the list remains selectable. If
no cached skills exist, the modal shows the current failure state with Retry.

## Testing

Add focused tests for:

- Cache key separation by connection/source/project.
- Cache read/write round trip.
- Malformed cache recovery.
- Cache-first open behavior at the helper level where practical.
- Refresh replacing the current project cache.
- Existing parser behavior, including terminal-control-prefix output.

Manual Android verification:

1. Open `$` in a repo with skills. First open may load.
2. Close and reopen `$`. Skills should appear immediately from cache.
3. Tap Refresh. The list should stay visible while discovery runs.
4. Confirm refresh updates the cache and errors do not erase cached skills.
