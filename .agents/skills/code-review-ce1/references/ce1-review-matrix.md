# CE1 Review Matrix

Use this matrix after the stable workflow has established the review target, diff scope, risk areas, and existing findings.

## Reviewer Routing

The reviewer names below are local persona prompt files in the `code-review-ce1` skill directory. Resolve persona and schema paths relative to `code-review-ce1`: load selected personas from `references/personas/`, and use `references/findings-schema.json` as the expected structured finding contract.

For each selected reviewer, build a generic subagent prompt that includes:

1. The full local persona prompt file.
2. The exact review scope established by the stable workflow.
3. The changed files and diff context available from the stable workflow.
4. The existing stable review findings, so duplicates can be marked as confirmed rather than counted as new.
5. The finding output expectation from `code-review-ce1`'s `references/findings-schema.json`.

If a selected persona file is missing, skip that reviewer and record `skipped:missing-local-persona`.
If a generic subagent cannot run, skip that reviewer and record `skipped:subagent-unavailable`.
If a reviewer returns unusable output, skip that reviewer and record `skipped:invalid-output`.

- Always consider `correctness-reviewer.md` for code changes.
- Add `maintainability-reviewer.md` when the diff changes structure, ownership boundaries, abstractions, naming patterns, or module responsibilities.
- Add `testing-reviewer.md` when coverage, regression risk, test design, or verification confidence is material to the review.
- Add specialist reviewers only when the changed diff clearly matches their domain.

Specialist examples:

- Use `security-reviewer.md` for auth, permissions, public endpoints, secret handling, or user input security risks.
- Use `api-contract-reviewer.md` for request or response contracts, exported types, serialization, versioning, or public API behavior.
- Use `data-migration-reviewer.md` for migrations, schema changes, backfills, persistent data shape, or data privacy risk.
- Use `performance-reviewer.md` for database queries, caching, loop-heavy transforms, I/O-heavy paths, or scaling risk.
- Use `reliability-reviewer.md` for retries, timeouts, circuit breakers, error propagation, background jobs, or async failure modes.
- Use `julik-frontend-races-reviewer.md` when the diff touches Stimulus, Turbo, DOM event wiring, timers, async UI flows, animations, or frontend state transitions with race potential.
- Use `swift-ios-reviewer.md` when the diff touches Swift, SwiftUI, UIKit, entitlements, Core Data, privacy manifests, packages, storyboards, XIBs, or semantic `.pbxproj` changes.

Do not run a large reviewer panel for tiny changes. Prefer one to three CE1 persona reviewers unless the diff clearly spans more domains.

## Reporting Rules

- If a CE1 persona reviewer finds a new valid issue, record it under `Findings added by CE1`.
- If a CE1 persona reviewer duplicates an existing finding, record it as confirmed by CE1.
- If a CE1 persona reviewer cannot run cleanly, record it under `Reviewers skipped` with the failure reason.
- If CE1 finds no material issues, report that directly.
- If a reviewer was considered and skipped, explain the reason in one short phrase.

## Contribution Block Shape

Use this shape in the final report:

```md
CE1 contribution:
- Reviewers run: list exact local persona reviewers that ran
- Reviewers skipped: list considered reviewers and short reasons
- Findings added by CE1: list new valid findings or say "none"
- Findings confirmed by CE1: list duplicated findings that increased confidence or say "none"
- Net effect: caught issue / confirmed risk / no material contribution
```
