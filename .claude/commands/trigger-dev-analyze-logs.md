---
description: Analyze logs from a trigger.dev test run
allowed-tools: Bash(*), Read(*), Grep(*)
---

# Analyze Trigger.dev Test Logs

## Current Run ID

Enter the run ID to analyze: `<run-id>`

## View All Logs

!`./scripts/trigger-dev.mjs --logs *`

## Your Task

1. Replace `<run-id>` with the actual run ID from a test execution
2. Analyze the log output to identify issues
3. Look for error patterns, failed assertions, or unexpected behavior
4. Provide insights on the root cause of any failures
5. Suggest potential fixes or further investigation steps

## Filtering Options

### View errors only:

```bash
./scripts/trigger-dev.mjs --logs <run-id> --level error
```

### Search for specific text:

```bash
./scripts/trigger-dev.mjs --logs <run-id> --search "check in core8"
```

### Show detailed properties:

```bash
./scripts/trigger-dev.mjs --logs <run-id> --search "DIFFERENCES FOUND" --detail
```

### Get raw JSON output:

```bash
./scripts/trigger-dev.mjs --logs <run-id> --grep "Integration Object" --json
```

## Available Options

- `--level error|warn|info` - Filter by log level
- `--search <text>` or `--grep <text>` - Search in log messages
- `--tail <n>` - Limit output (default: all)
- `--detail` - Show full properties for complex log entries
- `--json` - Output raw JSON format

## Common Search Patterns

- `"DIFFERENCES FOUND"` - Find field mismatches
- `"check in core8"` - Find Core8 validation checks
- `"Integration Object"` - Find object creation/updates
- `"error"` - Find error messages
- `"failed"` - Find failed operations

## Example Analysis Workflow

```bash
# First check overall status
./scripts/trigger-dev.mjs --check run_cmcols6j103h027nb04gown1s

# View all errors
./scripts/trigger-dev.mjs --logs run_cmcols6j103h027nb04gown1s --level error

# Search for specific issues
./scripts/trigger-dev.mjs --logs run_cmcols6j103h027nb04gown1s --search "DIFFERENCES FOUND" --detail

# Get detailed JSON for debugging
./scripts/trigger-dev.mjs --logs run_cmcols6j103h027nb04gown1s --json > test-logs.json
```
