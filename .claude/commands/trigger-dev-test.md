---
description: Run and debug trigger.dev test runner tasks
allowed-tools: Bash(*), Read(*), Grep(*)
---

# Running Test Runner Tasks

## Important Notes

⚠️ **Command Timeout**: The initial `run-test` command will timeout after 2 minutes due to command execution limits. This is normal! The test continues running in the background. Always save the run ID from the output to check the test status later.

## Current Test Run Output

`./scripts/trigger-dev.mjs`

## Your Task

Based on the test run output above:

1. **Save the run ID** from the output (e.g., `run_cmcols6j103h027nb04gown1s`)
2. If the command times out, use `--check <run-id>` to monitor the test status
3. Analyze the test results once available
4. If the test failed, investigate the errors using the debugging commands below
5. Identify the root cause of any failures
6. Suggest fixes or further debugging steps

## 1. Run a Test

```bash
./scripts/trigger-dev.mjs run-test
```

The script automatically follows execution and shows the run ID.

## 2. Debug Failed Tests

### Check test execution flow and errors:

```bash
./scripts/trigger-dev.mjs --check <run-id>
```

Shows:

- Step-by-step execution with ✅/❌ indicators
- Error details and field differences
- Object ID mappings between systems

### View filtered logs:

```bash
# Show errors only
./scripts/trigger-dev.mjs --logs <run-id> --level error

# Search for text in logs
./scripts/trigger-dev.mjs --logs <run-id> --search "check in core8"

# Show detailed properties for complex entries
./scripts/trigger-dev.mjs --logs <run-id> --search "DIFFERENCES FOUND" --detail

# Get raw JSON output
./scripts/trigger-dev.mjs --logs <run-id> --grep "Integration Object" --json
```

Options:

- `--level error|warn|info` - Filter by log level
- `--search <text>` or `--grep <text>` - Search in log messages
- `--tail <n>` - Limit output (default: all)
- `--detail` - Show full properties for complex log entries
- `--json` - Output raw JSON format

## 3. Test Files Location

Tests: `/src/server/integrations/test-runner/samples/`

## Example Workflow

```bash
# Run test (will timeout after 2 minutes - this is normal!)
./scripts/trigger-dev.mjs run-test
# Output:
# 🚀 Starting task: run-test
# ✅ Task triggered successfully
# 🔖 Run ID: run_cmcols6j103h027nb04gown1s
# 🏃 Status: EXECUTING (elapsed: 0s)
# [stderr]
# Command timed out after 2m 0.0s

# Use the run ID to check status (test is still running)
./scripts/trigger-dev.mjs --check run_cmcols6j103h027nb04gown1s

# If failed, view error logs
./scripts/trigger-dev.mjs --logs run_cmcols6j103h027nb04gown1s --level error

# Search for specific text in logs
./scripts/trigger-dev.mjs --logs run_cmcols6j103h027nb04gown1s --search "check in core8"
```

## Typical Test Duration

Tests often take 5-10 minutes to complete. The `--check` command will continue monitoring until the test finishes or you interrupt it.
