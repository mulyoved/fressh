# Local Agent Config Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale repository-local agent, prompt, context, editor, and CI configuration while keeping only approved Fressh-specific Codex skills.

**Architecture:** Treat `.codex/skills` as the only repository-local skill surface. Remove shared workflow skills and prompts from the Git index, then clean local symlinks without touching global skill directories. Documentation cleanup removes stale local-path references while allowing this cleanup spec and plan to preserve the audit trail.

**Tech Stack:** Git index operations, shell verification commands, Markdown documentation.

## Global Constraints

- Keep `.codex/skills/expo-deployment`.
- Keep `.codex/skills/upgrading-expo`.
- Keep `.codex/skills/qa-testing-android`.
- Keep `.codex/skills/ios-android-logs`.
- Keep `.codex/skills/modify-mobile-keyboard`.
- Remove `.agents`, `app/.agents`, `.claude`, `.codex/prompts`, `.ai`, `.vscode`, and `.github` from the repository.
- Do not remove or alter `~/.codex/skills`, `~/.claude/skills`, or `/home/muly/code/skills/skills`.
- Do not change application source code, package manager config, mobile build config, or generated artifacts.
- This plan and `docs/superpowers/specs/2026-07-08-local-agent-config-cleanup-design.md` may mention removed paths as cleanup records; other current docs should not point at removed local paths.

---

## File Structure

- Remove: `.agents/skills/**`
  - Old tracked entries for shared and workflow skills. These entries are marked `skip-worktree`, and the working tree path is a symlink to global state, so removal must be index-safe.
- Remove: `app/.agents/**`
  - Old app-local OpenClaw-style skill copies.
- Remove: `.claude/**`
  - Repo-local Claude commands and skill links.
- Remove: `.codex/prompts/**`
  - Inherited prompt files not active on this machine.
- Remove: `.ai/**`
  - Stale scratch/context XML and ignored tmp files.
- Remove: `.vscode/**`
  - Repo editor settings, launch config, and extension recommendations.
- Remove: `.github/**`
  - GitHub Actions workflow and disabled release workflow.
- Keep: `.codex/skills/**`
  - Fressh-specific local Codex skills.
- Modify: `AGENTS.md`
  - Remove the obsolete claim that CI uses `.github/workflows/check.yml`.
- Modify: `.codex/skills/qa-testing-android/SKILL.md`
  - Keep the Android CI example, but stop naming a repository-local `.github/workflows` path.
- Modify: `docs/superpowers/specs/2026-05-25-tmux-skill-selector-design.md`
  - Make the historical skill selector design align with the new `.codex/skills`-only local discovery rule.
- Delete stale historical implementation docs that hard-code removed `.agents/skills` paths:
  - `docs/superpowers/plans/2026-05-14-android-host-browser-keyboard-actions.md`
  - `docs/superpowers/plans/2026-05-21-browser-key-long-press-actions.md`
  - `docs/superpowers/plans/2026-05-25-tmux-skill-selector.md`
  - `docs/superpowers/plans/2026-05-29-mobile-browser-action-menu.md`
  - `docs/superpowers/plans/2026-06-01-mobile-mdev-workmux-boundary.md`
  - `docs/superpowers/plans/2026-07-02-long-session-convergence-rules.md`
  - `docs/superpowers/specs/2026-07-02-long-session-convergence-rules-design.md`

### Task 1: Remove Obsolete Local Tooling Folders

**Files:**
- Remove: `.agents/skills/**`
- Remove: `app/.agents/**`
- Remove: `.claude/**`
- Remove: `.codex/prompts/**`
- Remove: `.ai/**`
- Remove: `.vscode/**`
- Remove: `.github/**`

**Interfaces:**
- Consumes: Approved keep/remove policy from `docs/superpowers/specs/2026-07-08-local-agent-config-cleanup-design.md`.
- Produces: A Git index that no longer tracks obsolete local tooling folders, while global skill directories remain untouched.

- [ ] **Step 1: Confirm the tracked removal set before editing**

Run:

```bash
git ls-files .agents .claude app/.agents .codex/prompts .ai .vscode .github | sed -n '1,260p'
```

Expected: Output includes tracked files under all seven removal roots:
`.agents`, `.claude`, `app/.agents`, `.codex/prompts`, `.ai`, `.vscode`, and
`.github`.

- [ ] **Step 2: Confirm the symlink roots before index-safe removal**

Run:

```bash
test -L .agents && readlink .agents
test -L .claude/skills && readlink .claude/skills
```

Expected:

```text
../.agents
../../.claude/skills
```

- [ ] **Step 3: Clear skip-worktree flags for tracked symlink-backed entries**

Run:

```bash
git ls-files -z .agents .claude/skills | xargs -0 -r git update-index --no-skip-worktree --
git ls-files -v .agents .claude/skills | sed -n '1,80p'
```

Expected: The second command shows entries starting with `H` instead of `S`.

- [ ] **Step 4: Remove symlink-backed tracked entries from the Git index only**

Run:

```bash
git rm --cached -r -- .agents .claude/skills
```

Expected: Git stages deletions for `.agents/skills/**` and `.claude/skills/**`
without deleting `/home/muly/code/skills/skills`, `~/.codex/skills`, or
`~/.claude/skills`.

- [ ] **Step 5: Remove tracked local-only folders from the index and worktree**

Run:

```bash
git rm -r -- .ai/context .claude/commands .codex/prompts .github .vscode app/.agents
```

Expected: Git stages deletions for tracked local-only files under those paths.

- [ ] **Step 6: Remove leftover untracked local directories and symlinks**

Run:

```bash
rm -rf .agents .ai .claude
test ! -e .agents
test ! -e .ai
test ! -e .claude
test -d /home/muly/code/skills/skills
test -d /home/muly/.codex/skills
test -d /home/muly/.claude/skills
```

Expected: The removed repository-local paths do not exist, and all three
global/user skill roots still exist.

- [ ] **Step 7: Verify only the approved local Codex skills remain**

Run:

```bash
find .codex/skills -mindepth 2 -maxdepth 2 -name SKILL.md -printf '%h\n' | sort
```

Expected exactly:

```text
.codex/skills/expo-deployment
.codex/skills/ios-android-logs
.codex/skills/modify-mobile-keyboard
.codex/skills/qa-testing-android
.codex/skills/upgrading-expo
```

- [ ] **Step 8: Commit the folder removals**

Run:

```bash
git status --short
git add -u
git commit -m "Remove obsolete local agent config"
```

Expected: Commit succeeds and includes only folder removals from the paths in
this task.

### Task 2: Clean Stale Local Path References From Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `.codex/skills/qa-testing-android/SKILL.md`
- Modify: `docs/superpowers/specs/2026-05-25-tmux-skill-selector-design.md`
- Delete: `docs/superpowers/plans/2026-05-14-android-host-browser-keyboard-actions.md`
- Delete: `docs/superpowers/plans/2026-05-21-browser-key-long-press-actions.md`
- Delete: `docs/superpowers/plans/2026-05-25-tmux-skill-selector.md`
- Delete: `docs/superpowers/plans/2026-05-29-mobile-browser-action-menu.md`
- Delete: `docs/superpowers/plans/2026-06-01-mobile-mdev-workmux-boundary.md`
- Delete: `docs/superpowers/plans/2026-07-02-long-session-convergence-rules.md`
- Delete: `docs/superpowers/specs/2026-07-02-long-session-convergence-rules-design.md`

**Interfaces:**
- Consumes: Task 1 removes the local folders, so docs must not direct future workers to those paths.
- Produces: Current docs and retained historical specs no longer point at removed local agent/config paths, except the cleanup spec and this plan.

- [ ] **Step 1: Update `AGENTS.md` PR guidance**

In `AGENTS.md`, replace this text:

```markdown
- PRs should describe the change, include testing notes, and ensure
  lint/typecheck/tests pass (CI uses `.github/workflows/check.yml`). Add
  screenshots for UI changes (mobile/web) and link relevant issues.
```

with:

```markdown
- PRs should describe the change, include testing notes, and ensure
  relevant lint/typecheck/tests pass. Add screenshots for UI changes
  (mobile/web) and link relevant issues.
```

- [ ] **Step 2: Update the Android QA workflow example label**

In `.codex/skills/qa-testing-android/SKILL.md`, replace this line:

```yaml
# .github/workflows/android.yml
```

with:

```yaml
# Example Android CI workflow
```

- [ ] **Step 3: Update skill selector design discovery roots**

In `docs/superpowers/specs/2026-05-25-tmux-skill-selector-design.md`, replace
this block:

```text
<active-pane-cwd>/.agents/skills/*/SKILL.md
<active-pane-cwd>/.codex/skills/*/SKILL.md
<ancestor-up-to-git-root>/.agents/skills/*/SKILL.md
<ancestor-up-to-git-root>/.codex/skills/*/SKILL.md
```

with:

```text
<active-pane-cwd>/.codex/skills/*/SKILL.md
<ancestor-up-to-git-root>/.codex/skills/*/SKILL.md
```

- [ ] **Step 4: Update skill selector design data flow**

In `docs/superpowers/specs/2026-05-25-tmux-skill-selector-design.md`, replace
this numbered item:

```markdown
6. Discovery runs a side-channel command against local `.agents/skills` and
   `.codex/skills` roots from the pane cwd up to the git root.
```

with:

```markdown
6. Discovery runs a side-channel command against local `.codex/skills` roots
   from the pane cwd up to the git root.
```

- [ ] **Step 5: Delete historical docs that hard-code removed `.agents/skills` paths**

Run:

```bash
git rm -- \
  docs/superpowers/plans/2026-05-14-android-host-browser-keyboard-actions.md \
  docs/superpowers/plans/2026-05-21-browser-key-long-press-actions.md \
  docs/superpowers/plans/2026-05-25-tmux-skill-selector.md \
  docs/superpowers/plans/2026-05-29-mobile-browser-action-menu.md \
  docs/superpowers/plans/2026-06-01-mobile-mdev-workmux-boundary.md \
  docs/superpowers/plans/2026-07-02-long-session-convergence-rules.md \
  docs/superpowers/specs/2026-07-02-long-session-convergence-rules-design.md
```

Expected: Git stages deletions for exactly the seven listed historical docs.

- [ ] **Step 6: Verify stale local path references are gone from retained docs**

Run:

```bash
rg -n "\.agents|app/\.agents|\.claude|\.codex/prompts|\.ai/context|\.vscode/|\.github/workflows" \
  AGENTS.md docs .codex/skills \
  --glob '!docs/superpowers/specs/2026-07-08-local-agent-config-cleanup-design.md' \
  --glob '!docs/superpowers/plans/2026-07-08-local-agent-config-cleanup.md'
```

Expected: No output.

- [ ] **Step 7: Commit the docs cleanup**

Run:

```bash
git status --short
git add AGENTS.md .codex/skills/qa-testing-android/SKILL.md docs/superpowers/specs/2026-05-25-tmux-skill-selector-design.md
git commit -m "Clean stale local agent references"
```

Expected: Commit succeeds and includes the three retained doc edits plus seven
historical doc deletions.

### Task 3: Final Verification

**Files:**
- Verify: Git index
- Verify: `.codex/skills/**`
- Verify: retained docs

**Interfaces:**
- Consumes: Task 1 and Task 2 commits.
- Produces: Evidence that only approved local skills remain and removed local folders are not tracked.

- [ ] **Step 1: Confirm removed folders are no longer tracked**

Run:

```bash
git ls-files .agents app/.agents .claude .codex/prompts .ai .vscode .github
```

Expected: No output.

- [ ] **Step 2: Confirm removed folder paths do not exist in the worktree**

Run:

```bash
test ! -e .agents
test ! -e app/.agents
test ! -e .claude
test ! -e .codex/prompts
test ! -e .ai
test ! -e .vscode
test ! -e .github
```

Expected: All commands exit `0`.

- [ ] **Step 3: Confirm global/user skill roots still exist**

Run:

```bash
test -d /home/muly/code/skills/skills
test -d /home/muly/.codex/skills
test -d /home/muly/.claude/skills
```

Expected: All commands exit `0`.

- [ ] **Step 4: Confirm exactly the approved local Fressh-specific Codex skills remain**

Run:

```bash
find .codex/skills -mindepth 2 -maxdepth 2 -name SKILL.md -printf '%h\n' | sort
```

Expected exactly:

```text
.codex/skills/expo-deployment
.codex/skills/ios-android-logs
.codex/skills/modify-mobile-keyboard
.codex/skills/qa-testing-android
.codex/skills/upgrading-expo
```

- [ ] **Step 5: Confirm no stale local path references remain outside cleanup docs**

Run:

```bash
rg -n "\.agents|app/\.agents|\.claude|\.codex/prompts|\.ai/context|\.vscode/|\.github/workflows" \
  AGENTS.md docs .codex/skills \
  --glob '!docs/superpowers/specs/2026-07-08-local-agent-config-cleanup-design.md' \
  --glob '!docs/superpowers/plans/2026-07-08-local-agent-config-cleanup.md'
```

Expected: No output.

- [ ] **Step 6: Confirm the worktree is clean**

Run:

```bash
git status --short
```

Expected: No output.

- [ ] **Step 7: Record verification in the final response**

Report these facts:

```text
Removed repo-local agent/tooling folders.
Kept .codex/skills with the approved Fressh-specific skills.
Verified removed folders are untracked and absent from the worktree.
Verified no stale local path references outside the cleanup docs.
No app build was run because no app source or package config changed.
```
