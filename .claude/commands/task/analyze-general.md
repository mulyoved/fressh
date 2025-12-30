# Analyze General Trigger.dev Task Logs with Code Correlation

Use @agent-general-purpose to perform deep analysis of any Trigger.dev task execution logs with comprehensive code correlation.

**Usage:**
```
/task:analyze-general [run-id]
```

**Arguments:**
- No arguments - Analyze the most recent task run in the logs
- `<run-id>` - Analyze a specific task run by ID (e.g., `run_cmer8rj94ih5027oo19jw2mi6`)

**Examples:**
```
/task:analyze-general
/task:analyze-general run_cmer8rj94ih5027oo19jw2mi6
```

**Execution:**
When this command is invoked, use @agent-general-purpose with the instruction: "Analyze the specified Trigger.dev task logs using the comprehensive methodology below."

The agent will:
1. Extract and filter logs for the specific run ID from the JSONL file
2. Correlate log entries with actual code implementation
3. Trace task execution flow and data transformations
4. Identify performance patterns, errors, and optimization opportunities
5. Provide actionable insights with specific code references

## Analysis Methodology

### 1. Log Extraction and Filtering
Start by identifying the run ID and extracting relevant logs:

```bash
# Get most recent run ID if not provided
LATEST_RUN=$(tail -1000 logs/trigger.dev.jsonl | jq -r 'select(.runId != null) | .runId' | tail -1)

# Extract all logs for specific run ID
cat logs/trigger.dev.jsonl | jq --arg runId "$RUN_ID" 'select(.runId == $runId)' > /tmp/task_logs.json

# Get run metadata
cat /tmp/task_logs.json | jq -s '[.[0] | {runId, taskId, hostname, pid}]'

# Get execution timeline
cat /tmp/task_logs.json | jq -s 'sort_by(.time) | [.[] | {time: (.time/1000 | strftime("%H:%M:%S")), level, msg, properties}]'
```

### 2. Task Execution Flow Analysis
Analyze the complete execution flow:

```bash
# Get execution timeline with key events
cat /tmp/task_logs.json | jq -s '
  sort_by(.time) | 
  map(select(.level >= 30)) | 
  [.[] | {
    timestamp: (.time/1000 | strftime("%H:%M:%S")), 
    level: (if .level == 20 then "DEBUG" elif .level == 30 then "INFO" elif .level == 40 then "WARN" elif .level >= 50 then "ERROR" else "OTHER" end),
    message: .msg,
    key_properties: (.properties | with_entries(select(.key | test("Id$|name|status|error|count|duration"))))
  }]'

# Track data transformations through properties
cat /tmp/task_logs.json | jq -s '
  [.[] | select(.properties != null)] |
  group_by(.msg) |
  map({
    operation: .[0].msg,
    count: length,
    sample_properties: (.[0].properties | keys | sort)
  })'
```

### 3. Error and Performance Analysis
Identify issues and bottlenecks:

```bash
# Extract errors and warnings
cat /tmp/task_logs.json | jq -s '[.[] | select(.level >= 40)] | sort_by(.time)'

# Find performance metrics
cat /tmp/task_logs.json | jq -s '
  [.[] | select(.properties.duration != null or .properties.count != null or .msg | test("took|duration|performance"))] |
  sort_by(.time)'

# Analyze message patterns
cat /tmp/task_logs.json | jq -s 'group_by(.msg) | map({message: .[0].msg, frequency: length}) | sort_by(-.frequency)'
```

### 4. Code-Log Correlation Requirements
**MANDATORY**: For each significant log entry, find and examine the corresponding code:

- **Search for log messages in codebase**: Use `grep -r "exact log message" src/ --include="*.ts" --include="*.js"`
- **Trace execution paths**: Follow function calls from log points back to entry points
- **Understand data flow**: Examine how properties are created, transformed, and used
- **Identify business logic**: Connect logged operations to actual business requirements

### 5. Deep Investigation Patterns

```bash
# Track specific entity through entire execution
ENTITY_ID="your-entity-id"
cat /tmp/task_logs.json | jq --arg id "$ENTITY_ID" '
  select(.properties | tostring | contains($id)) | 
  {time: (.time/1000 | strftime("%H:%M:%S")), msg, relevant_props: .properties}'

# Find all unique property keys to understand data structure
cat /tmp/task_logs.json | jq -s '
  [.[] | .properties // {}] | 
  map(keys) | 
  add | 
  unique | 
  sort'

# Analyze execution phases by message patterns
cat /tmp/task_logs.json | jq -s '
  group_by(.msg | split(" ")[0]) |
  map({
    phase: .[0].msg | split(" ")[0],
    start_time: (min_by(.time).time/1000 | strftime("%H:%M:%S")),
    end_time: (max_by(.time).time/1000 | strftime("%H:%M:%S")),
    duration_seconds: ((max_by(.time).time - min_by(.time).time) / 1000),
    message_count: length
  }) |
  sort_by(.start_time)'
```

## Analysis Output Format

**MANDATORY**: Every analysis must include comprehensive evidence and code correlation:

```markdown
## Task Execution Analysis

**Run ID**: [extracted run ID]
**Task ID**: [task identifier]
**Status**: ✅ COMPLETED / ❌ FAILED / 🔄 IN_PROGRESS
**Duration**: [total execution time]
**Host**: [execution environment]

## Execution Timeline

[Chronological list of key events with timestamps]

## Data Flow Analysis

### Key Operations
- [List major operations with frequency and duration]

### Property Evolution
- [Track how key data properties change throughout execution]

## Code-Log Correlation Findings

### Finding 1: [Specific behavior or pattern]

**Log Evidence**:
- [Exact log entries with timestamps]
- [Property values and changes]
- [Message patterns and frequencies]

**Code Implementation**:
- [File paths and line numbers: `src/trigger/task-name.ts:42`]
- [Actual code snippets that generate these logs]
- [Function signatures and logic flow]

**Correlation Analysis**:
- [Explain how the code produces the observed behavior]
- [Connect property transformations to code logic]
- [Identify why certain patterns emerge]

## Performance Insights

- [Execution bottlenecks with timings]
- [Resource usage patterns]
- [Optimization opportunities]

## Issues and Recommendations

- [Errors or warnings found]
- [Code improvements suggested]
- [Monitoring recommendations]
```

## Essential Investigation Process

1. **Extract logs for the specific run ID** from `logs/trigger.dev.jsonl`
2. **Analyze execution flow** chronologically to understand task progression
3. **For each significant log message, find the source code** that generates it
4. **Trace data transformations** through properties to understand business logic
5. **Identify patterns and anomalies** in execution behavior
6. **Correlate performance metrics** with code complexity
7. **Provide actionable insights** with specific file paths and improvements

## Evidence Requirements

- Never make claims without supporting log entries AND source code references
- Always provide timestamps and log levels for evidence
- Always provide file paths and line numbers for code correlation
- Show exact property values and their evolution
- If you cannot find supporting evidence in code, explicitly state limitations
- Focus on understanding WHY the task behaves as shown in the logs

This command emphasizes understanding the complete task execution flow through both logs and source code, providing insights that go beyond just WHAT happened to explain HOW and WHY it happened.