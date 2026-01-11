---
description: Analyze test results from saved logs and suggest fixes
allowed-tools: Read(*), Grep(*), Bash(cat*), Bash(jq*), Bash(sed*), Bash(head*), Bash(tail*)
argument-hint: [run-id] | current
---

# Analyzing Test Results from Saved Logs

## Context

Test files available: !`ls -la task-*.md task-*.jsonl 2>/dev/null | wc -l` files
Arguments: `$ARGUMENTS` - Optional run ID or "current" for latest results

## Overview

Test results was saved using `./scripts/run-integration-test.mjs --read <run-id>`.

The analysis is based on two generated files:

1. **task-summary.md** - 🚨 **START HERE ALWAYS** - Comprehensive summary with full test context, execution flow, and AI analysis
2. **task-log.jsonl** - Detailed logs in JSONL format - ⚠️ **ONLY query when you need specific properties not in summary**

## 🔴 CRITICAL: Analysis Order

### 📋 WHY task-summary.md FIRST?

The summary file is **not just a summary** - it contains:

- **Complete test flow** with every important event
- **AI-generated root cause analysis** that already diagnosed the issue
- **All error details** including stack traces and exact values
- **Full test YAML** showing what was expected
- **Execution timeline** with all child tasks and their results

**Example: The summary already tells you:**

- "fieldsDiff expected [3 differences] but got null"
- "Gap report validation failed at step S6.4"
- "The field difference detection isn't properly handling null values"
- Complete recommendations for fixing the issue

### 1. ALWAYS Start with task-summary.md

```bash
cat task-summary.md
```

**⚠️ DO NOT skip to task-log.jsonl - the summary has the complete analysis!**

### 2. ONLY Query task-log.jsonl When Needed

Use focused jq queries **ONLY** when you need specific properties not shown in the summary:

```bash
# ✅ GOOD: Focused query for specific property
cat task-log.jsonl | jq 'select(.runId == "run_abc123" and .properties.fieldChanges != null) | .properties.fieldChanges'

# ❌ BAD: Browsing logs without specific target
cat task-log.jsonl | jq .
```

## Your Task

1. **Read the ENTIRE task-summary.md** - It has the full test flow and context
2. **Understand the test** - The summary shows what it was trying to accomplish
3. **Review the AI analysis** - The summary includes root cause analysis
4. **Check the timeline** - All important events are already extracted
5. **ONLY if needed**, query task-log.jsonl for specific missing properties
6. **Suggest fixes** - Based on the comprehensive analysis

## Analysis Workflow

### 1. 🔴 MANDATORY: Read Complete Summary First

```bash
cat task-summary.md
```

**Key sections in order of importance:**

1. **AI ANALYSIS RESULTS** - Contains complete root cause analysis
2. **Test Execution Summary** - Shows what failed and why
3. **Test File Content** - Shows the test's intent and expectations
4. **Complete Log Timeline** - Full execution flow with all events
5. **Run Results** - Error details and stack traces

**The summary file is comprehensive - it contains:**

- Every important log entry from the execution
- Full error messages and stack traces
- Variable values and object IDs
- Child task information
- Complete timeline of events

### 2. ⚠️ ONLY Query Logs for Missing Properties

**Only use task-log.jsonl when you need a specific property that's not in the summary:**

```bash
# 🎯 FOCUSED QUERIES - Only use when summary doesn't have the property you need:

# Get specific field changes for an object (if not shown in summary)
cat task-log.jsonl | jq 'select(.runId == "run_abc123" and .properties.fieldChanges != null) | .properties.fieldChanges'

# Find exact property value for a specific object
cat task-log.jsonl | jq 'select(.properties.customerId == "cus_ABC123") | .properties.mappedValues'

# Get detailed integration response (if error details in summary are insufficient)
cat task-log.jsonl | jq 'select(.msg | contains("Backend API response")) | .properties.response'

# Extract specific nested property from a known log entry
cat task-log.jsonl | sed -n '76p' | jq '.properties.integrationData.specificField'

# ❌ AVOID THESE BROAD QUERIES:
# cat task-log.jsonl | jq .                    # Too broad
# cat task-log.jsonl | grep "customer" | jq .  # Use summary instead
# cat task-log.jsonl | jq 'select(.level >= 50)' # Errors are in summary
```

### 3. Common Patterns to Look For

#### Integration Sync Issues

- Missing or incorrect field mappings
- Data type mismatches
- Required fields not being set

#### Webhook Processing

- Look for `[WEBHOOK_SIM]` entries
- Check `[TEST_SYNC]` status messages

#### Object References

- Track `REF/` entries to understand object relationships
- Verify IDs are correctly linked between systems

#### Approval Flow

- `[APPROVAL]` entries show staging workflow
- Check for conflicts or missing approvals

### 4. Root Cause Analysis

Based on the error in the summary:

1. Identify what step failed
2. Find the expected vs actual values
3. Trace back through the logs to find where the issue originated
4. Check the test file content for requirements

### 5. Suggest Fixes

Provide specific recommendations:

- Code changes with file paths and line numbers
- Configuration updates needed
- Test script modifications
- Missing integration mappings

## Example Analysis Output

After analyzing the logs, **ALWAYS include this header information first:**

```markdown
## Test Results Summary

**Run ID**: run_cmdckhnrab4uo27n4k4e1fixj
**Main Object**: cus_Y6mD1cdtffHBmDJH8P (Acme Corporation)
**Status**: ✅ PASSED / ❌ FAILED
**Duration**: 4m 2s

## Test Failure Analysis (if failed)

### Test: [Test Name]

**Root Cause**: [Brief description]

### Error Details

[What went wrong and where]

### Suggested Fix

1. **File**: `path/to/file.ts`
   **Issue**: [Description]
   **Fix**: [Code snippet or change needed]

2. **Configuration**: [If applicable]
   **Change**: [What needs updating]

### Verification Steps

[How to verify the fix works]
```

**CRITICAL**: Always extract and display the Run ID and Main Object information at the beginning of your analysis. This information is essential for tracking and referencing test results.

## Tips

- Start with the high-level summary before diving into detailed logs
- Use jq queries to filter large log files efficiently
- Pay attention to the test's CRITICAL REQUIREMENTS section
- Track object IDs through their lifecycle using REF entries
- Look for patterns in WARNING messages that might indicate the root cause

## Common Issues and Debugging

### Issue: Sync State Conflicts (sync-conflict instead of sync)

**Symptoms**: Test expects `sync` state but object is in `sync-conflict` state.

**Root Cause**: Field value differences between integration (e.g., QuickBooks) and Core8.

**Debugging Steps**:

1. **Check if logs are complete** - The extracted logs might be missing child task logs:

   ```bash
   # Count total logs
   cat task-log.jsonl | wc -l

   # If you see fewer than expected logs (e.g., 104 instead of 200+),
   # the log extraction might be incomplete. Child task logs containing
   # sync state transitions might be missing.
   ```

2. **Look for sync state transitions**:

   ```bash
   # Find sync state changes (may not appear if logs are incomplete)
   cat task-log.jsonl | jq 'select(.msg | contains("Setting sync state"))'

   # If no results, check the original trigger.dev logs:
   grep "Setting sync state" logs/trigger.dev.jsonl | grep "<object-id>"
   ```

3. **Find field comparison logs**:

   ```bash
   # Look for field differences that caused the conflict
   cat task-log.jsonl | jq 'select(.msg | contains("FIELD COMPARISON"))'

   # View field changes in detail
   cat task-log.jsonl | jq 'select(.properties.fieldChanges) | {msg: .msg, changes: .properties.fieldChanges}'
   ```

4. **Common field differences that cause conflicts**:
   - **Postal Code formatting**: Core8 might change "78701" to "78702"
   - **Country field**: Core8 adds "United States of America" when integration has no value
   - **Phone formatting**: Different formats between systems
   - **Default values**: Core8 might add defaults that don't exist in the integration

**Example Analysis**:

```bash
# Find the specific object's sync state changes
grep "Setting sync state for customer/cus_ABC123" logs/trigger.dev.jsonl | jq '{time: .time, msg: .msg}'

# Output might show:
# NEW → syncStateFull (initial sync)
# syncStateFull → syncStateShadow (conflict detected)
```

### Issue: Missing Child Task Logs

**Symptoms**: Important logs from `integration-action` tasks are missing from extracted logs.

**Root Cause**: The log extraction uses run ID filtering instead of time-range approach.

**Workaround**: Check the original trigger.dev logs directly:

```bash
# Get parent task time range
cat task-log.jsonl | jq 'select(.runId == "run_parent_id") | {time: .time}' | jq -s '[.[0].time, .[-1].time]'

# Search original logs within that time range
cat logs/trigger.dev.jsonl | jq 'select(.time >= START_TIME and .time <= END_TIME) | select(.msg | contains("your-search-term"))'
```

### Issue: Multiple Change Logs (Expected 1, Found 4+)

**Symptoms**: Test fails with "Change logs: expected 1 entries but found 4" or similar.

**Root Cause**: False-positive change detection causing unnecessary repeated updates to external integration.

**Debugging Steps**:

1. **Count actual integration updates**:

   ```bash
   # Check how many times we updated the same object (should be 1)
   cat task-log.jsonl | grep "stripe.updateObject <object_type>/<object_id>" | wc -l
   ```

2. **Find the false-positive comparison**:

   ```bash
   # Look for differences that triggered unnecessary updates
   cat task-log.jsonl | grep -A 20 "\[Integration Object Comparison\] DIFFERENCES FOUND between current and new integration objects for <object_type>/<object_id>"
   ```

3. **Identify problematic fields**:
   ```bash
   # Extract the differenceKeys to see which fields are causing false positives
   cat task-log.jsonl | jq 'select(.msg | contains("Integration Object Comparison")) | .properties.differenceKeys'
   ```

**Common False-Positive Fields**:

- **period_start/period_end**: External system (e.g., Stripe) auto-overwrites with current timestamp
- **timestamps**: Integration returns server timestamps different from sent values
- **auto-calculated fields**: External system modifies fields we're comparing

**Solution**: Update integration mapping to exclude these auto-modified fields from comparison logic.

## Quick Reference Commands

```bash
# Count errors by type
cat task-log.jsonl | jq -r 'select(.level >= 50) | .msg' | sort | uniq -c | sort -nr

# Find first error occurrence
cat task-log.jsonl | jq 'select(.level >= 50)' | head -1

# View test requirements from summary
cat task-summary.md | sed -n '/CRITICAL REQUIREMENTS/,/^##/p'

# Extract error timeline
cat task-log.jsonl | jq 'select(.level >= 40) | {time: .time, level: .level, msg: .msg}' | jq -s 'sort_by(.time)'

# Find all child task run IDs
cat task-summary.md | grep -o 'run_[a-zA-Z0-9]*' | sort | uniq

# Check for field differences
cat task-log.jsonl | jq 'select(.properties.fieldChanges or .properties.changedFields)' | jq '{msg: .msg, fields: (.properties.fieldChanges // .properties.changedFields)}'

# Debug multiple change logs issue
cat task-log.jsonl | grep "updateObject" | grep -o '<object_type>/<object_id>' | sort | uniq -c
cat task-log.jsonl | jq 'select(.properties.differenceKeys) | {msg: .msg, keys: .properties.differenceKeys}'
```
