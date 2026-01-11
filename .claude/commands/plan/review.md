---
description: Batch review multiple commission plans - generates combined code quality + client review reports
allowed-tools: Bash(*), Read(*), Write(*)
---

# /plan:review

Generate comprehensive review reports for multiple commission plans. Combines code quality assessment (from plan-code-review) with client review (open questions, system features, manual work).

## Usage

```
/plan:review                                    # Interactive: list and select plans
/plan:review --orgId=123                        # Filter by organization
/plan:review --search="sales"                   # Filter by name
/plan:review --planIds=cmp_1,cmp_2,cmp_3        # Specific plans
```

## Arguments

- `--orgId`: Filter plans by organization ID
- `--search`: Filter plans by name (partial match)
- `--planIds`: Comma-separated list of specific plan IDs to review
- `--limit`: Max plans to list (default: 20)

## Output

- **Per-plan reports**: `app/docs/tool-output/<slug>-review.md`
- **Batch summary**: `app/docs/tool-output/batch-review-<date>.md`

---

## Workflow

### Step 1: List and Select Plans

If `--planIds` provided, use those. Otherwise:

```bash
yarn tsx .claude/skills/plan-code-review/scripts/list-plans.ts \
  --orgId=$ORG_ID \
  --search="$SEARCH" \
  --limit=$LIMIT
```

Present the list to user and ask which plans to review (or "all").

### Step 2: For Each Selected Plan

#### 2a. Fetch Plan Data

```bash
yarn tsx .claude/skills/plan-code-review/scripts/get-pruned-json.ts --planId=$PLAN_ID
```

Save output to variable `planData`.

#### 2b. Code Quality Review (MUST READ ACTUAL CODE)

**CRITICAL**: You must read and verify the actual `generatedCode`, not just metadata.

If `generatedCode` is truncated in step 2a output, fetch it separately:
```bash
yarn tsx .claude/skills/plan-code-review/scripts/get-generated-code.ts --planId=$PLAN_ID --includeContract
```

Then apply the `plan-code-review` skill methodology (Step 2):
1. Extract contract elements from `contractMD` (Section 2.1, Exhibit A)
2. Read code and verify: `baseAmount`, `QUOTA`, tier thresholds, rates
3. Cross-reference each component against contract
4. Classify issues by severity (BLOCKER/HIGH/MEDIUM/LOW)

**Status determination (apply in order):**
- **FAIL**: Any BLOCKER issue (code produces wrong amounts)
- **NEEDS_CLARIFICATION**: Any HIGH issue or metadata gaps
- **PASS**: No BLOCKER or HIGH issues

**WARNING**: Never write "all plans implement X correctly" without verifying each plan individually. Check each plan's code separately.

#### 2c. Client Review (Open Questions + Features) - LLM-Driven

Analyze the plan data from step 2a to detect features and extract client questions.
Use the client review template and manual-work instructions:
- `.claude/skills/plan-client-questions/references/CLIENT_REVIEW_TEMPLATE.md`
- `.claude/skills/plan-client-questions/references/USE_CASE_INSTRUCTIONS.md`

**Feature detection signals:**
- `jsVariableInsights.variables[]` and `jsVariableInsights.unsupportedVariables[]`
- `generatedCode` patterns (`deal.xxx` usage, payment anchors, spiff keywords, bucket routing)
- `documentDefinition.plan.debug.staticMetadataExtract` (anchor mode, contract length, etc.)

**Extract:**
- System features detected (8 categories - see `plan-client-questions` skill)
- Open questions from `planSketch.openQuestions`, errors, assumptions
- Manual work required

#### 2d. Generate Test Scenarios (Section E)

For each plan, generate test scenarios that exercise all code branches:

1. **Analyze code branches**: Identify deal types, quota thresholds, rates, source routing
2. **Create test deals**: One scenario per branch with key varying properties
3. **Calculate expected values**: Manually trace through code logic
4. **Verify coverage**: Check all detected features have scenarios

See `/plan:create-test-spec` command for detailed workflow.

**Minimum scenarios per plan:**
- Below quota (base rate)
- At/above quota (accelerator)
- Renewal (if in code)
- Each detected feature (multi-year, SPIFF, etc.)

#### 2e. Generate Combined Report

Create `app/docs/tool-output/<slug>-review.md` using the template from:
`plan-code-review/references/COMBINED_REVIEW_TEMPLATE.md` (Per-Plan Report section)

### Step 3: Generate Batch Summary

After all plans processed, create `app/docs/tool-output/batch-review-<date>.md` using:
`plan-code-review/references/COMBINED_REVIEW_TEMPLATE.md` (Batch Summary section)

### Step 4: Validate and Fix Generated Reports

After generating all reports, perform these validation checks:

#### 4a. Cross-Check Status Consistency

For each plan, verify the individual report status matches what's in the batch summary:

| Individual Report Status | Has BLOCKER Issue? | Batch Summary Should Show |
|--------------------------|-------------------|---------------------------|
| NEEDS_CLARIFICATION | YES | **FAIL** (fix individual report) |
| NEEDS_CLARIFICATION | NO | NEEDS_CLARIFICATION |
| PASS | NO | PASS |

**Auto-fix rule**: If individual report has severity=BLOCKER issue but status says NEEDS_CLARIFICATION, update individual report to FAIL.

#### 4b. Verify Counts Match

Check batch summary totals match sum of individual reports:

```
Total Open Questions = Σ(each plan's Open Questions count)
Total Manual Work Items = Σ(each plan's Manual Work Items count)
Passed + Need Clarification + Failed = Plans Reviewed
```

**Auto-fix rule**: If counts don't match, recalculate from individual reports.

#### 4c. Validate "Code Bugs" Section

For each item in the batch summary's "Code Bugs Found" section:
- **BLOCKER** issues: Must be actual code defects (produces wrong amounts)
- **HIGH** issues: Must be logic gaps, not intentional design decisions
- **Excluded**: Items marked "skipped per instructions" are feature gaps, not bugs

**Auto-fix rule**: Remove or relabel items that are intentional omissions (e.g., "$18k bonus skipped per instructions" → move to "Open Questions" or "Pending Decisions").

#### 4d. Verify Links Work

Check all `[filename](filename)` links in batch summary point to existing files:

```bash
# For each link in Individual Reports section
ls app/docs/tool-output/<linked-file>.md
```

**Auto-fix rule**: Remove links to non-existent files, add links to missing generated reports.

#### 4e. Common Patterns Accuracy

For claims like "All plans implement X correctly":
- Verify by checking each individual report's verification table
- If ANY plan shows ❌ for that check, remove the "all plans" claim

#### 4f. Test Scenario Coverage Validation

For each plan's test scenarios (Section E), verify coverage is complete:

| Feature Detected | Required Test Scenarios | Check |
|------------------|------------------------|-------|
| Quota thresholds | Below, at, above quota | All 3 present? |
| Deal type routing | One per deal type in code | All types covered? |
| Multi-Year | Year 1, Year 2 minimum | Both present? |
| SPIFF/Bonus | Trigger and non-trigger | Both present? |
| Product Buckets | One per bucket | All buckets? |
| Source routing | One per source in code | All sources? |

**Completeness checks:**
- [ ] Minimum 3 scenarios per plan (below/at/above quota)
- [ ] Each `dealType` in code has a scenario
- [ ] Each rate value is tested by at least one scenario
- [ ] Edge case (zero ACV) included

**Auto-fix rule**: If detected feature has no corresponding test scenario, add placeholder:

```markdown
| ? | TODO: [feature] | [required properties] | TBD | Missing coverage |
```

---

## Error Handling

- **Plan not found**: Skip, note in summary
- **Parse data missing**: Mark as FAIL, note "No parse data available"
- **Script error**: Log error, continue with next plan

---

## Related

- **Skill**: `plan-code-review` - Code review methodology (see SKILL.md Step 2)
- **Skill**: `plan-client-questions` - Open questions and feature detection
- **Command**: `/plan:create-test-spec` - Generate test scenarios
- **Command**: `/plan:run-test-spec` - Execute test scenarios
