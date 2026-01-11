---
description: Investigate Trigger.dev integration test runs with code-log correlation
allowed-tools: Read(*), Grep(*), Bash(cat*), Bash(jq*), Bash(sed*), Bash(head*), Bash(tail*), Bash(./scripts/run-integration-test.mjs --read *)
argument-hint: [run-id]
---

# Analyze Trigger.dev Integration Test Runs with Root-Cause Focus

Use @agent-general-purpose to perform a full forensic analysis of saved integration test runs (for example `run_cmfeyybpfx4rh2zluriwatna2`) and deliver actionable fixes that connect logs to the implementation.

## Quick Usage
```
/task:analyze [run-id]
```
- **No arguments**: Analyze the most recent saved run in `task-summary.md`
- `<run-id>`: Analyze a specific run (e.g. `/task:analyze run_cmfeyybpfx4rh2zluriwatna2`)

## Retrieval Workflow (MANDATORY)
1. **Confirm run ID**
   - If an argument was provided, use it.
   - Otherwise read the run ID from the header of `task-summary.md`.
2. **Refresh local artifacts**
   - Run `./scripts/run-integration-test.mjs --read <runId>` to export the summary and log files. This creates/updates:
     - `task-summary.md`
     - `task-log.jsonl`
     - `task-run-status.md` (batch context, if present)
   - Verify the files now reference the requested run ID before proceeding.

## Analysis Methodology
Follow this order strictly. Never skip a step.

### 1. Understand the Test Intent (task-summary.md)
- Read the entire summary file first – it contains the test metadata, variables, steps, AI analysis, and failure breakdowns.
- Capture the failing step, expected vs actual behavior, objects involved, and linked child task IDs.
- Note any TODO sections or missing data called out by the generator.

### 2. Drill into Detailed Logs (task-log.jsonl) when Necessary
- Only query the JSONL when the summary lacks a detail you need (e.g., specific property payloads).
- Use targeted `jq` filters instead of dumping the whole log. Examples:
  - `cat task-log.jsonl | jq 'select(.runId == "<childRun>") | {time, msg, properties}'`
  - `cat task-log.jsonl | jq 'select(.properties.fieldChanges != null) | {msg, fieldChanges: .properties.fieldChanges}'`
- Keep notes tying every important fact back to timestamps and run IDs.

### 3. Correlate Logs with Code
- Search the codebase (primarily under `src/`) for log strings, error messages, or function names surfaced in the logs using `rg`.
- Inspect the surrounding implementation to understand the data flow and business rules.
- Map each critical log to the originating module, method, and line range. Record file paths in `path/to/file.ts:line` format.

### 4. Determine Root Cause and Fix Strategy
- Explain WHY the failure occurred using evidence from both logs and code.
- Identify the minimal code changes required to resolve it, including guardrails or follow-up checks.
- If data issues or missing configuration caused the failure, describe remediation steps.

### 5. Recommend Verification
- Specify which tests (unit/integration) or commands (e.g. `yarn test:frontend`, re-running the integration with `./scripts/run-integration-test.mjs <test>`) are needed to prove the fix.
- Call out any remaining unknowns or additional data required.

## Expected Output Format
Structure the final response like this:

```
## Run Overview
- Run ID: <runId>
- Test File: <path>
- Status: <status>

## Failure Summary
- <concise statement of what failed>

## Evidence
- Logs: <timestamp/runId/message excerpts>
- Code: <file.ts:line> – <finding>

## Root Cause
- <clear explanation linked to evidence>

## Fix Plan
- <specific changes with file references>

## Verification
- <tests or follow-up actions>
```

Every claim must reference both the supporting log entry and the exact location in code.
