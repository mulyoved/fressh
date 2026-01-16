# Analyze Test Results with Deep Code Correlation

Use @agent-general-purpose to perform deep analysis of integration test results with code correlation.

**Usage:**
```
/task:analyze [run-id]
```

**Arguments:**
- No arguments - Analyze the most recent test run
- `<run-id>` - Analyze a specific test run by ID (e.g., `run_cmdckhnrab4uo27n4k4e1fixj`)

**Examples:**
```
/task:analyze
/task:analyze run_cmdckhnrab4uo27n4k4e1fixj
```

**Execution:**
When this command is invoked, use @agent-general-purpose with the instruction: "Follow the comprehensive test analysis methodology from docs/agents/test-analyzer.md to analyze the test results."

The agent will:
1. Read the task-summary.md file for comprehensive context
2. Correlate log entries with actual code implementation
3. Trace code execution paths through detailed logs
4. Identify root causes with specific code references
5. Provide actionable fixes with file paths and line numbers

This command emphasizes understanding HOW and WHY the code behaves as shown in the logs, not just WHAT happened.