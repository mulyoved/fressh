---
description: Run trigger.dev integration test (may take up to 20 minutes)
allowed-tools: Task
argument-hint: [test-name] | all <directory> | batch <test1> <test2> ... | --read <run-id> | --check <run-id> | --save <run-id>
---

# Run trigger.dev Integration Test

Use @agent-general-purpose to execute and monitor trigger.dev integration tests.

**Arguments:**
- `[test-name]` - Run a specific test (e.g., `stripe-customer`, `quickbooks-sync`)
- `all <directory>` - Run all tests in a directory sequentially
- `batch <test1> <test2> ...` - Run multiple specific tests sequentially
- `--check <run-id>` - Check status of running test
- `--read <run-id>` - Read completed test results
- `--save <run-id>` - Save test results to database
- **No arguments** - Run the test configured in `.trigger-dev-test.json` (DEFAULT behavior)

**Examples:**
```
/task:run stripe-customer
/task:run all app/src/server/integrations/test-runner/samples/quickbooks/gap-report
/task:run batch stripe/customer.yaml quickbooks/sync.yaml
/task:run --check run_abc123
/task:run --read run_abc123
```

**Execution:**
When this command is invoked, use @agent-general-purpose with the instruction: "Follow the test execution and monitoring methodology from docs/agents/test-runner.md to run the integration tests."

**DEFAULT BEHAVIOR (No Parameters):**
When no arguments are provided, the agent will automatically run the test specified in `.trigger-dev-test.json`. Do NOT ask for clarification - just execute the configured test.

For batch execution:
- Tests run sequentially (one at a time)
- Results are appended to `task-run-status.md`
- Execution continues even if individual tests fail
- Summary provided at the end

The agent will handle all test execution, monitoring, and reporting automatically in its isolated context.

IMPORTANT
- **If no arguments provided**: The agent will automatically run the test configured in `.trigger-dev-test.json` - do NOT ask for clarification or additional input
- The agent has explicit instructions to use the configured test as the default behavior
- Only when specific test names, batch commands, or directory commands are provided should the agent deviate from the configured test
