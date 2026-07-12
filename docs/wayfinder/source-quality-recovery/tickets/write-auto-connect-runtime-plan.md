---
title: Write the Auto-Connect Runtime Migration Plan
status: closed
order: 120
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Define the Auto-Connect Runtime State
    Model](./define-auto-connect-state-model.md)'
assignee:
---

## Question

What exact test-driven implementation plan moves orchestration from mutable
React refs and effects into the chosen runtime state model, makes the React
manager a thin platform adapter, and migrates behavior in independently
verifiable stages?

## Resolution

The answer is the
[Auto-Connect Runtime Migration Implementation Plan](../../../superpowers/plans/2026-07-12-auto-connect-runtime-migration.md).

Eleven test-first tasks add the pure reducer, priority and timing policy, typed
attempt outcomes, serialized effect runner, mobile ports, and public projections
before one reversible React-manager cutover. The final stages delete the legacy
reconnect controller, manager helpers, and Tailscale action coordinator, cover
the race matrix, and require full mobile verification plus a thermo-nuclear
maintainability review.
