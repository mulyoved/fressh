---
title: Write the Quality-Gate and Test-Architecture Plan
status: closed
order: 160
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Write the Secure-Storage V2 and Automatic-Migration
    Plan](./write-secure-storage-v2-plan.md)'
  - '[Write the Controller and Shell-Modal Consolidation
    Plan](./write-controller-modal-consolidation-plan.md)'
  - '[Write the Xterm Selection Architecture
    Plan](./write-xterm-selection-plan.md)'
  - '[Write the Auto-Connect Runtime Migration
    Plan](./write-auto-connect-runtime-plan.md)'
  - '[Write the Rust Shell-Startup Decomposition
    Plan](./write-rust-shell-startup-plan.md)'
  - '[Define the Portable Source-Quality Gate
    Policy](./define-portable-quality-policy.md)'
assignee:
---

## Question

What exact implementation plan makes repository checks portable, excludes
worktree and generated noise, enables curated dead-code detection, enforces the
chosen structural thresholds, and splits giant suites around the new subsystem
boundaries with reusable test fixtures?

## Resolution

The answer is the
[Portable Quality Gate and Test Architecture Implementation Plan](../../../superpowers/plans/2026-07-12-portable-quality-gate-test-architecture.md).

Twenty-three test-first tasks create a platform-free task graph, one canonical
source scope, exact structural/dead-code/clone ratchets, and focused TypeScript
and Rust analyzers. They split the ten remaining over-limit suites into owner
tests with reusable fixtures before creating the reviewed initial baseline.

The final stages add one required GitHub `Portable Quality` status, separate Nix
release evidence, safe commit-bound Android preview/device evidence, full
check-only verification, and a thermo-nuclear maintainability review.
