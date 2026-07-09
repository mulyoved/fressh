# Issue 116 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GitHub issue 116 with a verified closure comment showing that the explicit `connectAndOpenShell` aborted outcome is implemented and covered.

**Architecture:** This is issue-hygiene work, not app implementation. Re-run the focused verification from the closure-review spec, post a single GitHub closing comment with the evidence, close the issue as completed, and confirm the remote issue state.

**Tech Stack:** GitHub CLI (`gh`), pnpm, `tsx --test`, TypeScript.

## Global Constraints

- Do not change app code.
- Do not change abort cleanup behavior.
- Do not move cleanup deeper into `runSshShellLifecycle`.
- Do not add more lifecycle statuses.
- Do not run Android preview builds or device tests.
- Do not change reconnect or diagnostic policy beyond the existing explicit aborted contract.
- Keep the local git working tree clean after execution.

---

## File Structure

- Modify: GitHub issue `#116` via `gh issue close`.
- Test: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Test: `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`
- Test: TypeScript typecheck for `@fressh/mobile`.
- No local repository files should be created, modified, staged, or committed during execution.

### Task 1: Re-verify The Closure Evidence

**Files:**
- Modify: none
- Test: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Test: `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
- Test: `apps/mobile/test/integration/connection-diagnostic-runner.test.ts`
- Test: `apps/mobile/tsconfig.json`

**Interfaces:**
- Consumes: the current implementation on `dev`, which should include `ConnectAndOpenShellResult` with `{ status: 'aborted'; reason: unknown }`.
- Produces: fresh verification evidence for the GitHub issue closure comment.

- [ ] **Step 1: Confirm the local worktree is clean before issue hygiene**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Re-run focused integration coverage**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/connection-attempt-lifecycle.test.ts test/integration/connection-diagnostic-runner.test.ts
```

Expected: exits `0` and includes this summary:

```text
tests 95
pass 95
fail 0
```

- [ ] **Step 3: Re-run mobile TypeScript typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: exits `0` after `tsc`.

- [ ] **Step 4: Confirm issue 116 is still open before closing**

Run:

```bash
gh issue view 116 --json number,title,state,url
```

Expected: JSON containing:

```json
{"number":116,"state":"OPEN","title":"Give connectAndOpenShell an explicit aborted outcome"}
```

### Task 2: Post The Closure Comment And Close The Issue

**Files:**
- Modify: GitHub issue `#116`
- Test: GitHub issue `#116` state via `gh issue view`

**Interfaces:**
- Consumes: fresh verification evidence from Task 1.
- Produces: GitHub issue `#116` closed as completed with a comment explaining why.

- [ ] **Step 1: Close issue 116 with the verified evidence comment**

Run:

````bash
gh issue close 116 --reason completed --comment "$(cat <<'EOF'
Closing as completed.

Verified that the current merged code exposes the aborted late-success outcome at the public boundary requested by this issue:

- `ConnectAndOpenShellResult` includes `{ status: 'aborted'; reason: unknown }`.
- `connectAndOpenShell` returns `aborted` after cleaning up a late successful shell when the active shell lifecycle signal is aborted.
- `cleanupOnAbort: false` still preserves caller-owned cleanup and returns `connected`.
- Saved-entry adapter, recovery, connection-attempt lifecycle, and manual diagnostics all handle `aborted` explicitly instead of treating it as `tmux_attach_failed`.

Fresh verification:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/connection-attempt-lifecycle.test.ts test/integration/connection-diagnostic-runner.test.ts
```

Result: 95 tests passed, 0 failed.

```bash
pnpm --filter @fressh/mobile typecheck
```

Result: TypeScript completed successfully.
EOF
)"
````

Expected: exits `0` and prints successful close output.

- [ ] **Step 2: Confirm issue 116 is closed**

Run:

```bash
gh issue view 116 --json number,title,state,url
```

Expected: JSON containing:

```json
{"number":116,"state":"CLOSED","title":"Give connectAndOpenShell an explicit aborted outcome"}
```

- [ ] **Step 3: Confirm the local worktree stayed clean**

Run:

```bash
git status --short
```

Expected: no output.
