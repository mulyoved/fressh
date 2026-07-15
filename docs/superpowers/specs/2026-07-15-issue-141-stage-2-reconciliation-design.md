# Issue 141 Stage 2 Reconciliation Design

**Issue:**
[#141 — Complete the staged source-quality recovery](https://github.com/mulyoved/fressh/issues/141)

**Current focus:** Stage 2 — ShellDetail and Wispr ownership

**Purpose:** Reconcile the completed work on `source-quality-stage-2` with the
latest accepted `dev` without carrying forward the branch's merge-heavy history,
losing accepted behavior, or weakening the Stage 2 ownership model.

## Scope

This design covers Stage 2 reconciliation only. It does not redesign the
complete source-quality recovery package or start Stages 3–7.

Stage 2 will preserve the approved route, screen-session, Workmux, diagnostic,
terminal, scrollback, keyboard, modal, Worktree Workspace, and Wispr behaviors.
It will adapt newly accepted behavior to the Stage 2 boundaries before Stage 2
is merged.

The following remain outside this reconciliation:

- Canonical `{ state, commands, view }` controller handles, which belong to
  Stage 3.
- Shared modal chrome and the decision to standardize the Worktree Workspace
  modal, which belong to Stage 3.
- Auto-connect runtime replacement, Xterm selection decomposition, Rust shell
  startup decomposition, and portable quality-gate work.
- Store publication, OTA rollout, or destructive device operations.

## Starting State

The existing `source-quality-stage-2` branch contains roughly 30 implementation
and hardening commits plus merge commits from older `dev` and `main` states. It
has multiple merge bases with current `dev` and conflicts in ShellDetail,
keyboard and terminal contracts, Jest configuration, tests, and the lockfile. It
has no pull request.

Current `dev` also contains accepted work that postdates the Stage 2 baseline,
including:

- Expo-compatible component-test infrastructure and terminal-listener ownership
  fixes.
- Native Worktree Workspace commands, controller, modal, and bridge contracts.
- The advanced mdev submenu.
- New diagnostics, secure-storage changes, and shell regressions.

Current `dev` is authoritative for those accepted behaviors and public
contracts. The old Stage 2 branch remains unchanged as evidence and as a source
for validated logic.

## Chosen Reconciliation Strategy

Create a fresh implementation branch from current `dev`. Before changing
production code, refresh the Stage 2 implementation plan with the exact current
filenames, controller contracts, test owners, and verification commands.

Reconstruct Stage 2 in validated vertical slices instead of rebasing every old
commit or applying one final-state patch. Each slice transfers or adapts tests
first, observes a meaningful failure on the current base, and then transfers or
reworks the production behavior that makes those tests pass.

New commits will reference the relevant original Stage 2 commits or reports. The
pull request will include a complete old-to-new evidence map. The original merge
topology will not be copied.

### Rejected alternatives

**Rebase the complete old series:** This would preserve every commit but require
repeated resolution of the same cross-cutting conflicts. Conflict decisions
would be difficult to review and could vary between commits.

**Apply the final old tree and repair it:** This would resolve conflicts once,
but it would obscure which behavior each resolution preserved and would not
provide credible per-slice red/green evidence.

**Reimplement Stage 2 from scratch:** This would provide clean history but
discard substantial validated ownership work and introduce unnecessary
regression risk.

## Reconstruction Slices

### 1. Route and screen-session foundation

Introduce the typed route result, recoverable route-error screen, pure session
state, navigation decisions, and session lifetime owner. Invalid routes render a
Back screen rather than throwing. The SSH store remains the only owner that
creates or destroys live connections and shells; screen unmount does not
disconnect them.

### 2. Workmux, diagnostics, and typed ports

Move Workmux creation, retirement, cleanup, diagnostic delivery, activity, host
commands, and terminal publication behind generation-bound session ports.
Terminal, scrollback, keyboard, notifications, browser actions, skill selector,
and other consumers stop receiving raw connections, raw Workmux channels, or
another controller's ref.

This slice must preserve the terminal-listener ownership and output-diagnostic
behavior already accepted on `dev`.

### 3. Wispr ownership

Reconstruct the dependency-injected Wispr core, hook, timer owner, tap runner,
close coordinator, start protocol, and native-control authority. Wispr lives for
the complete valid screen session and owns every request, timer, request ID,
deferred start, pending close, and cleanup decision.

Native cleanup uncertainty moves authority into the approved blocked state. A
successor cannot start until the predecessor's native lease is known to be
released.

### 4. Rendering boundary and Worktree Workspace adaptation

Reduce `ShellDetail` to route parsing, owner construction, narrow wiring, view
state selection, and rendering through `ShellScreenView`.

Adapt Worktree Workspace to Stage 2 without pulling Stage 3 forward:

- Replace its raw SSH connection and `WorkmuxControlChannel` dependencies with
  session identity, Workmux capability, session name, and `ShellWorkmuxPort`.
- Continue using the controller's current public handle and failure semantics.
- Add its modal props to `ShellScreenView` and render the existing custom modal
  there.
- Preserve the existing modal arbiter and action routing.

The advanced mdev submenu remains unchanged. It is declarative configuration
that already points to the same native Worktree actions.

### 5. Boundary hardening and acceptance

Delete obsolete shims, late bindings, fake dependencies, render-time ref
assignments, and duplicate ownership. Enforce the approved size and forbidden-
pattern gates, run the complete verification matrix, resolve the maintainability
review, and complete the non-destructive Android preview check.

## Ownership and Interfaces

### SSH store

The SSH store exclusively owns live SSH connections and shells. It exposes the
resources that the session observes, but screen cleanup never destroys them.

### Screen-session owner

The session owner owns:

- Session identity and generation.
- Connection observation and session state.
- Tmux target resolution and reconnect navigation decisions.
- Workmux channel creation, retirement, and cleanup.
- Diagnostic delivery and session-scoped activity.
- Generation-bound terminal, host-command, Workmux, diagnostic, and activity
  ports.

Retiring a session invalidates all its ports. Late work cannot target a
successor generation.

### Controllers

Controllers own their domain state and lifecycle. They communicate through typed
ports and identity generations, not through raw SSH resources, raw Workmux
channels, controller refs, or mutable late bindings.

Scrollback remains the only user-originated terminal-input gate.

Worktree Workspace consumes a `ShellWorkmuxPort` for command and bridge
operation requests. Its precondition and capability inputs remain explicit so it
preserves the existing messages for missing SSH and non-Workmux sessions.

### ShellDetail and ShellScreenView

`ShellDetail` may parse the route, construct owners, wire narrow ports, derive a
session view, and render. It may not own workflow state, timers, queues,
generations, cleanup ordering, native calls, SSH calls, Workmux calls, or
diagnostic event construction.

`ShellScreenView` is a real rendering boundary. It receives terminal, keyboard,
session, overlay, and modal view props, including Worktree Workspace. It owns no
remote operation or controller workflow.

## Data Flow

The main shell flow is:

```text
route parameters
    -> typed route result
    -> screen-session owner
    -> session snapshot and generation-bound ports
    -> focused controllers
    -> view props
    -> ShellScreenView
```

The Worktree Workspace action flow is:

```text
mdev menu action
    -> keyboard modal command
    -> Worktree Workspace controller
    -> ShellWorkmuxPort
    -> mdev bridge operation
    -> typed controller outcome
    -> modal props
    -> ShellScreenView
```

When session identity changes, the session retires the old ports and controller
generations invalidate in-flight work. Late results, listeners, and timers may
perform their required cleanup but may not update the new session or its UI.

## Failure Handling

- Invalid routes render the recoverable Back screen.
- Missing or recovering SSH resources produce explicit session states.
  Controllers do not manufacture fallback connections.
- Workmux commands and bridge operations return typed outcomes tied to their
  originating generation.
- Worktree Workspace preserves its existing `precondition`, `unsupported`,
  `timeout`, `stale-target`, `remote`, and `invalid-response` classifications.
  Create and close are never retried automatically.
- Wispr cleanup uncertainty blocks successor native control rather than issuing
  a blind toggle.
- Retired generations suppress late UI state while allowing their owners to
  finish required cleanup.

During reconstruction, an unexpected test failure stops the current slice. The
test assumption or refreshed plan must be corrected before production code is
transferred. Conflict resolution follows this order:

1. Preserve current `dev` behavior and public contracts.
2. Reapply the approved Stage 2 ownership internally.
3. Delete obsolete paths instead of retaining compatibility shims.

## Rollback

Each vertical slice is an implementation checkpoint. The fresh branch can be
abandoned without changing `dev` or the old Stage 2 evidence branch.

After merge, Stage 2 can be reverted as a unit before Stage 3 begins. It changes
no stored format and does not disconnect live SSH resources on screen unmount.
If a later shell stage has landed, revert dependent stages in reverse order
before reverting Stage 2.

## Test and Verification Design

### Per-slice evidence

For every reconstruction slice, record:

1. Tests added or adapted first.
2. The expected failure observed on current `dev`.
3. The production change that makes the tests pass.
4. Focused formatting, lint, type, and test results.
5. References to the original Stage 2 commits or reports.

Current `dev` test infrastructure remains authoritative. Render tests are
adapted to the accepted Expo/Jest component-test lane; the reconciliation does
not downgrade Jest or replace current configuration with the old branch's test
setup.

### Regression matrix

Focused and integration coverage must include:

- Route parsing and the recoverable error screen.
- Screen entry, re-entry, unmount, reconnect, and navigation.
- Session generations and Workmux retirement/cleanup.
- Terminal source publication, current-listener ownership, and diagnostics.
- Scrollback input gating and keyboard command routing.
- Modal arbitration and complete `ShellScreenView` rendering.
- Worktree Workspace preparation, mutation, failure classification,
  invalidation, and modal behavior through session ports.
- Wispr lifecycle, timers, cleanup serialization, blocked authority, and stale
  result suppression.

### Architecture gates

- `apps/mobile/src/app/shell/detail.tsx` remains below 650 nonblank lines.
- `ShellDetail` remains below 300 lines.
- Each new session or Wispr core/hook remains below its approved 350-nonblank-
  line limit.
- Controllers contain no raw Workmux channels or cross-controller refs.
- Production code contains no fake dependencies, render-time ref assignments,
  compatibility shims, pass-through facades, or placeholder owners.

### Final automated checks

Run the focused Stage 2 suites, mobile formatting, lint, typecheck, integration
tests, component tests, and relevant repository checks. Run repository-level
checks in an environment with Nix available. Exact commands and results belong
in the Stage 2 pull request.

Run the required thermo-nuclear maintainability review and resolve every
blocking finding before merge.

### Android preview

Build through the existing local preview lane and preserve the current signing
lane for `com.finalapp.vibe2`. Without clearing app data, verify route handling,
terminal input/output, screen re-entry, reconnect behavior, keyboard and modal
actions, Worktree Workspace behavior, and Wispr behavior.

Do not run `test:e2e:clear-state`, clear application data, edit generated
bindings, change signing lanes, publish an OTA update, or perform store rollout.

## Pull Request Evidence

The replacement Stage 2 pull request will contain:

- A slice-by-slice red/green record with exact commands and results.
- A mapping from replacement commits to original Stage 2 commits and reports.
- Focused, mobile, repository, Nix, and maintainability-review evidence.
- The non-destructive Android preview result and confirmation that application
  data and signing were preserved.
- Confirmation that the advanced mdev submenu and all accepted Worktree
  Workspace behavior remain intact.

Stage 2 is accepted only when the branch is independently usable, all required
checks pass, no maintainability blocker remains, and the pull request is linked
from issue 141.
