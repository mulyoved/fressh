You are an **expert software debugger** with deep experience in systematic root cause analysis. Your task is to investigate and fix a bug. **You must thoroughly understand and explain the root cause before proposing any fix.** Follow these steps carefully:

## Step 1: Review the Bug Report

First, review the GitHub issue using the gh issue view command.

<github_issue> #$ARGUMENTS </github_issue>

Pay special attention to latest comments as  those represent the most up-to-date state of the issue,
separate between what was already done and confirmed and what was failed in such comments if exists

## Step 1.5: Label the Issue (if issue number provided)

Add tracking labels to the GitHub issue:
```bash
gh issue edit $ARGUMENTS --add-label "Picked" --add-label "F$(pwd | grep -oP 'cube9(-dev2?|-env[0-9]+)?' | sed -E 's/cube9$/0/; s/cube9-dev$/1/; s/cube9-dev2$/2/; s/cube9-env//')"
```

This marks the issue as "Picked" (being worked on) and adds an environment tag based on the working folder (e.g., "F7" for cube9-env7).

## Step 2: Root Cause Analysis Workflow

Before proposing any fix, you MUST complete this systematic investigation:

### Phase A: Symptom Documentation

- Document exact error messages, stack traces, or unexpected behavior from the issue
- Identify affected components, modules, and code paths
- Note reproduction steps (if provided or discoverable)
- Determine scope: all users? specific conditions? intermittent?

### Phase B: Reproduction Attempt (Best Effort)

**Use the `github-issue-verifier` skill for systematic reproduction with evidence collection.**

1. **Initialize verification session** (creates evidence directories):
   ```bash
   yarn tsx .claude/skills/github-issue-verifier/scripts/init-verification.ts --issue=$ARGUMENTS
   ```

2. **Collect evidence using API-first approach** (priority order):
   - **tRPC calls** for API behavior: `call-trpc.ts --router=X --method=Y --args='{...}' --output=app/docs/verify/$ARGUMENTS/evidence/api-responses/before-fix.json`
   - **DB queries** for data state: `query-db.ts --query='...' --output=app/docs/verify/$ARGUMENTS/evidence/db-queries/before-fix.json`
   - **UI captures** (only if visual bug): `browser-capture.ts --action=aria --path="/..." --output=app/docs/verify/$ARGUMENTS/evidence/aria-snapshots/before-fix.yaml`

3. **Document reproduction results**:
   - If reproduction succeeds: save evidence files showing the bug
   - If reproduction not feasible: note why and proceed with code analysis
   - Reproduction is valuable but not blocking - proceed based on available evidence

See `app/.claude/skills/github-issue-verifier/SKILL.md` for full script reference and evidence patterns.

### Phase C: Data Collection

- use `yarn psql` to query the database for evidence
- Search codebase for related error patterns and similar code
- Check git history for recent changes in affected area (`git log --oneline -20 -- <path>`)
- Look for similar past issues in GitHub (`gh issue list --search "<keywords>"`)
- Identify relevant log locations and error handling paths

### Phase D: Hypothesis Formation (Fishbone Analysis)

Systematically explore potential causes across these categories:

| Category | What to Look For |
|----------|------------------|
| **Code** | Logic errors, edge cases, null/undefined handling, type mismatches |
| **Data** | Invalid input, corrupt state, missing data, migration issues |
| **Environment** | Version mismatches, configuration, dependency conflicts |
| **Integration** | API changes, external service behavior, timing assumptions |
| **Concurrency** | Race conditions, async ordering, state mutations |

Document your most likely hypothesis and any notable rejected hypotheses that future investigators might mistakenly pursue.

### Phase D.5: Code Path Tracing (Rubber Duck Debugging)

Walk through the suspected code path step-by-step:
- Mentally simulate execution with the failing input/conditions
- At each step, ask: What is the state? What should happen? What actually happens?
- Identify the exact point where expected behavior diverges from actual behavior
- Consider adding temporary logging statements (mentally or actually) to trace variable states
- Document the specific line(s) and condition(s) where the bug manifests

### Phase E: Root Cause Verification (5 Whys)

Apply the "5 Whys" technique to drill from symptom to true root cause:

1. Why does [symptom] occur? → Because [cause 1]
2. Why does [cause 1] happen? → Because [cause 2]
3. Continue until you reach the fundamental cause (typically 3-5 levels)

Verify your root cause by checking:
- Does it fully explain ALL reported symptoms?
- Can you trace the exact code path from root cause to symptom?
- Are there other areas that might have the same underlying issue?

## Step 3: Present Your Analysis and Plan

Present your findings in the following format:

<root_cause_analysis>
## Symptom Summary
[Concise description of what the user experiences]

## Reproduction Status
[Successfully reproduced / Could not reproduce - with details]

## Investigation Summary
[Key discoveries: affected code paths, patterns found, git history insights]

## Hypotheses Considered
**Primary hypothesis**: [The most likely cause and why]
**Notable rejected hypotheses**: [Causes that seemed plausible but were ruled out, and why - helps prevent future misdirection]

## Causal Chain (5 Whys)
1. [Symptom] occurs because → [Cause 1]
2. [Cause 1] happens because → [Cause 2]
3. [Continue to root cause...]

## Confirmed Root Cause
[Specific technical explanation: what is broken, where in the code, and why]

## Evidence
[Code references (file:line), logs, reproduction results, or other proof]

## Impact Assessment
[Other areas potentially affected by this root cause]
</root_cause_analysis>

<plan>
## Fix Strategy
[High-level approach to fixing the root cause]

## Implementation Steps
1. [Detailed step]
2. [Detailed step]
...

## Testing Plan
- [ ] Regression test to prevent recurrence
- [ ] Related scenarios to verify
- [ ] Edge cases to cover

## TODO List
- [ ] [Specific action with file:line reference]
- [ ] [Next action]
- [ ] Write/update regression tests
- [ ] Verify fix addresses root cause (not just symptom)

## Considerations
- **Minimal fix principle**: Aim for the smallest change that resolves the root cause without side effects
- Fix targets root cause, not just symptom
- Related code that may have the same issue
- Backwards compatibility (if applicable)
- Performance implications
</plan>

## Step 4: Await Approval

ASK FOR APPROVAL BEFORE YOU START implementing the fix. The root cause analysis must be reviewed first.

## Step 5: Create Branch

After approval, create a new branch from the dev branch for this fix:
```
git checkout dev && git pull && git checkout -b bug/[issue-number]-brief-description
```

## Step 6: Implement the Fix

After approval:
1. Implement the fix according to the plan
2. Write/update tests to prevent regression
3. Verify the fix addresses the root cause, not just the symptom

## Step 7: Verify the Fix (Using Phase B Procedure)

**Reuse the same `github-issue-verifier` skill procedure from Phase B to verify the fix works.**

1. **Collect post-fix evidence** using the same scripts from Phase B:
   - **tRPC calls**: `call-trpc.ts --router=X --method=Y --args='{...}' --output=app/docs/verify/$ARGUMENTS/evidence/api-responses/after-fix.json`
   - **DB queries**: `query-db.ts --query='...' --output=app/docs/verify/$ARGUMENTS/evidence/db-queries/after-fix.json`
   - **UI captures** (if applicable): `browser-capture.ts --action=aria --path="/..." --output=app/docs/verify/$ARGUMENTS/evidence/aria-snapshots/after-fix.yaml`

2. **Compare before/after evidence**:
   - Confirm the bug is no longer reproducible
   - Verify expected behavior now occurs
   - Check for any regressions in related functionality

3. **Write verification report** to `app/docs/verify/$ARGUMENTS/README.md`:
   - **Summary**: What was fixed and how
   - **Before/After comparison**: Evidence showing bug is resolved
   - **Conclusion**: PASS (fix verified) / FAIL (issue persists) / PARTIAL (partially fixed)

4. **Optional: Post verification to GitHub issue**:
   ```bash
   gh issue comment $ARGUMENTS --body "$(cat <<'EOF'
   ## Fix Verification Report

   **Result**: ✅ PASS

   ### Before Fix
   [Evidence of bug behavior]

   ### After Fix
   [Evidence showing fix works]

   ### Conclusion
   [Summary of verification]
   EOF
   )"
   ```

See `app/.claude/skills/github-issue-verifier/SKILL.md` Step 4-5 for report template and GitHub publishing details.

---

**IMPORTANT**: This command is for investigating bugs, performing root cause analysis, and implementing fixes only.
For creating commits and pull requests, use the /git:cc-fix-pr command or ask the user explicitly.
