---
title: Write the ShellDetail and Wispr Decomposition Plan
status: closed
order: 60
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Define the Shell Runtime Ownership
    Model](./define-shell-runtime-ownership.md)'
assignee:
---

## Question

What exact test-driven implementation plan extracts typed route handling,
shell-session composition, and a fully owned Wispr state machine; removes
render-time mutations and fake dependencies; and reduces `detail.tsx` below a
healthy composition-root size without adding pass-through wrappers?

## Resolution

The completed answer is the
[ShellDetail and Wispr Decomposition Implementation Plan](../../../superpowers/plans/2026-07-12-shell-detail-wispr-decomposition.md).

The plan delivers the approved layered ownership model in ten test-first tasks:
typed route handling, pure session decisions, diagnostic and Workmux ownership,
the React session adapter, domain port migration, focused Wispr tap/close/core
units, the Wispr hook, removal of keyboard shims and render mutations, a real
rendering boundary, and final automated/preview/maintainability gates.

It deletes the field-copying keyboard composition wrapper and no-op late
bindings, replaces raw connection and Workmux dependencies with generation-bound
ports, keeps scrollback as the sole input gate, and preserves SSH lifetime in
the connection store. It enforces fewer than 650 nonblank route-file lines and
fewer than 300 `ShellDetail` lines, with each new session or Wispr core/hook
kept below 350 nonblank lines.

The final gate requires formatting, lint, typecheck, full mobile integration
tests, repository checks, a local signed-lane Android preview, and a
thermo-nuclear maintainability review. No production code was changed while
resolving this ticket.
