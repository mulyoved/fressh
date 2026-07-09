# Issue 115 Not-Planned Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GitHub issue 115 as not planned with a clear rationale that the requested cleanup is test-only and not worth prioritizing now.

**Architecture:** This is issue-hygiene work, not app implementation. Confirm issue 115 is still open, close it with a concise not-planned comment, then confirm the remote issue state and local git status.

**Tech Stack:** GitHub CLI (`gh`), git.

## Global Constraints

- Make no repository code or test changes for issue 115.
- Close the GitHub issue as `not planned`.
- Explain that the oversized files are test-only.
- Explain that the cleanup cost is not worth prioritizing at this time.
- Explain that the issue can be reopened if these files become active maintenance pain.
- Do not split the named test files.
- Do not create `test/integration/support` harness modules.
- Do not move tests by behavior area.
- Do not rename tests.
- Do not run the full integration suite.
- Do not change app code.
- Keep the local git working tree clean after execution.

---

## File Structure

- Modify: GitHub issue `#115` via `gh issue close`.
- Test: GitHub issue `#115` state via `gh issue view`.
- No local repository files should be created, modified, staged, or committed during execution.

### Task 1: Close Issue 115 As Not Planned

**Files:**
- Modify: GitHub issue `#115`
- Test: GitHub issue `#115` state via `gh issue view`

**Interfaces:**
- Consumes: the current GitHub issue `#115`, which should be open before execution.
- Produces: GitHub issue `#115` closed as not planned with a rationale comment.

- [ ] **Step 1: Confirm the local worktree is clean before issue hygiene**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Confirm issue 115 is open**

Run:

```bash
gh issue view 115 --json number,title,state,url
```

Expected: JSON containing:

```json
{"number":115,"state":"OPEN","title":"Decompose oversized auto-connect integration tests"}
```

- [ ] **Step 3: Close issue 115 as not planned**

Run:

```bash
gh issue close 115 --reason "not planned" --comment "$(cat <<'EOF'
Closing as not planned.

This issue tracks maintainability cleanup for oversized integration test files only. The named files are test-only, and splitting them would mostly move existing coverage and harness code without changing product behavior, runtime architecture, or user-facing reliability.

The cleanup cost is not worth prioritizing at this time. We can reopen this if these files become active maintenance pain during future auto-connect or reconnect work.
EOF
)"
```

Expected: exits `0` and prints successful close output for issue `#115`.

- [ ] **Step 4: Confirm issue 115 is closed**

Run:

```bash
gh issue view 115 --json number,title,state,url
```

Expected: JSON containing:

```json
{"number":115,"state":"CLOSED","title":"Decompose oversized auto-connect integration tests"}
```

- [ ] **Step 5: Confirm the local worktree stayed clean**

Run:

```bash
git status --short
```

Expected: no output.
