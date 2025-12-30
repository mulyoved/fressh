---
description: Deep regression investigation between a known-good integration test run and a failing run
argument-hint: "<baseline-run-id> <failing-run-id>"
---

# Analyze Regression Between Trigger.dev Test Runs

Use @agent-general-purpose to investigate regressions by comparing a successful baseline run (`$1`) against a failing run (`$2`). The goal is to explain **what changed**, **why it failed**, and **which code commits introduced the behavior**.

> ❗️ Invocation: `/prompts:analyze-regression <baseline-run-id> <failing-run-id>`  
> `$1` → baseline (last known good) run ID, `$2` → failing run ID.

## Retrieval & Preparation (MANDATORY)
1. **Refresh artifacts for both runs**
   - `./scripts/run-integration-test.mjs --read $1`
   - `./scripts/run-integration-test.mjs --read $2`
   - Confirm `task-summary.md` and `task-log.jsonl` now reference `$2` (the most recent command) before analysis. Keep copies of both summaries if needed.
2. **Capture metadata**
   - Record test file, organization, object IDs, and step counts for each run.
   - Note start/end timestamps to compare durations.
3. **Establish success vs failure diff**
   - For `$1`, identify the critical steps that passed.
   - For `$2`, highlight the first failing step and reported discrepancies.

## Analysis Workflow
Follow these phases sequentially; do not skip steps.

### 1. Baseline Understanding (`task-summary.md` for `$1`)
- Read the entire summary to understand expected behavior, data setup, and webhook flow.
- Log the key change logs, sync states, and child task IDs that represent correct execution.

### 2. Failure Characterization (`task-summary.md` for `$2`)
- Read the full summary, focusing on deviations: failing step, error text, and YAML expectations.
- List which change logs or sync states differ from the baseline.

### 3. Deep Log Comparison (`task-log.jsonl`)
- Use targeted `jq` filters for both run IDs:
  - `cat task-log.jsonl | jq 'select(.runId == "$1") | {time, msg, properties}'`
  - `cat task-log.jsonl | jq 'select(.runId == "$2") | {time, msg, properties}'`
- Track identical events (e.g., `[AUDIT]`, `[SYNC-STATE]`, `[DEBUG-*]`) and note where sequences diverge.
- Summarize data payload differences (field changes, sync state transitions, webhook counts).

### 4. Code Correlation
- For each divergent log message, locate the generating code with `rg`.
- Inspect implementation around:
  - Change log recording (`src/server/integrations/**/object-change*.ts`)
  - Mapping/calculation logic relevant to the discrepancy
  - Webhook simulation and expectation verification (`src/server/integrations/test-runner/**`)
- Document file paths and line numbers (e.g., `src/server/integrations/object-change-create.ts:51`).

### 5. Git History Review
- Use `git log --stat -- <relevant-file>` (substitute the actual file path) to trace recent modifications.
- Inspect suspect commits: `git show <commit>` and note author/date/context.
- Identify the commit introducing the change between the baseline success and current failure. If necessary, compare branches or tags.

### 6. Root Cause Synthesis
- Explain precisely what shifted between `$1` and `$2` (data, code behavior, timing, external state).
- Provide evidence for both the baseline expectation and the failing behavior.
- Outline minimal code/config changes required to restore correctness or adjust expectations.

### 7. Verification Plan
- Recommend rerunning the failing test after the fix.
- Add any additional unit/integration checks needed to guard against regressions.

## Expected Output Template
```
## Regression Overview
- Baseline Run: <runId $1> (status, key stats)
- Failing Run: <runId $2> (status, key stats)
- Test File: <path>

## Observed Delta
- <Bullet list of behavioral differences>

## Evidence
- Baseline Logs: <timestamp/runId message excerpts>
- Failing Logs: <timestamp/runId message excerpts>
- Code: <file.ts:line> – <finding>
- Git: <commit hash> – <summary of change>

## Root Cause
- <Explanation linking logs ↔ code ↔ commit>

## Fix Plan
- <Specific code/config changes with file references>
- <Any expectation updates if required>

## Verification
- <Commands/tests to rerun (e.g., `./scripts/run-integration-test.mjs --read $2`, `yarn test ...`)>
- <Follow-up monitoring or TODOs>
```

Ensure every claim references supporting log timestamps and code locations. Tie git history directly to the behavioral change to deliver an actionable regression narrative.
