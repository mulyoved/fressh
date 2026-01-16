---
description: Execute test scenarios for a commission plan from any source
allowed-tools: Bash(*), Read(*), Write(*)
---

# /plan:run-test-spec

Execute test scenarios for a commission plan using the plan-test-executor skill. Accepts scenarios from any source (file, user message, generated output).

## Usage

```
/plan:run-test-spec --planId=cmp_xxx --source=docs/test-scenarios.md
/plan:run-test-spec --planId=cmp_xxx  # User provides scenarios in conversation
```

## Arguments

- `--planId`: Plan ID (cmp_xxx format) - required
- `--source`: Path to file containing test scenarios (optional - if omitted, expects scenarios in conversation)

## Workflow

This command invokes the `plan-test-executor` skill to execute test scenarios.

See the skill documentation for detailed workflow:
1. Pre-flight check (get plan requirements)
2. Ensure plan is approved
3. Check for existing test data
4. Create new test data if needed
5. Trigger calculation
6. Compare actual vs expected results
7. Record results in Test History

## Related

- **Skill**: `plan-test-executor` - Full execution workflow
- **Command**: `/plan:create-test-spec` - Generate test scenarios first
