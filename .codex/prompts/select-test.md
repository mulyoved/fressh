---
description: Select and configure trigger.dev test
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(find*), Bash(ls*), Bash(cat .trigger-dev-test.json*), Bash(*jq*)
argument-hint: [test-name] | list | search <pattern>
---

# Select trigger.dev Test

## Context

Check current configuration in `app/.trigger-dev-test.json` and find available test files in `app/src/server/integrations/test-runner/samples/`

## Arguments

- `$ARGUMENTS` - Test name, "list" to show all tests, or "search <pattern>" to find tests

## Your Task

### If "list" argument:

Show all available test files organized by integration

### If "search <pattern>" argument:

Find test files matching the pattern

### If test name provided:

Update `.trigger-dev-test.json` with the selected test

### If no arguments:

Show current configuration and suggest common tests

## Process

### 1. Find Test File

Search in `app/src/server/integrations/test-runner/samples/`:

- Use exact match if full path provided
- Search by partial name if needed
- Show similar options if not found

### 2. Update Configuration

Update `app/.trigger-dev-test.json`:

**IMPORTANT**: Only change the `testFileName`. Do NOT modify `organizationId` or `userId` unless specifically requested by the user.

```json
{
  "organizationId": "<preserve-existing-value>",
  "testFileName": "<relative-path-from-samples>",
  "userId": "<preserve-existing-value>"
}
```

### 3. Verify Update

- Show the updated configuration
- Confirm the test file exists
- Suggest running with `/task:run`

## Test Organization

### By Integration

- **QuickBooks**: Customer sync, invoice management, tax handling
- **Stripe**: Payment processing, subscription lifecycle, deal sync
- **NetSuite**: Customer/contact sync, invoice workflows
- **HubSpot**: Deal management, contact updates
- **Green Invoice**: Customer and invoice synchronization

### By Test Type

- **Basic Sync**: Simple object synchronization
- **Bidirectional**: Two-way sync scenarios
- **Edge Cases**: Error handling and special conditions
- **Lifecycle**: Complete workflow testing

## Example Usage

```
/task:select-test list
/task:select-test search invoice
/task:select-test stripe-customer
/task:select-test quickbooks/gap-report/quickbooks-core8-basic-sync-3700-s1
```
