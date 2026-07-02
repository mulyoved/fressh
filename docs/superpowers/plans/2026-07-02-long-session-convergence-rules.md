# Long Session Convergence Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable convergence rules for long refactor/review sessions and
wire the core long-session workflows to reference them.

**Architecture:** Create one shared policy document under
`.agents/skills/shared/` and add short references from the workflows that create
repeated review/fix loops. Keep the full rule in one file so future skills can
link to it without copy/paste drift.

**Tech Stack:** Markdown skill documentation, repository `rg` checks, Prettier
markdown check through `pnpm exec prettier --check`.

---

## File Structure

- Create `.agents/skills/shared/convergence.md`: shared advisory convergence
  policy, trigger list, checkpoint format, reviewer/subagent capacity rules,
  verification fallback rules, patch anchoring guidance, and final integrated
  review guidance.
- Modify `.agents/skills/subagent-driven-development/SKILL.md`: reference the
  policy before repeated spec/code-quality re-review loops and capacity
  saturation.
- Modify `.agents/skills/executing-plans/SKILL.md`: reference the policy when
  verification repeats, plan contracts drift, or a blocker is not a simple
  one-off.
- Modify `.agents/skills/requesting-code-review/SKILL.md`: bound "review early,
  review often" with convergence guidance.
- Modify `.agents/skills/rloop-code-fix/SKILL.md`: add the policy to references
  and apply it around round batches, root-cause clusters, known-broken gates,
  and deep review.
- Modify `.agents/skills/code-review/SKILL.md`: add the policy to references and
  quick guidance.
- Modify `.agents/skills/code-review/references/workflow.md`: apply convergence
  inside the autonomous fix loop and full-review rerun guidance.
- Modify `.agents/skills/code-review/references/stop-conditions.md`: extend
  repeated-finding and verification-blocker stop rules with convergence
  behavior.

## Task 1: Create Shared Convergence Policy

**Files:**

- Create: `.agents/skills/shared/convergence.md`

- [ ] **Step 1: Verify the policy file is not present yet**

Run:

```bash
test ! -e .agents/skills/shared/convergence.md
```

Expected: exit code `0`. If it exits nonzero, open the file and reconcile its
existing content with the policy in Step 2 instead of overwriting blindly.

- [ ] **Step 2: Create the shared policy file**

Create `.agents/skills/shared/convergence.md` with exactly this content:

```markdown
# Long-Session Convergence Policy

Use this policy when a skill or workflow is about to repeat review, fix,
verification, or subagent loops on the same task.

The policy is a strong advisory rule, not an absolute hard stop. The agent is
expected to run the checkpoint when a trigger appears. The agent may continue
without stopping only after recording why continuing is cheaper or safer than
consolidating first.

## Triggers

Run a convergence checkpoint when any of these happen:

- two review/fix loops have run on the same task without a clean result;
- the same or closely related finding returns after an attempted fix;
- reviewer or subagent thread/slot capacity is exhausted or close to exhausted;
- the workflow is about to retry a verification gate already identified as
  environment or configuration broken;
- patch anchors fail repeatedly in files that have changed during the session;
- a task changes a shared contract, helper shape, or assumption used by later
  tasks;
- a major review phase just completed and the workflow is about to launch
  another full review matrix;
- token or context cost is growing faster than the risk being reduced.

## Checkpoint Output

Keep the checkpoint short. Record it in the workflow's durable report when one
exists; otherwise record it in the user-visible session summary or active plan
state.

Include these fields:

- `Original plan`: the task or requirement the loop started from.
- `Current contract`: what remains in scope and what behavior must now hold.
- `Superseded assumptions`: assumptions or plan text that no longer apply.
- `Findings state`: duplicate findings, genuinely new defects, and rejected
  false positives.
- `Verification state`: trusted gates, blocked gates, downgraded gates, and the
  approved fallback for each downgraded gate.
- `Capacity state`: active reviewer/subagent threads, completed threads that can
  be closed, and the next batch size.
- `Next action`: targeted verification, one final integrated review, another
  bounded review batch, or a user decision.

## Reviewer And Subagent Capacity

- Batch reviewer and subagent work instead of opening unbounded parallel
  threads.
- Close completed reviewer/subagent threads before launching another phase when
  the environment supports it.
- Treat slot saturation as a process failure to correct, not normal retry
  behavior.
- Reduce the next batch size after saturation.
- Do not retry the same launch pattern after a thread-limit error without first
  changing the plan, closing completed threads, or reducing concurrency.

## Verification Downgrade

Once a verification gate is proven environment or configuration broken:

1. Record the command, exact failure summary, and why the failure is not caused
   by the current code change.
2. Name the fallback gate that will be used for the rest of the session.
3. Do not rerun the broken gate unless dependencies, configuration, or
   environment changed.
4. Report the downgraded gate in final verification notes.

Examples of valid fallbacks include a narrower package test, typecheck for the
touched package, a focused unit/integration test, or manual inspection when no
executable check exists.

## Patch Anchoring

Before nontrivial edits in churned files:

- refresh exact snippets from the active worktree;
- derive target paths from the current diff or current file list;
- use small anchored patches;
- split unrelated changes into separate patches;
- stop and consolidate if patch failures show the file is changing faster than
  the agent's context.

## Review Strategy

Distinguish targeted follow-up from final integrated review.

- After small patches, prefer targeted verification and update the existing
  findings queue.
- Do not reopen the full review matrix after every narrow amendment.
- Use another full review pass when the task contract changed, broad files
  changed, or final closeout needs integrated confidence.
- If another full review is launched after a convergence trigger, record why a
  targeted check is insufficient.

## User Decision Boundary

Stop for a user decision when the checkpoint shows:

- the next step requires product judgment or broad redesign;
- trusted verification is unavailable and no acceptable fallback exists;
- duplicate findings cannot be resolved from code or docs;
- continuing would mostly spend context or reviewer capacity without reducing
  risk.
```

- [ ] **Step 3: Verify the policy contains the required concepts**

Run:

```bash
rg -n "Triggers|Checkpoint Output|Reviewer And Subagent Capacity|Verification Downgrade|Patch Anchoring|Review Strategy|User Decision Boundary" .agents/skills/shared/convergence.md
```

Expected: output includes one line for each of the seven section names.

- [ ] **Step 4: Commit the shared policy**

Run:

```bash
git add .agents/skills/shared/convergence.md
git commit -m "Add long-session convergence policy"
```

Expected: commit succeeds and includes only
`.agents/skills/shared/convergence.md`.

## Task 2: Wire Plan Execution Workflows

**Files:**

- Modify: `.agents/skills/subagent-driven-development/SKILL.md`
- Modify: `.agents/skills/executing-plans/SKILL.md`

- [ ] **Step 1: Verify these files do not already reference the new policy**

Run:

```bash
rg -n "convergence.md|Long-Session Convergence" .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md
```

Expected before this task's edits: no matches and exit code `1`.

- [ ] **Step 2: Add convergence guidance to subagent-driven-development**

In `.agents/skills/subagent-driven-development/SKILL.md`, after the existing
`**Continuous execution:**` paragraph, insert:

```markdown
**Convergence checkpoint:** Continuous execution is still bounded. Before a
third review/fix loop on the same task, before retrying after reviewer/subagent
slot saturation, or when multiple findings point to one root cause, read
`../shared/convergence.md` and record the checkpoint there before launching more
subagents.
```

- [ ] **Step 3: Add convergence to implementer status handling**

In `.agents/skills/subagent-driven-development/SKILL.md`, after the existing
line:

```markdown
**Never** ignore an escalation or force the same model to retry without changes.
If the implementer said it's stuck, something needs to change.
```

insert:

```markdown
If a task needs repeated spec-review or code-quality-review fixes, use
`../shared/convergence.md` to summarize the root cause, update the active task
contract, de-duplicate findings, and decide whether the next step is targeted
verification, one final integrated review, another bounded reviewer batch, or a
human decision.
```

- [ ] **Step 4: Add convergence guidance to executing-plans stop rules**

In `.agents/skills/executing-plans/SKILL.md`, after the
`**Ask for clarification rather than guessing.**` line, insert:

```markdown
When verification fails repeatedly, a plan step changes the contract for later
steps, or the same blocker returns after a fix attempt, read
`../shared/convergence.md` before continuing. Record the current task contract,
superseded assumptions, trusted or downgraded verification gates, and the next
bounded action.
```

- [ ] **Step 5: Verify both execution workflows reference the policy**

Run:

```bash
rg -n "shared/convergence.md|Convergence checkpoint|trusted or downgraded verification gates" .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md
```

Expected: matches in both files.

- [ ] **Step 6: Commit execution workflow references**

Run:

```bash
git add .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md
git commit -m "Reference convergence policy from execution skills"
```

Expected: commit succeeds and includes only the two execution workflow files.

## Task 3: Wire Review Loop Workflows

**Files:**

- Modify: `.agents/skills/requesting-code-review/SKILL.md`
- Modify: `.agents/skills/rloop-code-fix/SKILL.md`

- [ ] **Step 1: Verify these review-loop files do not already reference the new
      policy**

Run:

```bash
rg -n "convergence.md|Long-Session Convergence|bounded review" .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md
```

Expected before this task's edits: no `convergence.md` matches. The phrase
`bounded review` should not appear yet.

- [ ] **Step 2: Bound the requesting-code-review core principle**

In `.agents/skills/requesting-code-review/SKILL.md`, replace:

```markdown
**Core principle:** Review early, review often.
```

with:

```markdown
**Core principle:** Review early at meaningful boundaries, but keep review loops
bounded. If repeated review/fix cycles stop reducing risk, read
`../shared/convergence.md` before requesting another full review.
```

- [ ] **Step 3: Add a convergence section to requesting-code-review**

In `.agents/skills/requesting-code-review/SKILL.md`, after the
`## Integration with Workflows` list and before `## Red Flags`, insert:

```markdown
## Convergence Boundary

Use `../shared/convergence.md` before requesting another reviewer when:

- two review/fix loops have already run for the same task;
- the next review would repeat the same scope after a narrow patch;
- reviewer feedback is clustering around one root cause or task-contract change;
- a verification gate is known broken and needs a recorded fallback.

After the checkpoint, prefer a targeted review or final integrated review over
restarting the full review pattern by habit.
```

- [ ] **Step 4: Add convergence to rloop-code-fix references and core rules**

In `.agents/skills/rloop-code-fix/SKILL.md`, add this bullet to the
`## References` list after `../shared/long-running-subprocess.md`:

```markdown
- `../shared/convergence.md` - checkpoint for repeated review/fix loops,
  known-broken gates, reviewer capacity, and root-cause consolidation
```

In the `## Core Rules` list, after the existing five-round batch rule, insert:

```markdown
- Before a third review/fix loop on the same root cause, or earlier if findings
  cluster around one design smell, read `../shared/convergence.md` and record
  the checkpoint in the durable run or repo-tracked process report before
  launching more review.
```

- [ ] **Step 5: Add convergence to rloop verification and pause behavior**

In `.agents/skills/rloop-code-fix/SKILL.md`, after the existing Step 5
paragraph:

```markdown
If verification fails:

- triage the failure as a real issue
- fix it in the main-agent context
- verify again before another external review
- repeated same-round `main-agent-fix` and `main-agent-verify` artifacts
  auto-version as `*-attempt-<n>.md`
```

insert:

```markdown
If the same verification gate is proven environment or configuration broken,
record the command, failure reason, and fallback according to
`../shared/convergence.md`. Use the fallback for the rest of the run unless the
environment changes.
```

In Step 7, after the existing root-cause bullets:

```markdown
If the loop keeps surfacing adjacent issues that point to one root cause, pause
and say so explicitly:

- “we keep finding related workflow issues”
- “this looks like a design or test smell”
- “we should improve X before continuing on this task”
```

insert:

```markdown
Then run the convergence checkpoint from `../shared/convergence.md` before
starting another review batch. Record the current contract, superseded
assumptions, duplicate versus new findings, trusted versus downgraded gates, and
why another batch is or is not worth the cost.
```

- [ ] **Step 6: Verify both review-loop workflows reference the policy**

Run:

```bash
rg -n "shared/convergence.md|Convergence Boundary|known-broken gates|review/fix loop" .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md
```

Expected: matches in both files.

- [ ] **Step 7: Commit review-loop workflow references**

Run:

```bash
git add .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md
git commit -m "Bound repeated review loops with convergence policy"
```

Expected: commit succeeds and includes only the two review-loop workflow files.

## Task 4: Wire Code Review Workflow

**Files:**

- Modify: `.agents/skills/code-review/SKILL.md`
- Modify: `.agents/skills/code-review/references/workflow.md`
- Modify: `.agents/skills/code-review/references/stop-conditions.md`

- [ ] **Step 1: Verify code-review files do not already reference the new
      policy**

Run:

```bash
rg -n "convergence.md|Long-Session Convergence|convergence checkpoint" .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
```

Expected before this task's edits: no matches.

- [ ] **Step 2: Add a quick-reference row and workflow pointer**

In `.agents/skills/code-review/SKILL.md`, add this row to the
`## Quick Reference` table after the `Finding is uncertain...` row:

```markdown
| Repeated review/fix loops, duplicate findings, known-broken gates, or
reviewer-capacity churn | Read `../shared/convergence.md`, record the
checkpoint, then choose targeted verification, final integrated review, another
bounded batch, or `needs_user_decision` |
```

In the numbered `## Workflow` list, after item 5, add:

```markdown
6. Use `../shared/convergence.md` when repeated review/fix loops, repeated
   findings, known-broken gates, or reviewer-capacity issues show the run is
   churning.
```

In the `## References` list, add:

```markdown
- `../shared/convergence.md` - long-session convergence checkpoint for repeated
  review/fix loops and process churn.
```

- [ ] **Step 3: Add convergence to code-review review loop behavior**

In `.agents/skills/code-review/references/workflow.md`, after the paragraph:

```markdown
After accepted fixes, run local verification, run inner review, then rerun
External Codex with the same persisted mode. Keep looping until the latest
External Codex round is terminal `clean`, the run is `blocked`, or a stop
condition requires `needs_user_decision`.
```

insert:

```markdown
Before a third review/fix loop on the same task, or earlier when related
findings point to one root cause, run the convergence checkpoint in
`../../shared/convergence.md`. Record the current contract, superseded
assumptions, duplicate versus new findings, trusted versus downgraded
verification gates, and why the next step should be targeted verification, one
final integrated review, another bounded review batch, or `needs_user_decision`.
```

After the paragraph:

```markdown
When the first External Codex round is clean, run one deep review pass.
Deep-review findings reopen the same queue and require the same autonomous
triage/fix/verify/inner-review/rerun loop.
```

insert:

```markdown
After small patches, do not restart the full review matrix by habit. Prefer
targeted verification and queue updates unless the task contract changed, broad
files changed, or final closeout needs integrated confidence.
```

- [ ] **Step 4: Add convergence to code-review stop conditions**

In `.agents/skills/code-review/references/stop-conditions.md`, after the
`## Verification Blockers` paragraph:

```markdown
If a command fails because a flag, path, review target, or input is unsupported,
do not rerun the same command with the same stderr. Inspect the script or docs,
switch to a documented fallback, or stop with `needs_user_decision`.
```

insert:

```markdown
When a required gate is proven environment or configuration broken, follow
`../../shared/convergence.md`: record the command, failure reason, and fallback
once; use the fallback until the environment changes; and include the downgraded
gate in the final verification notes.
```

In the `## Repeated Findings` section, after the existing bullet list, insert:

```markdown
Before launching another full review after repeated findings, run the
convergence checkpoint in `../../shared/convergence.md`. De-duplicate findings,
state the current task contract, and choose targeted verification, final
integrated review, another bounded batch, or `needs_user_decision`.
```

In the `## Hard No` list, after:

```markdown
- The fix loop is churning without reducing risk.
```

insert:

```markdown
- A convergence trigger fired but the run is launching more reviewers without a
  checkpoint or recorded reason.
```

- [ ] **Step 5: Verify code-review files reference the policy**

Run:

```bash
rg -n "shared/convergence.md|convergence checkpoint|targeted verification|final integrated review|downgraded gate" .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
```

Expected: matches in all three files.

- [ ] **Step 6: Commit code-review workflow references**

Run:

```bash
git add .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
git commit -m "Add convergence guidance to code review workflow"
```

Expected: commit succeeds and includes only the three code-review files.

## Task 5: Verify Documentation Integration

**Files:**

- Verify: `.agents/skills/shared/convergence.md`
- Verify: `.agents/skills/subagent-driven-development/SKILL.md`
- Verify: `.agents/skills/executing-plans/SKILL.md`
- Verify: `.agents/skills/requesting-code-review/SKILL.md`
- Verify: `.agents/skills/rloop-code-fix/SKILL.md`
- Verify: `.agents/skills/code-review/SKILL.md`
- Verify: `.agents/skills/code-review/references/workflow.md`
- Verify: `.agents/skills/code-review/references/stop-conditions.md`

- [ ] **Step 1: Verify every scoped file references or defines the policy**

Run:

```bash
for file in \
  .agents/skills/shared/convergence.md \
  .agents/skills/subagent-driven-development/SKILL.md \
  .agents/skills/executing-plans/SKILL.md \
  .agents/skills/requesting-code-review/SKILL.md \
  .agents/skills/rloop-code-fix/SKILL.md \
  .agents/skills/code-review/SKILL.md \
  .agents/skills/code-review/references/workflow.md \
  .agents/skills/code-review/references/stop-conditions.md
do
  if ! rg -q "convergence|Convergence|Long-Session" "$file"; then
    echo "missing convergence reference: $file"
    exit 1
  fi
done
```

Expected: no output and exit code `0`.

- [ ] **Step 2: Verify the shared policy covers Issue 119 acceptance criteria**

Run:

```bash
rg -n "review/fix loops|Capacity|Verification Downgrade|final integrated review|future|bounded review batch|slot saturation|Patch Anchoring" .agents/skills/shared/convergence.md
```

Expected: matches for review/fix loops, capacity, verification downgrade, final
integrated review, bounded review batch, slot saturation, and patch anchoring.

- [ ] **Step 3: Check for stale unbounded-review phrasing in scoped files**

Run:

```bash
rg -n "Review early, review often|unbounded|unlimited|keep reopening|restarting the full review pattern by habit" .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
```

Expected: no matches for `Review early, review often`, `unbounded`, `unlimited`,
or `keep reopening`. A match for `restarting the full review pattern by habit`
is acceptable only inside the new bounded-review warning in
`requesting-code-review`.

- [ ] **Step 4: Run markdown formatting check for touched docs**

Run:

```bash
pnpm exec prettier --check .agents/skills/shared/convergence.md .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
```

Expected: Prettier reports all matched files use Prettier code style. If it
reports formatting issues, run:

```bash
pnpm exec prettier --write .agents/skills/shared/convergence.md .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
pnpm exec prettier --check .agents/skills/shared/convergence.md .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
```

Expected after write: Prettier check passes.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff -- .agents/skills/shared/convergence.md .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
```

Expected: only process documentation and skill guidance changed. No mobile, web,
Rust, generated, package, or lockfile changes appear.

- [ ] **Step 6: Commit formatting-only changes if Prettier changed files**

Run:

```bash
git status --short
```

Expected: if Step 4 changed files after the Task 1-4 commits, only the touched
markdown files are modified.

If files are modified, run:

```bash
git add .agents/skills/shared/convergence.md .agents/skills/subagent-driven-development/SKILL.md .agents/skills/executing-plans/SKILL.md .agents/skills/requesting-code-review/SKILL.md .agents/skills/rloop-code-fix/SKILL.md .agents/skills/code-review/SKILL.md .agents/skills/code-review/references/workflow.md .agents/skills/code-review/references/stop-conditions.md
git commit -m "Format convergence policy docs"
```

Expected: commit succeeds if formatting changed files. If `git status --short`
shows no touched markdown modifications, skip this commit.

## Task 6: Close Issue 119 Implementation State

**Files:**

- Verify:
  `docs/superpowers/specs/2026-07-02-long-session-convergence-rules-design.md`
- Verify: all files changed in Tasks 1-5

- [ ] **Step 1: Compare implementation against the design**

Run:

```bash
sed -n '1,260p' docs/superpowers/specs/2026-07-02-long-session-convergence-rules-design.md
```

Expected: every acceptance criterion maps to the shared policy and workflow
references:

- convergence checkpoint after repeated review/fix loops:
  `.agents/skills/shared/convergence.md`;
- reviewer/subagent batch limits and cleanup:
  `.agents/skills/shared/convergence.md`;
- known-broken verification fallback: `.agents/skills/shared/convergence.md`;
- final integrated review distinction: `.agents/skills/shared/convergence.md`
  and `code-review/references/workflow.md`;
- reusable future reference: all scoped workflows link to the shared policy.

- [ ] **Step 2: Verify working tree state**

Run:

```bash
git status --short
```

Expected: no tracked-file modifications remain. Untracked `docs/tool-output/`
may still appear if it was present before this work; do not stage it for this
issue.

- [ ] **Step 3: Report verification and commits**

Run:

```bash
git log --oneline -5
```

Expected: the output includes the implementation commits created by Tasks 1-4
and the formatting commit from Task 5 only when formatting changed files.

Write the final implementation summary in this concrete shape, replacing each
command result with the actual pass/fail evidence from this run:

```text
Implemented Issue 119 convergence rules.

Changed:
- Created .agents/skills/shared/convergence.md.
- Referenced it from subagent-driven-development, executing-plans, requesting-code-review, rloop-code-fix, and code-review workflows.
- Added known-broken verification fallback, capacity cleanup, patch anchoring, and final integrated review guidance.

Verification:
- Scoped convergence reference check: passed.
- Shared policy acceptance-criteria check: passed.
- Stale unbounded-review phrasing check: passed.
- Prettier markdown check: passed.
- Working tree check: no tracked-file modifications remain.

Commits:
- Use the exact commit lines from git log --oneline -5 for the commits created during this implementation.

Notes:
- No application code changed.
- Mobile tests were not run because this change is process documentation only.
```

Expected: summary mentions that no application code changed and that mobile
tests were not run because this is process documentation only.
