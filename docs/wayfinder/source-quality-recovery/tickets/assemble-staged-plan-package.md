---
title: Assemble the Staged Source-Quality Implementation Package
status: closed
order: 170
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Write the Secure-Storage V2 and Automatic-Migration
    Plan](./write-secure-storage-v2-plan.md)'
  - '[Write the ShellDetail and Wispr Decomposition
    Plan](./write-shell-detail-wispr-plan.md)'
  - '[Write the Controller and Shell-Modal Consolidation
    Plan](./write-controller-modal-consolidation-plan.md)'
  - '[Write the Xterm Selection Architecture
    Plan](./write-xterm-selection-plan.md)'
  - '[Write the Auto-Connect Runtime Migration
    Plan](./write-auto-connect-runtime-plan.md)'
  - '[Write the Rust Shell-Startup Decomposition
    Plan](./write-rust-shell-startup-plan.md)'
  - '[Write the Quality-Gate and Test-Architecture
    Plan](./write-quality-test-plan.md)'
assignee:
---

## Question

How should the completed subsystem plans be ordered into independently landable
stages, with explicit inputs and outputs, migration checkpoints, cross-plan
verification, rollback boundaries, and coverage of every original audit finding?

## Resolution

The answer is the
[Source-Quality Recovery Staged Implementation Package](../../../superpowers/plans/2026-07-12-source-quality-recovery-package.md).

It orders the lookup hotfix and storage-v2 migration first, then defines one
ordered shell lane plus independent Xterm and Rust lanes. The portable quality
gate runs only after every source-decomposition stage has landed.

Every stage has an explicit input, output, verification checkpoint, and rollback
boundary. The package also defines the storage compatibility floor, shared-file
integration checks, final release checkpoint, and one acceptance path for each
of the eight original findings.
