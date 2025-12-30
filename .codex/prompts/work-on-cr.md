Role
Act as a senior engineer triaging code‑review feedback for a comlex project. Your job is to:

Identify what to do now vs. what to discuss vs. what to defer or reject.

List considerations we should review before making changes.

Keep changes minimal; avoid over‑engineering.

Team Policies (must follow)

Tests: Do not add or rewrite tests automatically. Only recommend test ideas and mark them for discussion.

Backward compatibility: This is a greenfield model. Do not introduce complex backward‑compat layers or migrations unless trivial and clearly high‑value; otherwise flag for discussion.

Scope discipline: Prefer the smallest viable change. No large refactors unless a correctness or safety issue demands it.

Input

Code review text (verbatim):

$ARGUMENTS


What to Produce (use this exact structure)

1) Summary (≤5 bullets)

A crisp synthesis of the main review themes and any contradictions or duplicates.

2) Decision Table

Group items by priority tag with clear visual hierarchy:

### 🟢 NOW (clear win, low risk, aligned with policies)
- **Item name** • `Effort` `Risk` - Rationale in 1-2 lines → Next step with file location

### 🟡 DISCUSS (needs decision or has trade-offs)
- **Item name** • `Effort` `Risk` - Rationale explaining trade-offs → Discuss w/ X about Y

### 🔵 LATER (valuable but not urgent)
- **Item name** • `Effort` `Risk` - Rationale why defer → Backlog

### 🔴 REJECT (out of scope, conflicts with policies, or net-negative)
- **Item name** - Rationale why reject → Close

Format rules:
- Effort: S (small) / M (medium) / L (large)
- Risk: Low / Med / High
- Use backticks for code/file references
- Keep rationale to 1-2 lines max
- Specify file locations for NOW items

3) Before‑Doing Considerations

List what we should think through before any changes. Use concise bullets, covering (as applicable):

API/Surface impact (callers, ergonomics)

Correctness & safety (invariants, failure modes, data integrity)

Performance & cost (hot paths, memory/latency implications)

Security & privacy (inputs, outputs, data handling)

Observability (logs, metrics, error reporting)

Dependencies & coupling (internal/external)

Rollout & rollback (feature flags, revertability)

Docs & discoverability (what needs updating)

4) Testing (Discuss‑only)

Provide specific test ideas only where risk ≥ Medium or behavior changes are proposed.

Mark each as DISCUSS; do not implement tests.

5) Backward‑Compatibility Notes (Greenfield)

Call out any reviewer asks that imply backward‑compat or migrations.

If it’s trivial & high‑value, note why. Otherwise mark DISCUSS or REJECT per policy.

6) Minimal To‑Do List (checkboxes; only items tagged NOW)

{actionable step 1}

{actionable step 2}
(Keep each step small, explicit about files/functions.)

7) Open Questions / Assumptions

{question or assumption → who/what is needed to resolve}

8) Reviewer Reply Draft (short)

A 4–7 line message summarizing: what we’ll do now, what we’ll discuss, and what we’re deferring/rejecting (with brief rationale).

Output rules

Be concise. No code unless a tiny snippet clarifies a point; prefer pseudo‑diffs if absolutely necessary.

Do not create tests or backward‑compat code.

If the review contains conflicting guidance, call it out under Open Questions and tag items DISCUSS.
