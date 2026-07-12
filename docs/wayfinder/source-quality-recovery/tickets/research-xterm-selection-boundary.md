---
title: Research the Supported Xterm Selection Boundary
status: closed
order: 90
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
assignee:
---

## Question

Which public xterm APIs, addon hooks, or stable version-pinned private
capabilities can support Fressh selection handles, and what single adapter
boundary is required for behavior that has no public API?

## Resolution

The
[supported-boundary research](../research/2026-07-12-xterm-selection-boundary.md)
chooses an exact `@xterm/xterm` 5.5.0 contract. Public APIs cover selection
state, range changes, buffer cells, events, options, and viewport restoration.
Addons provide no privileged hook, and proposed decorations cannot support the
alternate buffer. One fail-closed adapter may read only the pinned screen
element and rendered cell dimensions; all private selection, mouse, buffer, and
event access is removed.
