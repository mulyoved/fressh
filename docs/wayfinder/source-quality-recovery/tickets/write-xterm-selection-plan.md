---
title: Write the Xterm Selection Architecture Plan
status: closed
order: 100
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Research the Supported Xterm Selection
    Boundary](./research-xterm-selection-boundary.md)'
assignee:
---

## Question

What exact test-driven implementation plan separates xterm capability access,
pure selection geometry, typed interaction state, DOM rendering, gesture
lifecycle, and React Native bridge messages while preserving the existing
selection behavior?

## Resolution

The approved
[12-task execution plan](../../../superpowers/plans/2026-07-12-xterm-selection-architecture.md)
pins xterm 5.5.0, adds a real Chromium contract test, and replaces the giant
selection module with focused capability, policy, model, view, runtime, bridge,
and controller units. It deletes fake private-xterm fixtures and the old module,
preserves the existing bridge and gesture behavior, and ends with package,
repository, preview-build, and thermo-nuclear review gates.
