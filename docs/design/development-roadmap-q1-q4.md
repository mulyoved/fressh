# Development Roadmap (Q1–Q4)

## Release Scope

### V1 — Q1: Stabilize + Core Engine Complete

**Primary pillars:** P2, P3 (foundation); P4 baseline

**Must-ship scope:**
- Fix all PRD bugs/gaps (incl. timing windows BUG-1/FR-13 + reliability issues like splitting/calc failures)
- FR-10 multi-plan (assumed done)
- FR-11 multi-payee roles (assumed done)
- B2 period freeze / statement locking (assumed done)

---

### V2 — Q1: Analytics + Plan Creation UX

**Primary pillars:** P4, P5 (big lift), P2 UX lift

**Must-ship scope:**
- "Excellent analytics" for reps + managers (dashboards, drilldowns, alerts, forecasting views)
- CRM embedded widget
- LLM plan wizard using CRM data (guided plan creation)

---

### V3 — Q2: Finance-Ready + Planning-Lite Inputs + Plan Safety

**Primary pillars:** P1 starts; P3 finance lift; P2 governance

**Must-ship scope:**
- Quota management UI v1 (fix PRD L-9)
- ACCOUNTING role + RBAC + approval separation (PRD B10)
- Exports v1 (payroll/statement line exports to support manual payout workflows)
- Plan verification/backtesting v1 (critical safety net for LLM wizard)

---

### Year-End Target — Q4: Planning-Lite Moat + Enterprise Hardening

**Primary pillars:** Major lift in P1 + P3, deepen P5

**Must-ship scope:**
- Planning-lite: quota allocation + capacity modeling + sandbox scenarios
- Finance ops: payout scheduling + reconciliation basics; budget/accrual tracking v1
- Intelligence: plan effectiveness + stronger forecasting/ROI views

---

## Quarter-by-Quarter Build Plan

### Q1 (V1 + V2)

**Deliverables:**
- V1: PRD bug fixes + reliability + FR-10/FR-11 + B2 locking
- V2: Excellent analytics + CRM widget + LLM plan wizard

**Unlocks:** Credibility on complex comp + best-in-class visibility/analytics

### Q2 (V3)

**Deliverables:**
- Quota UI v1
- Accounting RBAC
- Exports
- Backtesting

**Unlocks:** V2 analytics + wizard becomes Finance-adoptable; starts real Planning pillar

### Q3

**Deliverables:**
- Quota allocation (manager → team → rep)
- Quota types/versioning
- Capacity inputs (headcount + ramp)
- Scenario sandbox v1 (quota/plan changes → payout/budget impact)

**Unlocks:** Differentiation vs "commission-only" tools; Planning narrative becomes real; execs can model spend vs targets

### Q4

**Deliverables:**
- Plan effectiveness analytics
- Improved forecasting
- Budget & variance alerts
- Payout scheduling + reconciliation basics
- One advanced lever (FR-12 time-based payouts OR FR-16 custom gates)

**Unlocks:** Closed-loop system (design → execute → optimize); stronger enterprise readiness

---

## Pillar Coverage Targets

*Percentage of best-in-class pillar capability set covered*

| Pillar | V1 | V2 | V3 | Year-End |
|--------|---:|---:|---:|---------:|
| P1 Sales Planning & Modeling | 5–10% | 10–15% | 20–30% | 40–50% |
| P2 Incentive Design & Config | 55–65% | 65–75% | 70–80% | 80–90% |
| P3 Commission Admin & Accounting | 35–45% | 35–45% | 55–65% | 65–75% |
| P4 Rep Performance & Engagement | 40–50% | 70–80% | 75–85% | 80–90% |
| P5 Revenue Intelligence & Optimization | 5–15% | 70–80% | 75–85% | 80–90% |

---

## Strategic Note

Planning is the most under-built pillar in the market (lowest average coverage), so Q3–Q4 "planning-lite" is the cleanest differentiation path.
