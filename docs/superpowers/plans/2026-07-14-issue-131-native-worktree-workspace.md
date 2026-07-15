# Issue 131 Native Worktree Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Fressh actions under `Cmds > mdev` that create and close
mdev worktree workspaces without exposing tmux prompts or confirmation UI.

**Architecture:** Extract mdev's existing worktree mutations into target-aware
domain functions, expose them through four strict optional bridge operations,
then add a generation-guarded Fressh controller and native modal as the only
mobile presentation layer. Existing `Alt+n`, `Shift+Alt+N`, tmux palette, and
CLI flows remain presentation adapters over the same mdev domain behavior.

**Tech Stack:** Bun, TypeScript, Zod, tmux, Worktrunk, Expo React Native, React
19, Node test runner, pnpm, Turbo.

## Global Constraints

- Implement in two isolated worktrees by invoking the `using-git-worktrees`
  skill before Task 1:
  - mdev repository: `/home/muly/skills`
  - Fressh repository: `/home/muly/code/fressh`
- Do not modify the current `/home/muly/skills` checkout on its unrelated
  `feature/skill-flow-friction-reduction` branch.
- Commit mdev changes in the mdev repository and Fressh changes in the Fressh
  repository. Do not create a cross-repository commit.
- Roll out and verify mdev before the Fressh client. An old mdev must fail only
  the selected feature action with the standard update message; it must not make
  the whole bridge unavailable.
- Do not change generated files under any `src/generated` or `cpp/generated`
  directory.
- Do not add terminal text, byte, paste, generic shell-execution, or
  keyboard-button implementations for these actions.
- Do not add an Open Worktree Workspace action.
- Preserve current behavior and bindings for `Alt+n`, `Shift+Alt+N`, the tmux
  palette, and `mdev tmux worktree` CLI commands.
- Resolve actions from any mdev tmux role window, including home, Claude, Codex,
  Git, and Bash roles.
- Do not run `test:e2e:clear-state`, clear `com.finalapp.vibe2` app data, or
  automate a destructive close against a personal workspace.
- Use exact operation timeouts of 60,000 ms. Never automatically retry create or
  close.

## Binding Plan Contract

### Bridge protocol

The new operation IDs and wire types are:

```ts
type WorktreeWorkspaceWindow = Readonly<{
	id: string;
	name: string;
}>;

type NewWorktreeWorkspacePreparation = Readonly<{
	target: string;
	repositoryName: string;
	projectRoot: string;
	suggestedBranch: string;
}>;

type CloseWorktreeWorkspacePreparation = Readonly<{
	session: string;
	workspaceId: string;
	workspaceLabel: string;
	worktreePath: string;
	closeFingerprint: string;
	windows: readonly WorktreeWorkspaceWindow[];
}>;
```

| Operation                     | Request params                                                                                             | Result                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `tmux.worktree.new.prepare`   | `{ target: string }`                                                                                       | `NewWorktreeWorkspacePreparation`   |
| `tmux.worktree.new`           | `{ target: string; expectedProjectRoot: string; branch: string }`                                          | `{ status: 'created' }`             |
| `tmux.worktree.close.prepare` | `{ target: string }`                                                                                       | `CloseWorktreeWorkspacePreparation` |
| `tmux.worktree.close`         | `{ session: string; workspaceId: string; expectedWorktreePath: string; expectedCloseFingerprint: string }` | `{ status: 'closed' }`              |

All request objects use strict Zod schemas and reject unknown keys. All result
parsers reject missing keys, unknown keys, invalid status strings, empty window
sets, and fingerprints outside `^sha256:[0-9a-f]{64}$`. `expectedProjectRoot` is
an equality guard only; the project root resolved from `target` is always the
execution root.

The close fingerprint is exactly:

```ts
`sha256:${createHash('sha256')
	.update(
		JSON.stringify({
			session,
			workspaceId,
			windowIds: [...windowIds].sort(),
		}),
	)
	.digest('hex')}`;
```

The four operations are optional capabilities. Do not add them to mdev's global
required hello-operation list or Fressh's `MDEV_BRIDGE_REQUIRED_OPERATION_IDS`.

### mdev domain boundaries

Create `dev-env/mdev/src/lib/tmux/worktree-workspace.ts` in `/home/muly/skills`
with these exports:

```ts
export type WorktreeWorkspaceContext = Readonly<{
	env: Record<string, string | undefined>;
	tmux: TmuxRunner;
	exec: (command: string, args: string[]) => Promise<ExecResult>;
	addEnvWindow: (
		tmux: TmuxRunner,
		options: AddEnvOptions,
		home: string,
	) => Promise<string | void>;
}>;

export function prepareNewWorktreeWorkspace(
	target: string,
	context: WorktreeWorkspaceContext,
): Promise<NewWorktreeWorkspacePreparation>;

export function createWorktreeWorkspace(
	input: Readonly<{
		target: string;
		expectedProjectRoot: string;
		branch: string;
	}>,
	context: WorktreeWorkspaceContext,
): Promise<Readonly<{ status: 'created' }>>;

export function prepareCloseWorktreeWorkspace(
	target: string,
	context: WorktreeWorkspaceContext,
): Promise<CloseWorktreeWorkspacePreparation>;

export function closeWorktreeWorkspace(
	input: Readonly<{
		session: string;
		workspaceId: string;
		expectedWorktreePath: string;
		expectedCloseFingerprint: string;
	}>,
	context: WorktreeWorkspaceContext,
): Promise<Readonly<{ status: 'closed' }>>;

export function worktreeCloseFingerprint(
	input: Readonly<{
		session: string;
		workspaceId: string;
		windowIds: readonly string[];
	}>,
): string;
```

`prepareNewWorktreeWorkspace` and `prepareCloseWorktreeWorkspace` are read-only.
Create performs all target/project validation before Worktrunk, creates the
environment window, writes its worktree metadata, and reads that metadata back
before reporting success. Close re-resolves the window set and path, validates
both guards before Worktrunk removal, removes the worktree before killing
windows, and verifies every captured window ID is absent before reporting
success.

Use these stable stale-target errors:

```text
Worktree creation target changed; refusing stale project context
Worktree close target changed; refusing stale workspace window set
Worktree close target changed; refusing to remove stale worktree path
```

### Fressh controller contract

Create these controller phases in
`apps/mobile/src/lib/shell-controllers/worktree-workspace-contracts.ts`:

```ts
export type WorktreeWorkspaceState =
	| Readonly<{ phase: 'idle' }>
	| Readonly<{
			phase: 'preparing-new';
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'editing-new';
			preparation: NewWorktreeWorkspacePreparation;
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'creating';
			preparation: NewWorktreeWorkspacePreparation;
	  }>
	| Readonly<{
			phase: 'preparing-close';
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'confirming-close';
			preparation: CloseWorktreeWorkspacePreparation;
			error?: WorktreeWorkspaceFailure;
	  }>
	| Readonly<{
			phase: 'closing';
			preparation: CloseWorktreeWorkspacePreparation;
	  }>;

export type WorktreeWorkspaceFailure = Readonly<{
	kind:
		| 'precondition'
		| 'unsupported'
		| 'timeout'
		| 'stale-target'
		| 'remote'
		| 'invalid-response';
	message: string;
}>;
```

The core API is:

```ts
export type WorktreeWorkspaceCore = Readonly<{
	getState(): WorktreeWorkspaceState;
	openNew(): void;
	openClose(): void;
	retry(): void;
	create(branch: string): Promise<ControllerOutcome<WorktreeWorkspaceFailure>>;
	confirmClose(): Promise<ControllerOutcome<WorktreeWorkspaceFailure>>;
	close(): boolean;
	setSourceKey(sourceKey: unknown): void;
	invalidate(reason: ControllerInvalidationReason): void;
}>;
```

The controller checks connection and Workmux preconditions before opening. The
modal opens in the relevant preparing phase only after the command menu has
closed. A generation check follows every asynchronous boundary. Only one
preparation or mutation request may be active. Closing the modal or changing
connection, session, target, or Workmux state invalidates the generation and
suppresses late results.

Preparation failure stays in its preparing phase and exposes Retry. Create
failure returns to `editing-new` and preserves the user's branch draft. Every
close failure returns to `preparing-close`; Retry must obtain a fresh preview
rather than redisplay the stale one. Successful create or close returns silently
to `idle`.

Use these user-visible messages:

```text
No SSH connection available.
Workmux actions require a Workmux-enabled connection.
Worktree workspace request timed out. The remote operation may have completed; inspect the workspace list before trying again.
Invalid worktree workspace bridge response.
Task branch is required.
```

Unsupported-operation failures map to the existing `MDEV_BRIDGE_UPDATE_MESSAGE`.
Remote stale-target messages map to `stale-target`; other sanitized bridge
errors map to `remote`. `create(branch)` trims before building the bridge
request and rejects an empty result locally in `editing-new` with
`Task branch is required.` and zero bridge calls. The component retains its
untrimmed draft so a remote failure does not rewrite the user's input.

### Native modal contract

`WorktreeWorkspaceModal` owns only the editable branch draft. The controller
owns all remote state. The modal renders:

- New preparation: native activity indicator and Cancel.
- New editing: repository label, `Task branch` native text input initialized
  from `suggestedBranch`, Create, and Cancel.
- New submission: preserved disabled text input, disabled Create and Cancel,
  activity indicator, and no dismiss-by-backdrop.
- Close preparation: native activity indicator and Cancel.
- Close confirmation: workspace label, worktree path, window count, complete
  window name list, Remove Worktree, and Cancel.
- Close submission: preserved preview, disabled Remove Worktree and Cancel,
  activity indicator, and no dismiss-by-backdrop.
- Preparation errors: inline error, Retry, and Cancel.
- Create errors: inline error beside the preserved draft, Create, and Cancel.

The draft resets only when the modal closes or a newly prepared
`{ target, projectRoot }` pair differs. It does not reset across
`editing-new -> creating -> editing-new`.

### External-state safety checklist

- Preflight reads: resolve target metadata before create; resolve workspace
  identity, close set, and path before close.
- TOCTOU guards: compare `expectedProjectRoot`; compare a freshly computed
  fingerprint and freshly read path before any close mutation.
- Zero-write failures: schema, precondition, target, project-root, window-set,
  and path failures occur before Worktrunk, metadata writes, or tmux kills.
- Ordering: create is Worktrunk switch, environment window, metadata write,
  metadata readback. Close is fresh validation, Worktrunk remove, tmux window
  kills, absence readback.
- Retries and idempotence: prepare is safely retryable; create and close are not
  automatically retried and are user-initiated each time.
- Indeterminate outcomes: transport loss or timeout during create/close displays
  the explicit inspection warning and does not claim success or failure.
- Readback: successful create requires exact metadata equality; successful close
  requires all captured window IDs to be absent.
- Bounded behavior: one in-flight request, 60-second transport timeout, no
  polling loop, no recursive retry.
- Secret-safe output: surface only sanitized `CliError`/bridge messages. Never
  include environment values, command stdout, raw Worktrunk JSON, or SSH
  credentials. The worktree path is intentional confirmation data.

## Illustrative Implementation Guidance

No production sketch overrides the binding interfaces above. Prefer moving the
existing command bodies into named domain functions and retaining the CLI
command module as a thin prompt/confirmation adapter, so the native bridge and
existing tmux surfaces cannot drift in mutation semantics.

---

### Task 1: Extract target-aware new-worktree domain behavior

**Repository:** `/home/muly/skills`

**Files:**

- Create: `dev-env/mdev/src/lib/tmux/worktree-workspace.ts`
- Modify: `dev-env/mdev/src/commands/tmux/worktree.ts`
- Modify: `dev-env/mdev/src/lib/tmux/worktree-metadata.ts`
- Test: `dev-env/mdev/test/tmux-worktree.test.ts`
- Create: `dev-env/mdev/test/tmux-worktree-workspace.test.ts`

**Interfaces:** Implement `prepareNewWorktreeWorkspace`,
`createWorktreeWorkspace`, and the shared types from the binding contract. Add
`readWorktreeWorkspacePathAtTarget(tmux, target)` for metadata readback.

**Invariants:** Existing CLI prompts and `new`/`open` behavior are unchanged.
`expectedProjectRoot` never selects the execution directory. Empty or
whitespace-only branches fail before Worktrunk. Metadata readback must match the
created path exactly.

**Acceptance:** Domain tests cover target-aware preparation, suggested branch,
create versus existing-branch switch, stale project root, invalid branch,
Worktrunk failure, environment-window failure, metadata-write failure, readback
mismatch, and success from home, Claude, Codex, Git, and Bash targets. Existing
new/open CLI tests remain green.

- [ ] Create the isolated `/home/muly/skills` worktree and confirm
      `git status --short` is empty there.
- [ ] Add failing unit tests in `tmux-worktree-workspace.test.ts` using fake
      `TmuxRunner`, `exec`, and `addEnvWindow` ports. Assert that stale-project
      and invalid-branch cases record zero Worktrunk, window, and metadata
      mutations.
- [ ] Run `cd dev-env/mdev && bun test test/tmux-worktree-workspace.test.ts` and
      confirm the new tests fail because the domain module does not exist.
- [ ] Move project resolution, `branchPromptSeed`, Worktrunk switch,
      environment-window creation, and metadata persistence from the command
      module into the new domain module.
- [ ] Add target-specific metadata readback and reject a mismatch before
      returning `{ status: 'created' }`.
- [ ] Refactor the CLI `promptNew`, `promptOpen`, and branch-value paths to call
      the domain functions while retaining their current prompts, messages, and
      arguments.
- [ ] Run
      `cd dev-env/mdev && bun test test/tmux-worktree-workspace.test.ts test/tmux-worktree.test.ts`
      and confirm all tests pass.
- [ ] Commit in `/home/muly/skills` with subject
      `Extract worktree workspace creation domain`.

### Task 2: Extract safe close preview and guarded mutation

**Repository:** `/home/muly/skills`

**Files:**

- Modify: `dev-env/mdev/src/lib/tmux/worktree-workspace.ts`
- Modify: `dev-env/mdev/src/lib/tmux/workspace-close.ts`
- Modify: `dev-env/mdev/src/commands/tmux/worktree.ts`
- Modify: `dev-env/mdev/test/tmux-worktree-workspace.test.ts`
- Modify: `dev-env/mdev/test/tmux-worktree.test.ts`
- Modify: `dev-env/mdev/test/tmux-workspace.test.ts`

**Interfaces:** Implement `prepareCloseWorktreeWorkspace`,
`closeWorktreeWorkspace`, and `worktreeCloseFingerprint`. Extend
`readCurrentWorkspaceCloseIdentity(tmux, target?: string)` so bridge calls
resolve an explicit target and existing CLI calls retain current-target
behavior.

**Invariants:** Preview is read-only. Fingerprints use sorted window IDs and
ignore display order. Close re-resolves both set and path immediately before
mutation. Worktrunk removal precedes all window kills. A Worktrunk failure kills
zero windows. Success requires absence readback for every captured window ID.

**Acceptance:** Tests cover explicit target resolution, deterministic
fingerprinting, full preview content, non-workspace target, missing path, stale
set, stale path, Worktrunk failure, partial tmux kill failure, absence-readback
failure, vanished session after successful kills, and success. The CLI
confirmation remains tmux-native and its visible behavior is unchanged.

- [ ] Add failing close-domain tests, including assertions that stale
      fingerprint and stale path perform zero Worktrunk or kill calls.
- [ ] Run
      `cd dev-env/mdev && bun test test/tmux-worktree-workspace.test.ts test/tmux-workspace.test.ts`
      and confirm the new tests fail.
- [ ] Make workspace identity lookup accept an optional explicit target without
      changing its default argv.
- [ ] Implement preview assembly and SHA-256 fingerprint generation exactly as
      defined in the binding contract.
- [ ] Implement close revalidation, ordered removal/kills, and final absence
      readback.
- [ ] Refactor `promptClose` and `worktree-close-confirmed` to use the shared
      domain. Carry the captured path and fingerprint through the confirmed
      callback arguments while preserving the existing tmux confirmation
      surface.
- [ ] Run
      `cd dev-env/mdev && bun test test/tmux-worktree-workspace.test.ts test/tmux-worktree.test.ts test/tmux-workspace.test.ts`
      and confirm all tests pass.
- [ ] Commit in `/home/muly/skills` with subject
      `Guard worktree workspace closure`.

### Task 3: Publish the four optional mdev bridge operations

**Repository:** `/home/muly/skills`

**Files:**

- Create: `dev-env/mdev/src/lib/tmux/operations/worktree.ts`
- Modify: `dev-env/mdev/src/lib/operations/registry.ts`
- Create: `dev-env/mdev/test/tmux-worktree-operations.test.ts`
- Modify: `dev-env/mdev/test/bridge.test.ts`
- Verify: `dev-env/mdev/test/tmux-bootstrap.test.ts`
- Verify: `dev-env/mdev/test/tmux-palette.test.ts`
- Verify: `dev-env/mdev/test/tmux-command-boundary.test.ts`

**Interfaces:** Export `TMUX_WORKTREE_OPERATION_SPECS`, containing the exact
four operation IDs and strict request/result schemas from the binding contract.
Operation handlers adapt `OperationContext` to `WorktreeWorkspaceContext` and
call no presentation APIs.

**Invariants:** The operations appear in bridge hello only when registered, but
are not globally required. No handler calls tmux prompt, tmux confirmation,
terminal input, or a generic command string supplied by Fressh. Handler output
is one JSON result object.

**Acceptance:** Tests prove strict validation, exact operation names, exact
domain input mapping, exact result mapping, sanitized failures, and updated
hello capability enumeration. Existing binding, palette, and command-boundary
tests prove shortcut behavior remains unchanged.

- [ ] Add failing operation tests with injected domain dependencies for all four
      success paths and at least one unknown-key rejection per request schema.
- [ ] Update the exact bridge hello expectation with the four capability IDs,
      without changing the required-operation fixture.
- [ ] Run
      `cd dev-env/mdev && bun test test/tmux-worktree-operations.test.ts test/bridge.test.ts`
      and confirm the new expectations fail.
- [ ] Implement the strict schemas, specs, and registry composition.
- [ ] Run
      `cd dev-env/mdev && bun test test/tmux-worktree-operations.test.ts test/bridge.test.ts test/tmux-bootstrap.test.ts test/tmux-palette.test.ts test/tmux-command-boundary.test.ts`.
- [ ] Run `cd dev-env/mdev && bun run typecheck`.
- [ ] Run `cd dev-env/mdev && bun test` and retain the passing output for final
      verification.
- [ ] Commit in `/home/muly/skills` with subject
      `Expose worktree workspace bridge operations`.

### Task 4: Add strict Fressh bridge request and response adapters

**Repository:** `/home/muly/code/fressh`

**Files:**

- Create: `apps/mobile/src/lib/worktree-workspace-bridge.ts`
- Create: `apps/mobile/test/integration/worktree-workspace-bridge.test.ts`
- Reference: `apps/mobile/src/lib/workmux-control-channel.ts`
- Reference: `apps/mobile/src/lib/mdev-bridge-client.ts`
- Reference: `apps/mobile/src/lib/workmux-bridge-operations.ts`

**Interfaces:** Export four operation constants,
`WORKTREE_WORKSPACE_OPERATION_TIMEOUT_MS = 60_000`, exact request builders,
exact result types, and strict Zod output parsers. Each builder returns
`MdevBridgeOperationRequest` and each parser returns the corresponding
binding-contract result.

**Invariants:** Requests contain only the named string fields. Parsing accepts
the bridge's single JSON result plus its terminating newline and rejects
malformed JSON, trailing non-whitespace, unknown keys, wrong statuses, invalid
fingerprints, and empty close window sets. This module does not perform network
calls or own UI state.

**Acceptance:** Table-driven tests cover the exact request object for every
operation, every valid result, and each invalid-response category. Parser
failures use exactly `Invalid worktree workspace bridge response.`

- [ ] Write failing table-driven builder and parser tests.
- [ ] Run
      `cd apps/mobile && pnpm exec tsx --test test/integration/worktree-workspace-bridge.test.ts`
      and confirm failure because the module does not exist.
- [ ] Implement constants, types, builders, strict schemas, and parsers.
- [ ] Run the focused test and confirm it passes.
- [ ] Commit in `/home/muly/code/fressh` with subject
      `Add worktree workspace bridge contracts`.

### Task 5: Build the generation-safe worktree workspace controller

**Repository:** `/home/muly/code/fressh`

**Files:**

- Create:
  `apps/mobile/src/lib/shell-controllers/worktree-workspace-contracts.ts`
- Create: `apps/mobile/src/lib/shell-controllers/worktree-workspace-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/worktree-workspace-adapter.ts`
- Create: `apps/mobile/src/lib/shell-controllers/worktree-workspace.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/modal-arbiter.ts`
- Create:
  `apps/mobile/test/integration/shell-worktree-workspace-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-modal-controller-composition.test.ts`

**Interfaces:** Implement `WorktreeWorkspaceCore` and state/failure types
exactly as bound above. The adapter's committed dependencies are `connection`,
`tmuxEnabled`, `sessionName`, `sourceKey`, `workmuxControlChannel`, and
`arbiter`. Resolve `target` with existing
`buildWorkmuxAppContextArgv`/`parseWorkmuxAppContextOutput`, then call the four
operation builders with a 60-second timeout. Register modal ID
`'worktree-workspace'`.

**Invariants:** Precondition failures issue zero bridge calls. The arbiter
closes competing shell modals before preparation begins. Generation checks
follow target resolution and operation calls. Create/close admit one mutation
request, never automatically retry, suppress late results after invalidation,
and expose the exact phase/error transitions in the binding contract.

**Acceptance:** Pure controller tests cover both preconditions, denied arbiter
admission, every successful transition, preparation retry, create trimming,
local empty-value rejection, create draft-preserving failure, close
fresh-preview failure, unsupported mdev, timeout ambiguity, malformed response,
stale target, ordinary remote error, double-submit rejection, close refusal
during mutation, source changes, explicit invalidation, and late completion
suppression. Adapter tests assert exact command/operation calls and zero
terminal input APIs.

- [ ] Add `'worktree-workspace'` to `ShellModalId` and extend the arbiter
      composition test with conflict closure and blocked-open cases.
- [ ] Write failing controller tests with deferred promises and call-recording
      ports. Assert the state after every transition, not only the final state.
- [ ] Run
      `cd apps/mobile && pnpm exec tsx --test test/integration/shell-worktree-workspace-controller.test.ts test/integration/shell-modal-controller-composition.test.ts`
      and confirm the controller test fails because its modules do not exist.
- [ ] Implement the contracts and pure core using existing `ControllerOutcome`
      and generation lifecycle primitives.
- [ ] Implement the adapter with exact failure classification and a 60-second
      operation timeout.
- [ ] Implement the React hook as a facade over the core/adapter, including
      arbiter registration and source synchronization.
- [ ] Run the two focused tests and confirm they pass.
- [ ] Commit in `/home/muly/code/fressh` with subject
      `Add worktree workspace controller`.

### Task 6: Implement the native worktree workspace modal

**Repository:** `/home/muly/code/fressh`

**Files:**

- Create: `apps/mobile/src/app/shell/components/WorktreeWorkspaceModal.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/worktree-workspace.tsx`
- Create: `apps/mobile/test/integration/worktree-workspace-modal.test.ts`

**Interfaces:** Export a discriminated `WorktreeWorkspaceModalProps` union with
closed, new, and close modes. The controller hook maps its domain phases to
these props and exposes `openNew`/`openClose` commands for keyboard composition.

**Invariants:** All input and confirmation UI is native React Native. The modal
sends no tmux keystrokes. Branch draft ownership and reset behavior match the
native modal contract. Backdrop/back dismissal is blocked only while creating or
closing. Submission buttons are disabled while active and double submission is
impossible.

**Acceptance:** Tests verify the discriminated prop mapping for every controller
phase, exact `Task branch` and `Remove Worktree` labels, path/window
count/window list preview content, Retry routing, cancel behavior, draft
initialization/reset/preservation, disabled submission controls, and no
terminal-input imports or callbacks.

- [ ] Add failing modal-prop mapping tests for all seven controller phases and a
      focused source/render contract test for native controls and labels.
- [ ] Run
      `cd apps/mobile && pnpm exec tsx --test test/integration/worktree-workspace-modal.test.ts`
      and confirm failure because the component does not exist.
- [ ] Implement the modal using React Native `Modal`, `KeyboardAvoidingView`,
      `TextInput`, `ActivityIndicator`, and existing shell visual tokens.
- [ ] Extend the hook with stable modal callbacks and phase mapping that leaves
      the editable draft owned by the component.
- [ ] Run the focused modal and controller tests and confirm they pass.
- [ ] Commit in `/home/muly/code/fressh` with subject
      `Add native worktree workspace modal`.

### Task 7: Wire command actions, menu configuration, and ShellDetail

**Repository:** `/home/muly/code/fressh`

**Files:**

- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-controller-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-hook-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`
- Modify: `apps/mobile/test/integration/command-menu.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts`
- Modify: `apps/mobile/test/integration/shell-keyboard-hook-composition.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

**Interfaces:** Add known action IDs `OPEN_NEW_WORKTREE_WORKSPACE` and
`OPEN_CLOSE_WORKTREE_WORKSPACE`. Extend `ActionContext` and
`ShellKeyboardModalCommands` with `openNewWorktreeWorkspace()` and
`openCloseWorktreeWorkspace()`. ShellDetail constructs one worktree controller,
passes its commands into keyboard composition, and renders one
`WorktreeWorkspaceModal`.

**Invariants:** `runAction` delegates only to the native controller callbacks
for both IDs. It never calls `sendBytes`, paste, or `runWorkmuxKeyboardCommand`.
Command-menu dispatch closes the command menu before calling either open method.
Source identity includes connection, active tmux session, resolved target
context, and Workmux enablement.

**Acceptance:** `Cmds > mdev` contains exactly these entries after Rename
Workspace and before Codex authentication entries:

```json
{
	"type": "action",
	"label": "New Worktree Workspace",
	"actionId": "OPEN_NEW_WORKTREE_WORKSPACE"
},
{
	"type": "action",
	"label": "Close Worktree Workspace",
	"actionId": "OPEN_CLOSE_WORKTREE_WORKSPACE"
}
```

Configuration version becomes `2026-07-14.2` and `updatedAt` becomes
`2026-07-14T15:00:00.000Z`. Composition tests prove both callbacks reach the one
controller instance and the modal receives its props.

- [ ] Add failing action-routing tests that use counters for the two native
      callbacks and throwing spies for terminal-byte, paste, and Workmux command
      ports.
- [ ] Update command-menu and config tests with the exact two entries, order,
      version, and timestamp.
- [ ] Update composition fixtures with the two required modal callbacks and add
      failing ShellDetail source assertions for controller construction,
      callback wiring, and modal rendering.
- [ ] Run
      `cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts test/integration/command-menu.test.ts test/integration/shell-keyboard-controller-composition.test.ts test/integration/shell-keyboard-hook-composition.test.ts test/integration/shell-detail-workmux-control-channel.test.ts`
      and confirm the new assertions fail.
- [ ] Implement the action IDs and callback routing.
- [ ] Update shell config with the exact entries and metadata.
- [ ] Construct the worktree controller after active session and control-channel
      creation in `detail.tsx`, include all competing modal IDs in its arbiter
      conflict set, wire its callbacks through keyboard composition, and render
      its modal beside the other shell modals.
- [ ] Run the focused integration command and confirm all tests pass.
- [ ] Run `cd apps/mobile && pnpm run validate:shell-config`.
- [ ] Commit in `/home/muly/code/fressh` with subject
      `Wire native worktree workspace commands`.

### Task 8: Verify cross-repository behavior and rollout safety

**Repositories:** `/home/muly/skills` and `/home/muly/code/fressh`

**Files:**

- Verify: all files changed in Tasks 1 through 7
- Reference:
  `docs/superpowers/specs/2026-07-14-issue-131-native-worktree-workspace-design.md`

**Interfaces:** No new interfaces. This task verifies that the published mdev
protocol and consumed Fressh protocol are byte-for-byte compatible.

**Invariants:** mdev is installed or deployed before a Fressh build containing
the actions. Old mdev behavior is a scoped update error. Existing CLI and tmux
shortcuts remain operational. Manual smoke testing uses a disposable
repository/workspace and does not clear application data.

**Acceptance:** Both repositories are clean except for intended commits;
complete tests/typechecks pass; direct contract comparison finds no field or
operation drift; manual smoke proves native naming, preview, create, close,
cancellation, and old-mdev error UX.

- [ ] In `/home/muly/skills/dev-env/mdev`, run `bun test` and
      `bun run typecheck` from a clean working tree.
- [ ] In `/home/muly/code/fressh`, run
      `pnpm --filter @fressh/mobile test:integration`.
- [ ] Run `pnpm --filter @fressh/mobile typecheck`,
      `pnpm --filter @fressh/mobile lint:check`,
      `pnpm --filter @fressh/mobile fmt:check`, and
      `pnpm --filter @fressh/mobile validate:shell-config`.
- [ ] From `/home/muly/code/fressh`, run `pnpm exec turbo lint:check` and
      inspect failures before attributing them to this change.
- [ ] Compare the four operation IDs, request fields, response fields, status
      literals, and fingerprint format directly between
      `dev-env/mdev/src/lib/tmux/operations/worktree.ts` and
      `apps/mobile/src/lib/worktree-workspace-bridge.ts`.
- [ ] Install the verified mdev build on a disposable SSH target before
      installing or updating the Fressh client.
- [ ] Using a disposable Git repository, confirm New Worktree Workspace opens a
      native prefilled name dialog, Cancel performs no remote write, Create
      makes the expected workspace/worktree, and failures preserve the entered
      name.
- [ ] In that disposable workspace, confirm Close Worktree Workspace shows the
      native path and full window list, Cancel performs no remote write, Close
      removes the worktree and all captured windows, and a stale preview
      requires a fresh Retry.
- [ ] Against a target with an older mdev, confirm only either worktree action
      reports `MDEV_BRIDGE_UPDATE_MESSAGE` and unrelated mdev bridge actions
      still work.
- [ ] Confirm `Alt+n`, `Shift+Alt+N`, the tmux palette, and CLI new/open/close
      still present their existing tmux UI and complete successfully.
- [ ] Invoke the `verification-before-completion` skill, retain command output,
      and only then report the implementation complete.
