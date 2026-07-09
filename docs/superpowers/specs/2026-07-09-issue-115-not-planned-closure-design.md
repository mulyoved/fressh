# Issue 115 Not-Planned Closure Design

## Goal

Close GitHub issue 115, "Decompose oversized auto-connect integration tests,"
as not planned.

The issue tracks maintainability cleanup for oversized integration test files:

- `apps/mobile/test/integration/auto-connect-attempt.test.ts`
- `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`

The files are test-only. The current cleanup would not change product behavior,
runtime architecture, or user-facing reliability. The cost of splitting the
files and extracting more harness code is not worth prioritizing now.

## Current State

Issue 115 is still open.

The named files are still large:

- `auto-connect-attempt.test.ts` is over 1,000 lines.
- `auto-connect-reconnect-controller.test.ts` is over 1,000 lines.

There has been partial related cleanup, including
`apps/mobile/test/integration/auto-connect-attempt-test-helpers.ts`, but the
issue's main requested decomposition is not complete.

## Decision

Make no repository code or test changes for issue 115.

Close the GitHub issue as `not planned` with a short comment explaining:

1. the oversized files are test-only;
2. the cleanup cost is not worth prioritizing at this time;
3. the issue can be reopened if these files become active maintenance pain.

## Rationale

The proposed decomposition would be useful if these files were changing often
or blocking review. Right now it would mostly move existing tests and harness
code without improving product behavior. That kind of churn carries review
cost and can make history harder to follow.

Closing as not planned is clearer than leaving the issue open indefinitely. It
records the prioritization decision while preserving the option to reopen if
future work repeatedly touches these files.

## Out Of Scope

- Splitting the named test files.
- Creating `test/integration/support` harness modules.
- Moving tests by behavior area.
- Renaming tests.
- Running the full integration suite.
- Changing app code.
