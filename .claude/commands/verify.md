---
description: Verify a GitHub issue/PR is fixed with comprehensive evidence
allowed-tools: Bash(*), Read(*), Write(*), WebFetch(*)
---

# /verify

Verify a GitHub issue or PR is fixed with comprehensive evidence collection.

## Usage

```
/verify #8000          # Verify issue #8000
/verify --pr 8001      # Verify PR #8001
```

## Arguments

Parse from: `$ARGUMENTS`

---

## Workflow

**Key principle: LLM-driven analysis, script-assisted data collection.**

### Step 1: Initialize Session

```bash
# For issue
yarn tsx .claude/skills/github-issue-verifier/scripts/init-verification.ts --issue=$NUMBER

# For PR
yarn tsx .claude/skills/github-issue-verifier/scripts/init-verification.ts --pr=$NUMBER
```

### Step 2: Analyze the Issue (YOU do this, not a script)

Read the issue/PR body from session.json. Understand semantically:

1. **What is the bug/feature?** - What was broken or added?
2. **What needs verification?** - What specific behaviors prove it works?
3. **What evidence to collect?** - Which APIs, DB queries, or pages to check?

**Do NOT use regex patterns** - use your understanding of the issue.

### Step 3: Collect Evidence

Use scripts for **deterministic data collection**:

```bash
# API calls
yarn tsx .claude/skills/github-issue-verifier/scripts/call-trpc.ts \
  --router=<router> --method=<method> --args='<json>' \
  --output=app/docs/verify/$NUMBER/evidence/api-responses/<name>.json

# Database queries
yarn tsx .claude/skills/github-issue-verifier/scripts/query-db.ts \
  --query='<sql>' --params='<json array>' \
  --output=app/docs/verify/$NUMBER/evidence/db-queries/<name>.json

# Screenshots (if SweetLink available)
yarn tsx .claude/skills/github-issue-verifier/scripts/sweetlink-capture.ts \
  --action=screenshot --env=local --path="<page>" \
  --output=app/docs/verify/$NUMBER/evidence/screenshots/<name>.png
```

### Step 4: Analyze Evidence (YOU do this)

Read the collected evidence files. Determine:
- Does the evidence show the fix works?
- Are there any unexpected behaviors?
- Any edge cases that need attention?

### Step 5: Write the Report (YOU do this)

Write the final verification report to `app/docs/verify/$NUMBER/README.md`:

```markdown
# Verification Report: Issue #$NUMBER

## Summary
[What was verified and the result]

## What Was Verified
1. [Requirement 1 - from your semantic analysis]
2. [Requirement 2]

## Evidence & Analysis

### [Evidence 1]
- File: [link to evidence file]
- Analysis: [What this shows, why it proves the fix works]

### [Evidence 2]
...

## Conclusion

**Result: PASS / FAIL / PARTIAL**

[Explanation of the verification result with reasoning]
```

### Step 6: Present Results

Show the user:
1. Verification result
2. Key findings
3. Link to full report

---

## Key Principle

**Scripts are for data collection. YOU are for analysis.**

| Task | Who Does It |
|------|-------------|
| Fetch issue/PR data | Script |
| Understand requirements | LLM (you) |
| Call APIs, query DB | Script |
| Analyze results | LLM (you) |
| Draw conclusions | LLM (you) |
| Write report | LLM (you) |
