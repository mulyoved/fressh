---
title: Define the Portable Source-Quality Gate Policy
status: closed
order: 150
labels:
  - wayfinder:grilling
parent: ../map.md
blocked_by: []
assignee:
---

## Question

Which formatting, lint, type, dead-code, duplication, file-size, complexity,
test-size, and platform-specific checks must block CI; what exact thresholds
apply; and which checks belong in optional Nix or device lanes?

## Resolution

The approved answer is the
[Portable Source-Quality Gate Policy](../../../superpowers/specs/2026-07-12-portable-source-quality-gate-policy-design.md).

Every pull request gets a platform-independent Linux gate for formatting, lint,
types, Rust checks, dependency consistency, dead code, duplication, structural
limits, and unit/integration tests. Existing debt uses exact no-growth
fingerprints; new code must meet the 500-line production-file, 1,000-line test,
80-line function, and complexity-15 limits immediately.

Nix, Expo, preview Android builds, and non-destructive Maestro checks block
releases rather than normal pull requests. iOS remains a manual release check
until a reliable runner exists.
