---
description: Generate test scenarios for a commission plan based on code analysis
allowed-tools: Bash(*), Read(*), Write(*)
---

# /plan:create-test-spec

Generate minimal, high-value test scenarios that validate system integration for a commission plan.
**Always creates test data in staging** if it doesn't already exist.

## Philosophy: Test Wiring, Not Code Paths

**Goal**: Minimize test I/O while maximizing confidence in the full system.

**Key Insight**: Many code paths are trivially verifiable by inspection. A simple `if (dealType === "RENEWAL")` doesn't need exhaustive testing - if one deal type routes correctly, others will too (it's just string comparison). Focus testing effort on:

1. **Data wiring** - Is the right field from the deal record reaching the calculator?
2. **Complex calculations** - Math that's hard to verify by reading code
3. **Boundary conditions** - Quota thresholds where pro-rata logic kicks in
4. **Integration points** - Where external data flows into the system

**Skip Testing**:
- Every deal type value (test ONE to prove the field is wired)
- Every deal source value (test ONE to prove the field is wired)
- Every product bucket (test ONE to prove routing works)
- Zero/null edge cases (these are obvious from code inspection)

## Usage

```
/plan:create-test-spec --planId=cmp_xxx
/plan:create-test-spec --planId=cmp_xxx --scenario=1    # Run specific scenario
```

## Arguments

- `--planId`: Plan ID (cmp_xxx format) - required
- `--scenario`: Scenario number to run (optional, runs all if omitted)

## Output

- Generates Section E (Test Scenarios) content with 3-5 focused scenarios
- **Creates test data in staging** for each scenario
- Returns **Sales Rep Dashboard URL** for verification

---

## Workflow

### Step 1: Fetch Plan Data

```bash
yarn tsx .claude/skills/plan-code-review/scripts/get-generated-code.ts \
  --planId=$PLAN_ID --includeContract
```

### Step 2: Detect Features (LLM-Driven)

Analyze the plan data from Step 1 to detect features. Look for signals in:
- `jsVariableInsights.variables[]` and `jsVariableInsights.unsupportedVariables[]`
- `generatedCode` patterns (`deal.xxx` usage, payment anchors, spiff keywords, bucket routing)
- `documentDefinition.plan.debug.staticMetadataExtract` (anchor mode, contract length, etc.)

Detect these 8 feature categories:
- Multi-year contracts (yearInContract, contractLengthMonths > 12)
- Multiple participants (participant-type variables)
- Split payments (paymentSchedule, paymentTermsDays)
- Payment-anchored commission (paymentReceivedDate)
- Product buckets (productBuckets variable)
- SPIFF/bonus logic
- Custom variables needed
- Unsupported required variables

### Step 3: Identify What Needs Testing

Categorize code elements into two buckets:

| Category | Examples | Test Strategy |
|----------|----------|---------------|
| **Wiring checks** (test once) | dealType routing, dealSource routing, product buckets | ONE test proves the field is connected |
| **Calculation logic** (test boundaries) | quota thresholds, tier boundaries, pro-rata splits | Test each boundary where math changes |

**Wiring checks** - Simple conditionals like `if (dealType === "X")`:
- If the field is wired correctly, all values will work
- Test ONE value to confirm wiring, skip the rest
- Verifiable by code inspection: "Does it read `d.dealType`? Yes? Field is wired."

**Calculation logic** - Complex math that's hard to verify by inspection:
- Quota boundary splits (pro-rata calculations)
- Cumulative attainment tracking
- Multi-tier rate lookups
- These NEED real tests

### Step 4: Generate Minimal Test Set

**Core scenarios (always needed):**

| # | Scenario | Why It Can't Be Skipped |
|---|----------|------------------------|
| 1 | Base rate deal | Validates core calculation path and rate extraction |
| 2 | Quota boundary deal | Tests pro-rata split math - impossible to verify by inspection |
| 3 | Above-quota deal | Validates accelerator rate and cumulative tracking |

**Conditional scenarios (add only if detected AND not verifiable by inspection):**

| Feature | Add Test? | Reasoning |
|---------|-----------|-----------|
| Deal type routing | Only if rates differ | If just routing with same logic, one test covers all |
| Deal source routing | Only if rates differ | Same - test ONE source to prove field is wired |
| Multi-year logic | YES | Year field wiring needs verification |
| SPIFF/Bonus | YES | Threshold logic needs boundary test |
| Product buckets | Only ONE | Proves routing works, others follow same pattern |
| Tiered rates | YES - each boundary | Math is complex, needs verification |

### Step 5: Calculate Expected Values

For each scenario, trace through the code and document the calculation.

**Example trace:**
```
Scenario: Quota boundary split
- acv=1,000,000, cumulativeACV=3,500,000
- startAttainment=3.5M, endAttainment=4.5M, QUOTA=4M
- portionBase = 4M - 3.5M = 500,000 at 1.5%
- portionAccel = 4.5M - 4M = 500,000 at 5.5%
- commission = 7,500 + 27,500 = $35,000
```

### Step 6: Create Test Data in Staging

**IMPORTANT**: Always create test data in staging for each scenario. This enables verification in the actual system.

#### 6a. Naming Convention for Test Sales Reps

Use consistent template for easy identification:

```
{PlanShortName}-S{ScenarioNum}-{ScenarioType}
```

**PlanShortName**: First name from plan name (e.g., "Ohad" from "Ohad Eylon 2024 Annual Commission Plan")

**Examples:**
- `Ohad-S1-Tier1` - Ohad's plan, Scenario 1, Tier 1 test
- `Ohad-S2-QuotaBoundary` - Ohad's plan, Scenario 2, quota boundary test
- `Borja-S1-Base` - Borja's plan, Scenario 1, base rate test
- `Dave-S3-MSSP` - Dave's plan, Scenario 3, MSSP source test

#### 6b. Check for Existing Test Data

Before creating new test data, check if personnel already exists:

```bash
yarn tsx .claude/skills/plan-test-executor/scripts/find-existing-data.ts \
  --planId=$PLAN_ID \
  --personnelNamePattern="{PlanShortName}-S{N}"
```

If found, reuse existing personnel/assignment IDs.

#### 6c. Create Test Personnel (if not exists)

```bash
yarn tsx .claude/skills/plan-test-executor/scripts/create-test-data.ts \
  --planId=$PLAN_ID \
  --personnelName="{PlanShortName}-S{N}-{Type}"
```

Returns: `personnelId`, `assignmentId`, `organizationId`

#### 6d. Create Setup Deal (if cumulative ACV needed)

For scenarios requiring pre-existing quota attainment:

```bash
yarn tsx .claude/skills/plan-test-executor/scripts/create-test-data.ts \
  --personnelId=$PERSONNEL_ID \
  --assignmentId=$ASSIGNMENT_ID \
  --setupDeal='{"acv":$SETUP_ACV,"dealType":"NEW"}' \
  --setupName="Setup: Build cumACV to $X"
```

#### 6e. Create Test Deal

```bash
yarn tsx .claude/skills/plan-test-executor/scripts/create-test-data.ts \
  --personnelId=$PERSONNEL_ID \
  --assignmentId=$ASSIGNMENT_ID \
  --dealProps='{"dealType":"$TYPE","acv":$ACV,"tcv":$TCV,"currency":"$CUR","paymentReceivedDate":"$DATE","name":"$DEAL_NAME"}'
```

#### 6f. Trigger Calculation

```bash
yarn tsx .claude/skills/plan-test-executor/scripts/trigger-calculation.ts \
  --dealId=$DEAL_ID \
  --organizationId=$ORG_ID \
  --participantId=$PARTICIPANT_ID
```

#### 6g. Return Dashboard URL

**IMPORTANT**: Always return the **Sales Rep Dashboard URL** (not the deal URL):

```
https://staging.core8.co/{orgId}/commission/{personnelId}?period=all
```

This shows all deals for the test rep, making it easy to verify multiple scenarios.

### Step 7: Output

Generate focused Section E content with **staging links**:

```markdown
## E: Test Scenarios

### Test Philosophy

This plan requires **N scenarios** based on:
- [X] Core calculation path (base rate)
- [X] Quota boundary (pro-rata split)
- [X] Accelerator rate (above quota)
- [ ] Feature X - skipped (verifiable by code inspection)

### Scenario Table

| # | Scenario Name | Deal Properties | Expected | Actual | Status |
|---|---------------|-----------------|----------|--------|--------|
| 1 | Base rate | acv=X, tcv=Y | $A | $A | PASS |
| 2 | Quota boundary | acv=X, cumACV=Z | $B | $B | PASS |
| 3 | Above quota | acv=X, cumACV=W | $C | $C | PASS |

### Staging Links

| Scenario | Sales Rep Name | Dashboard URL |
|----------|----------------|---------------|
| S1 | {Name}-S1-Tier1 | https://staging.core8.co/{orgId}/commission/{personnelId}?period=all |
| S2 | {Name}-S2-QuotaBoundary | https://staging.core8.co/{orgId}/commission/{personnelId}?period=all |

### Calculation Traces
[Include traces for each scenario]
```

---

## Example Output

For a plan with quota=$4M, standard=1.5%, MSSP=5%, accelerator=5.5%, renewal=1%:

```markdown
## E: Test Scenarios

### Test Philosophy

This plan requires **4 scenarios**:
- Core calculation (validates base rate math)
- Quota boundary (validates pro-rata split - complex math)
- Above quota (validates accelerator and cumulative tracking)
- MSSP source (validates dealSource field is wired - ONE test covers all sources)

**Skipped**: Multiple deal types (NEW/UPSELL/EXPANSION use same logic),
zero ACV (obvious from code), multiple MSSP deals (one proves wiring).

### Scenario Table

| # | Scenario | Deal Properties | Expected | Actual | Status |
|---|----------|-----------------|----------|--------|--------|
| 1 | Standard base | dealType=NEW, acv=500k, cumACV=0 | £7,500 | £7,500 | PASS |
| 2 | Quota split | dealType=NEW, acv=1M, cumACV=3.5M | £35,000 | £35,000 | PASS |
| 3 | Above quota | dealType=NEW, acv=500k, cumACV=4.5M | £27,500 | £27,500 | PASS |
| 4 | MSSP source | dealType=NEW, dealSource=MSSP, acv=500k | £25,000 | £25,000 | PASS |

### Staging Links

| Scenario | Sales Rep Name | Dashboard URL |
|----------|----------------|---------------|
| S1 | Dave-S1-Base | https://staging.core8.co/7490465/commission/abc123?period=all |
| S2 | Dave-S2-QuotaBoundary | https://staging.core8.co/7490465/commission/def456?period=all |
| S3 | Dave-S3-Accelerator | https://staging.core8.co/7490465/commission/ghi789?period=all |
| S4 | Dave-S4-MSSP | https://staging.core8.co/7490465/commission/jkl012?period=all |

### Calculation Traces
[traces for each]
```

**Note**: Renewal deals are NOT tested separately if the only difference is rate (1%).
The dealType field wiring is already proven by scenario 1. We can verify the 1% rate
by code inspection.

---

## Decision Guide: Test or Skip?

Ask these questions:

1. **Is this just a different value for a field already tested?**
   - YES → Skip (field wiring already proven)
   - NO → Consider testing

2. **Can I verify correctness by reading the code for 10 seconds?**
   - YES → Skip (e.g., `rate = 0.01` is obviously 1%)
   - NO → Test (e.g., pro-rata split calculation)

3. **Does this test a BOUNDARY where behavior changes?**
   - YES → Test (quota thresholds, tier boundaries)
   - NO → Skip (middle-of-tier values add no information)

4. **Would a bug here be caught by other tests?**
   - YES → Skip (redundant coverage)
   - NO → Test (unique failure mode)

---

## Related

- **Template**: `plan-code-review/references/COMBINED_REVIEW_TEMPLATE.md` (Section E)
- **Feature detection**: LLM-driven (see Step 2 above, or `plan-client-questions` skill)
- **Code fetching**: `plan-code-review/scripts/get-generated-code.ts`
