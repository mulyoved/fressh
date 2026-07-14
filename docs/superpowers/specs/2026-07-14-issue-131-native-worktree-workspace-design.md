# Issue 131 Native Worktree Workspace Design

## Context

[Issue 131](https://github.com/mulyoved/fressh/issues/131) requests mobile
access to the worktree workspace behavior exposed by the remote tmux bindings:

- `Alt+n` runs `mdev tmux worktree new`.
- `Shift+Alt+N` runs `mdev tmux worktree close`.

The existing tmux flows collect the task branch with a tmux prompt and confirm
removal with `confirm-before`. Fressh should expose the same operations from
`Cmds > mdev`, but all user input and confirmation must use native Fressh UI.
The feature must work while any tmux role is focused; it cannot depend on a
shell being active or write commands into the terminal.

## Goals

- Add `New Worktree Workspace` and `Close Worktree Workspace` to `Cmds > mdev`.
- Collect the new task branch in a native Fressh modal.
- Confirm destructive worktree removal in native Fressh UI.
- Preserve the existing Worktrunk and tmux workspace behavior.
- Run both operations through bounded, typed `mdev bridge` operations.
- Capture and revalidate close identity so a stale dialog cannot remove the
  wrong worktree.
- Keep the existing desktop tmux shortcuts and CLI behavior unchanged.

## Non-Goals

- Do not add `Open Worktree Workspace`; Issue 131 covers only the two existing
  keyboard shortcuts.
- Do not add worktree buttons to a mobile keyboard.
- Do not type `mdev` commands into the active terminal pane.
- Do not send `Alt+n` or `Shift+Alt+N` bytes from the command menu.
- Do not reproduce Worktrunk or tmux workspace logic in the mobile app.
- Do not redesign the command menu or unrelated workspace commands.
- Do not add a generic remote shell executor to the bridge.

## User Experience

### Command menu

The `mdev` submenu places these entries with the existing workspace commands:

1. `Open Workspace`
2. `Close Workspace`
3. `Rename Workspace`
4. `New Worktree Workspace`
5. `Close Worktree Workspace`

Both new rows are native command-menu actions. Selecting a row closes the
command menu before starting the corresponding native flow.

### Create flow

1. Fressh closes the command menu.
2. The controller verifies the local connection and Workmux preconditions. If
   they pass, it opens a native `New Worktree Workspace` modal in a preparation
   state.
3. Fressh resolves the active tmux target through the existing Workmux context
   path and requests preparation data for that explicit target.
4. The modal replaces its preparation state with a `Task branch` field.
5. The field is prefilled with the same repository-based seed used by the tmux
   prompt, such as `fressh/`.
6. The user edits the branch name and selects `Create`.
7. Fressh trims the value and rejects an empty result locally.
8. While the operation is running, the field, Cancel button, and Create button
   are disabled and the modal shows progress.
9. `mdev` re-resolves the captured target, creates the Worktrunk worktree, adds
   and focuses its tmux workspace, and returns success.
10. Fressh closes the modal on success.

The modal does not attempt to duplicate Worktrunk branch validation. Remote
validation failures remain visible inline and preserve the entered value.

### Close flow

1. Fressh closes the command menu.
2. The controller verifies the local connection and Workmux preconditions. If
   they pass, it opens a native `Close Worktree Workspace` modal in a
   preparation state.
3. Fressh resolves the active tmux target through the existing Workmux context
   path and requests a close preview for that explicit target.
4. The modal replaces its preparation state with a confirmation displaying:
   - the worktree path;
   - the workspace identity or label;
   - the number and names of tmux windows that will close.
5. The user selects `Cancel` or the destructive `Remove Worktree` action.
6. While removal is running, both actions are disabled and the modal shows
   progress.
7. `mdev` revalidates the captured workspace identity and expected worktree path
   before removing anything.
8. On success, `mdev` removes the Worktrunk worktree and closes the captured
   workspace windows. Fressh closes the modal.

No tmux prompt or tmux confirmation appears in either flow.

## Mobile Architecture

### Worktree workspace controller

Add a focused shell-controller domain for this feature rather than adding its
state machine to the command menu or terminal input controller. Its public
surface owns:

- native modal state;
- preparation, creation, and removal commands;
- connection-generation and target captures;
- typed bridge response parsing;
- current inline error and submission state;
- render-ready modal props.

The state is phase-based rather than a collection of independent booleans. The
meaningful phases are:

- `idle`;
- `preparing-new`;
- `editing-new`;
- `creating`;
- `preparing-close`;
- `confirming-close`;
- `closing`.

Preparation failures remain in the applicable preparation phase with a typed
error and Retry action. Submission failures return to the applicable editing or
confirmation phase with a typed error. Connection invalidation returns the
controller to `idle` and suppresses callbacks from stale requests.

### Native modal

Add one worktree workspace modal component with discriminated create and close
modes. The controller supplies all data and callbacks; the component owns only
draft text needed for the create field and presentation behavior.

Create mode contains the seeded task-branch input, inline error, Cancel, and
Create controls. Close mode contains the captured removal details, inline error,
Cancel, and a destructive Remove Worktree control. Both modes expose a busy
presentation that prevents duplicate submission or misleading cancellation after
the remote mutation has started.

Register the modal with the existing shell modal arbiter so opening it closes
conflicting shell modals and connection invalidation cannot leave it orphaned.

### Command routing

Add two allowlisted action IDs:

- `OPEN_NEW_WORKTREE_WORKSPACE`
- `OPEN_CLOSE_WORKTREE_WORKSPACE`

The bundled shell config uses these IDs for the two command-menu entries. The
keyboard action boundary delegates them to the worktree workspace controller's
open commands. It does not send terminal bytes, run command steps, or directly
call bridge transport.

### Transport

The controller uses the existing persistent Workmux control channel. Worktree
operations are feature-specific optional operations, not global bridge startup
requirements. An older `mdev` therefore continues to support unrelated Workmux
controls and returns an unsupported-operation failure only when the user selects
one of the new commands.

The mobile boundary adds typed builders and parsers for the four worktree
operations. Although the existing control channel represents operation output as
JSON text, worktree feature code must parse it once at its transport boundary
and expose typed results to the controller.

## `mdev` Bridge Contract

All handlers require explicit targets or captured identities. They must not
depend on the bridge process's ambient tmux pane.

### Prepare creation

Request:

```json
{
	"operation": "tmux.worktree.new.prepare",
	"params": { "target": "%42" }
}
```

Result:

```json
{
	"target": "%42",
	"repositoryName": "fressh",
	"projectRoot": "/home/muly/code/fressh",
	"suggestedBranch": "fressh/"
}
```

The handler reads project metadata for `target`, resolves the main checkout, and
uses the existing branch prompt seed function. It rejects a missing tmux target
or a target that cannot provide the repository context needed by the existing
Worktrunk flow.

### Create worktree workspace

Request:

```json
{
	"operation": "tmux.worktree.new",
	"params": {
		"target": "%42",
		"expectedProjectRoot": "/home/muly/code/fressh",
		"branch": "fressh/issue-131"
	}
}
```

Result:

```json
{ "status": "created" }
```

The handler trims and rejects an empty branch, re-resolves project metadata and
the main checkout from `target`, and requires the resolved project root to equal
`expectedProjectRoot`. It uses that client-returned value only as an equality
guard, never as the path on which to operate. After validation, it invokes the
existing Worktrunk switch/create logic and adds the resulting worktree as a
focused workspace in the target's tmux session.

### Prepare removal

Request:

```json
{
	"operation": "tmux.worktree.close.prepare",
	"params": { "target": "%42" }
}
```

Result:

```json
{
	"session": "main",
	"workspaceId": "workspace-7",
	"workspaceLabel": "fressh/issue-131",
	"worktreePath": "/home/muly/code/fressh.issue-131",
	"closeFingerprint": "sha256:3ad1c6fa4e0b1d2595b024197f8a273b5d27039863245914b2318fe12e675981",
	"windows": [{ "id": "@17", "name": "fressh/issue-131" }]
}
```

The handler resolves the workspace containing `target`, verifies that it is a
Worktrunk worktree workspace, reads its persisted worktree path, and returns the
exact close set. The result must contain at least one window.

### Remove worktree workspace

Request:

```json
{
	"operation": "tmux.worktree.close",
	"params": {
		"session": "main",
		"workspaceId": "workspace-7",
		"expectedWorktreePath": "/home/muly/code/fressh.issue-131",
		"expectedCloseFingerprint": "sha256:3ad1c6fa4e0b1d2595b024197f8a273b5d27039863245914b2318fe12e675981"
	}
}
```

Result:

```json
{ "status": "closed" }
```

Before mutation, the handler resolves the captured workspace close set again,
requires at least one matching window, recomputes the deterministic fingerprint
from the session, workspace identity, and sorted window IDs, rereads the
persisted worktree path, and requires exact matches with both expected values.
Any mismatch fails without removing the worktree or closing windows. After
validation, it reuses the existing Worktrunk removal and workspace-window
cleanup functions.

### Shared implementation

Refactor the existing prompt-backed `mdev tmux worktree new` and
`mdev tmux worktree close` implementation only as needed to expose reusable
preparation and mutation functions. The CLI remains responsible for tmux prompt
and `confirm-before` presentation; the bridge handlers bypass those presentation
functions and call the same validated domain operations.

The bridge does not accept a repository root as an execution target, arbitrary
executable names, shell commands, or unbounded argv from mobile. The create
operation accepts `expectedProjectRoot` only as a stale-context equality guard;
it always derives its execution path from the explicit tmux target.

## Concurrency and Lifecycle

Each mobile flow captures the current connection generation and Workmux control
capability before its first asynchronous request. After every await, the
controller verifies that the capture is still current before publishing state,
opening or closing a modal, or showing an error.

Only one worktree request may be active per controller. Repeated menu taps while
preparing are ignored. Create and Remove are disabled after submission begins.
The controller does not automatically retry mutations.

The bridge timeout is 60 seconds, matching the current protocol maximum. A
timeout is an ambiguous outcome because the remote mutation may finish while the
response is lost. Fressh must say that the operation may have completed and ask
the user to inspect the workspace list before trying again.

## Error Handling

- Missing connection or disabled Workmux uses the existing local-precondition
  message and does not start a request.
- Unsupported worktree operations show the existing update-`mdev` guidance.
- Preparation failures keep the applicable preparation modal open with Retry and
  Cancel controls.
- Create failures preserve the user's branch text.
- Close identity, close-set, or expected-path mismatches show that the target
  changed and require a new preview before confirmation can be attempted again.
- Worktrunk and tmux failures show the sanitized remote bridge message inline.
- Timeout failures use the ambiguous-outcome copy described above and are never
  retried automatically.
- Successful operations close the modal without an extra success alert.
- No failure path falls back to terminal input, tmux key bytes, or shell command
  text.

## Testing

### Fressh

Add focused integration and component coverage for:

- the two bundled `Cmds > mdev` action entries and their ordering;
- allowlisting and dispatch of both action IDs;
- command-menu close-before-open behavior;
- create preparation, seeded input, trimming, empty-value validation, busy
  state, success, failure, and retry;
- close preview rendering, destructive confirmation, success, failure, and
  forced refresh after stale-target rejection;
- exact bridge operation names and parameter payloads;
- typed parsing and rejection of malformed bridge results;
- unsupported-operation and update-`mdev` messaging;
- connection-generation invalidation and stale callback suppression;
- duplicate submission prevention;
- ambiguous timeout messaging and absence of automatic retries;
- proof that neither flow calls terminal byte, text, shortcut, or command-step
  input paths.

### `mdev`

Add focused tests for:

- operation registry and bridge hello exposure for all four operations;
- strict parameter validation and rejection of unknown fields;
- explicit-target project metadata and suggested branch generation;
- rejection when the project root changes between preparation and creation;
- creation through the existing Worktrunk and tmux workspace functions;
- close preview details and rejection of non-worktree workspaces;
- captured close-set fingerprint, persisted-path, and expected-path
  revalidation;
- no mutation when any close validation fails;
- successful removal ordering and workspace cleanup;
- existing `Alt+n`, `Shift+Alt+N`, CLI prompt, CLI confirmation, and palette
  contracts remaining unchanged.

## Rollout

Publish `mdev` support before publishing the Fressh config/runtime update. The
new operations stay optional during bridge startup so mixed-version users keep
all existing Workmux functionality. If Fressh reaches an older `mdev`, only the
selected worktree command fails with update guidance.

The Fressh shell config version and timestamp must advance so installed clients
prefer the updated bundled or remote config containing the two new entries.

## Expected Change Areas

Fressh changes are expected in:

- the bundled mobile shell config and config tests;
- keyboard action IDs and action delegation;
- a focused worktree workspace controller and contracts/model;
- a native worktree workspace modal;
- shell modal arbitration and ShellDetail composition;
- typed worktree bridge request/result helpers and tests.

`mdev` changes are expected in:

- worktree domain functions shared by CLI and bridge handlers;
- target-aware workspace identity resolution;
- worktree operation specs and registry registration;
- bridge, CLI, tmux binding, and palette tests.
