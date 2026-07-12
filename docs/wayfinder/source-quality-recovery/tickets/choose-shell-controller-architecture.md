---
title: Choose the Canonical Shell-Controller Architecture
status: closed
order: 70
labels:
  - wayfinder:prototype
parent: ../map.md
blocked_by:
  - '[Define the Shell Runtime Ownership
    Model](./define-shell-runtime-ownership.md)'
assignee:
---

## Question

Which single controller pattern should replace the current adapter/core/
lifecycle/facade/modal-props stacks, what public handle should each domain
expose, and which existing layers can disappear entirely?

## Resolution

The approved answer is the
[Canonical Shell-Controller Architecture Design](../../../superpowers/specs/2026-07-12-canonical-shell-controller-architecture-design.md).

Every domain exposes one public hook, one type-only contracts file, and a
`{ state, commands, view }` handle. Other domains may import only public
contracts and focused capability ports. Complex domains may use private model,
runtime, and policy files when those files own real state or protocols.

Forwarding adapters, facades, modal-props layers, generic lifecycle wrappers,
generic hook-runtime layers, and the unused generation request gate disappear.
Real keyboard, scrollback, terminal, and notification protocols remain, but are
renamed or merged around their owned behavior rather than their position in a
stack.

Hooks create their pure units once, read snapshots through
`useSyncExternalStore`, commit identity and ports in layout effects, dispose in
passive effects, and never mutate external state during render. Behavior tests
target the owning model/runtime; one small source test enforces public shape,
dependency direction, deleted layers, and file guardrails.
