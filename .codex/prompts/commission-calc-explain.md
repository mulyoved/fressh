---
name: /commission-calc-explain
description: Explain a Cube9 commission calculation trace and answer a specific question about it.
params:
  TRACE:
    label: Pipeline trace JSON
    description: Raw pipelineTrace JSON from the Commission Deal calculation page (tab=calculation&step=5).
    required: true
    multiline: true
  QUERY:
    label: Question
    description: Your question about this calculation (for example, why is commission 0 or why a runtime var is missing).
    required: true
    multiline: true
---

You are a senior engineer helping debug a commission calculation in the Cube9 app.

You are given:
- A single `pipelineTrace` JSON object for one deal (pasted below as `TRACE`).
- A concrete question from the user about that calculation (given as `QUERY`).

Your job:
- Carefully read the trace and the embedded generated calculator code.
- Reconstruct which paths the calculator took for this specific deal.
- Explain precisely why the final base amount, commission, applied rate, and runtime variables look the way they do.
- Answer the user’s question in a clear, implementation-aligned way.

---

## Context

Here is the raw `pipelineTrace` JSON for the deal:

```json
$TRACE
```

Key structures to pay attention to:
- `planSearch` – how the plan and assignment were selected.
- `anchorDate` – resolved anchor date and mode.
- `windows` – accrual window, pool window, and poolContext (quota context).
- `calculator.engineInfo.generatedCode` – the JavaScript calculator implementation (typically `calculateCommissionPerDeal(deals, onDeal)`).
- `calculator.dealEvent` – the per-deal event used for display (baseAmount, commission, appliedRate, runtimeVars).
- `calculator.results` – numeric summary (baseAmount, commissionAmount, quotaCreditAmount, appliedRate).
- `variables.insights` – plan-declared calculator variables and their intended meanings.
- `gates` – payout gates (PAYMENT/INVOICE) that may block payout but do not change calculator math.
- `persistence` – calculationId and status (CALCULATED, WAITING_*, FAILED).

The canonical calculator input is derived from effective variables:
- Effective variables = `sourceValues` merged with `userEdits`.
- `normalizeCalculatorInput(effective)` produces the calculator input.
- In the UI this appears in **Build Input / Calculator inputs** as `Effective` vs `Original (source)`.
- When a field shows `—` in Effective, it means the calculator saw that field as `undefined` or `null`.

Runtime variables (decision signals):
- The calculator may push `vars` into the `onDeal` event, for example:
  - `vars.push({ key: "attainment.cumulative.after", value: cumulativeArr, fmt: "currency" });`
- The runner validates these with the runtime-var schema (key, value, optional fmt).
- If valid and non-empty, they surface as `calculator.dealEvent.runtimeVars`.
- The UI only renders the Runtime Variables table when `runtimeVars` is present and has length > 0, grouped by key prefix (quota, attainment, tier, component, etc.).

Gates:
- PAYMENT/INVOICE gates affect payout timing and status, not the calculator math.
- The calculator still runs and computes commission for gated deals; the gate only determines whether the commission can be paid out yet.

---

## Task

The user’s question about this calculation:

> $QUERY

Please:

1. **Summarize plan and timing**
   - Identify the selected plan and assignment from `planSearch`.
   - Confirm anchor date and windows from `anchorDate` and `windows`.
   - Briefly describe poolContext (total deals, total commissionable value, window label).

2. **Reconstruct calculator inputs**
   - From the trace, infer the effective values for the key calculator fields the generated code uses (for example, `annualRecurringRevenue`, `nonRecurringRevenue`, `dealType`, `customerType`, `closeDate`, `paymentSchedule`, `paymentTermsDays`).
   - Call out any fields that are effectively missing (`—` / null / undefined) and how that impacts the calculator paths.

3. **Analyze the generated calculator code**
   - Read `calculator.engineInfo.generatedCode` and identify:
     - Eligibility checks (for example, new business + enterprise/strategic).
     - Each commission component:
       - NRR commission.
       - ARR tiers and cumulative attainment.
       - Spiffs (for example, upfront payment spiff conditions).
     - Where runtime variables are pushed into `vars`.

4. **Determine which branches ran for this deal**
   - Using both the inputs and the code, walk through execution for this specific deal:
     - Did the deal pass eligibility? Why?
     - What values were used for ARR and NRR?
     - Did the ARR block (`if (dealArr > 0)`) run? If so, how much went into each tier, and how did `cumulativeArr` change?
     - Did any spiff conditions pass (ARR thresholds, payment schedule, payment terms)? If not, which conditions failed?
   - Cross-check with `calculator.dealEvent`:
     - `baseAmount`, `commission`, `appliedRate`.
     - `runtimeVars` (if present).

5. **Explain the final numbers**
   - If commission is non-zero:
     - Break it down into components (NRR, ARR tier1/tier2, spiffs).
     - Show a small table:

       | Component      | Basis            | Rate   | Amount   |
       | -------------- | ---------------- | ------ | -------- |
       | ARR Tier 1     | ...              | ...    | ...      |
       | ARR Tier 2     | ...              | ...    | ...      |
       | NRR            | ...              | ...    | ...      |
       | Spiff          | ...              | ...    | ...      |

   - If commission is zero:
     - Identify all key guardrails that resulted in zero commission (eligibility, missing ARR/NRR, failed spiff conditions).
     - For each guard, state whether it passed or failed and why, using the specific values from the trace.

6. **Explain runtime variables (if any)**
   - If `runtimeVars` is non-empty:
     - Group them by key prefix (quota, attainment, tier, component, etc.).
     - Explain what each key/value means in the context of this deal.
     - Optionally, illustrate attainment flow with a small Mermaid (“Marmite-style”) chart showing before/after attainment for this deal.
   - If `runtimeVars` is missing or empty:
     - Explain why (for example, ARR block never ran, calculator did not push any vars for this path).

7. **Clarify gate impact**
   - Describe any gates present and their status.
   - Explain how they affect payout vs calculation.

8. **Directly answer the user’s question**
   - Give a concise, concrete answer to `QUERY`, backed by the step-by-step reasoning above.
   - Reference specific values and branches (for example, “commission is 0 because `annualRecurringRevenue` was missing, so `dealArr` was 0 and the ARR block never ran; NRR was 0; spiff conditions failed due to QUARTERLY payment schedule and missing payment terms”).

Keep your explanation precise and numeric so another engineer can follow the entire flow from the trace and the generated code to the final result.
