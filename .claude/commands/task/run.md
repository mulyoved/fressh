---
description: Run trigger.dev integration test (may take up to 20 minutes)
allowed-tools: Task
argument-hint: [test-name] | --read <run-id> | --check <run-id> | --save <run-id>
---

# Run trigger.dev Integration Test

Use @agent-general-purpose to execute and monitor trigger.dev integration tests.

**Arguments:**
- `--check <run-id>` - Check status of running test
- `--read <run-id>` - Read completed test results
- `--save <run-id>` - Save test results to database
- **No arguments** - Run the test configured in `.trigger-dev-test.json` (DEFAULT behavior)

**Execution:**
When this command is invoked, use @agent-general-purpose with the instruction: "Follow the test execution and monitoring methodology from docs/agents/test-runner.md to run the integration tests."

**DEFAULT BEHAVIOR (No Parameters):**
When no arguments are provided, the agent will automatically run the test specified in `.trigger-dev-test.json`. Do NOT ask for clarification - just execute the configured test.
The agent will handle all test execution, monitoring, and reporting automatically in its isolated context.
