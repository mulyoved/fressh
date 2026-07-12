---
title: Write the Controller and Shell-Modal Consolidation Plan
status: closed
order: 80
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Write the ShellDetail and Wispr Decomposition
    Plan](./write-shell-detail-wispr-plan.md)'
  - '[Choose the Canonical Shell-Controller
    Architecture](./choose-shell-controller-architecture.md)'
assignee:
---

## Question

What exact implementation plan migrates every shell controller to the chosen
canonical pattern, deletes unearned facades and projections, introduces one
shared shell-modal frame for the verified duplicate chrome, and keeps each step
independently reviewable?

## Resolution

The approved
[13-task execution plan](../../../superpowers/plans/2026-07-12-shell-controller-modal-consolidation.md)
migrates every shell domain to `{ state, commands, view }`, moves real protocols
into named private units, and deletes forwarding layers and unused helpers. It
also moves eight standard shell modals onto one tested frame while keeping the
draggable `TextEntryModal` custom. Each implementation slice starts with a
failing test, has its own verification gate and commit, and ends with full
mobile, repository, preview-build, and thermo-nuclear review checks.
