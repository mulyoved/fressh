---
title: Write the Rust Shell-Startup Decomposition Plan
status: closed
order: 140
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Define the Rust Shell-Startup Module
    Boundaries](./define-rust-shell-startup-boundaries.md)'
assignee:
---

## Question

What exact test-driven implementation plan decomposes `start_shell`, centralizes
repeated channel-message handling, preserves UniFFI behavior, and keeps every
Rust commit independently testable?

## Resolution

The answer is the
[Rust Shell-Startup Decomposition Implementation Plan](../../../superpowers/plans/2026-07-12-rust-shell-startup-decomposition.md).

Seven test-first tasks extract the buffer, registry, shared message classifier,
one-shot notifier, reader lifetime, and startup coordinator before locking the
public Rust and TypeScript contracts. Each ownership cut is independently
testable and revertible, and the final gate checks exact file/function limits,
real SSH behavior, generated-binding stability, and a thermo-nuclear
maintainability review.
