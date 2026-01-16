---
description: Check the status of a trigger.dev test run
allowed-tools: Bash(*), Read(*), Grep(*)
---

# Check Trigger.dev Test Status

## Usage

This command checks the status of a trigger.dev test run. You need to provide the run ID from a previous test execution.

## Run ID Required

The run ID looks like: `run_cmd74j4v43hkp28n2vgz1kqhr`

You should get this ID from the output of `/trigger-dev-test` command.

## Your Task

1. Replace `<RUN_ID>` in the command above with the actual run ID from a previous test execution
2. Monitor the test execution status
3. Report whether the test is still running, completed successfully, or failed
4. If completed, summarize the results

## Status Indicators

- 🏃 EXECUTING - Test is still running
- ✅ COMPLETED - Test finished successfully
- ❌ FAILED - Test failed with errors
- ⏸️ INTERRUPTED - Test was interrupted
- 🕐 QUEUED - Test is waiting to start

## Example Usage

```bash
# Check status of a specific run
./scripts/trigger-dev.mjs --check run_cmcols6j103h027nb04gown1s
```

The command will show:

- Current execution status
- Step-by-step progress with ✅/❌ indicators
- Error details if the test failed
- Object ID mappings between systems
