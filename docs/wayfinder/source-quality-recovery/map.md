---
title: Plan the Fressh Source-Quality Recovery
status: closed
labels:
  - wayfinder:map
assignee:
---

## Destination

Produce a dependency-ordered package of execution-ready implementation plans
covering all eight findings from the 2026-07-12 thermo-nuclear source audit. The
package must permit clean-slate public API and storage redesigns while
preserving existing private keys and connections through automatic migration.

## Notes

- This map is planning-only. Do not change production code while resolving it.
- Every subsystem plan must be independently landable, reversible where data is
  involved, and verifiable before the next stage begins.
- Breaking public and internal APIs is allowed when it materially simplifies the
  resulting architecture.
- Stored-format changes must automatically migrate existing data without loss;
  destructive resets and mandatory manual export/import are not acceptable.
- Storage integrity work is the first delivery stage.
- Every implementation-plan ticket must use the `writing-plans`,
  `test-driven-development`, and `verification-before-completion` skills.
- Plans should require a thermo-nuclear maintainability review before their
  execution is considered ready to merge.
- The audit baseline is the `dev` branch at commit `82d6f44`.

## Decisions so far

- [Plan the Multi-Manifest Lookup Safety Hotfix](tickets/plan-multi-manifest-lookup-hotfix.md)
  — Use a format-preserving, one-expression lookup correction backed by an
  explicit two-manifest private-key regression; the
  [execution plan](../../superpowers/plans/2026-07-12-multi-manifest-lookup-hotfix.md)
  leaves storage-v2 atomicity and migration design to their existing tickets.
- [Characterize SecureStore Failure and Commit Semantics](tickets/characterize-secure-store-failure-semantics.md)
  — The
  [platform contract](research/2026-07-12-securestore-failure-semantics.md)
  permits only fallible per-key operations, requiring storage v2 to supply
  serialization, byte bounds, redundant commit candidates, validation, fallback,
  and non-authoritative cleanup.
- [Choose the Transactional Secure-Storage Model](tickets/choose-transactional-secure-storage-model.md)
  — The approved
  [two-root design](../../superpowers/specs/2026-07-12-transactional-secure-storage-model-design.md)
  writes only changed secret data, falls back to the previous complete save, and
  makes both roots forget deleted keys before retryable cleanup.
- [Write the Secure-Storage V2 and Automatic-Migration Plan](tickets/write-secure-storage-v2-plan.md)
  — The
  [execution plan](../../superpowers/plans/2026-07-12-secure-storage-v2-automatic-migration.md)
  delivers the two-root store in ten test-first tasks and deletes version-1 keys
  only after a fresh instance reopens migrated private keys and restore journal.
- [Define the Shell Runtime Ownership Model](tickets/define-shell-runtime-ownership.md)
  — The approved
  [layered-owner design](../../superpowers/specs/2026-07-12-shell-runtime-ownership-design.md)
  gives route, screen session, Workmux, diagnostics, terminal, scrollback,
  keyboard, and Wispr explicit lifetimes while reducing `ShellDetail` to typed
  composition and rendering.
- [Write the ShellDetail and Wispr Decomposition Plan](tickets/write-shell-detail-wispr-plan.md)
  — The
  [ten-task execution plan](../../superpowers/plans/2026-07-12-shell-detail-wispr-decomposition.md)
  test-drives route/session ownership, typed controller ports, focused Wispr
  units, shim removal, and a measured rendering-only `ShellDetail` boundary.
- [Choose the Canonical Shell-Controller Architecture](tickets/choose-shell-controller-architecture.md)
  — The approved
  [single public pattern](../../superpowers/specs/2026-07-12-canonical-shell-controller-architecture-design.md)
  exposes `{ state, commands, view }` per domain while deleting forwarding
  stacks and retaining only private units that own real state or protocols.
- [Write the Controller and Shell-Modal Consolidation Plan](tickets/write-controller-modal-consolidation-plan.md)
  — The
  [13-task execution plan](../../superpowers/plans/2026-07-12-shell-controller-modal-consolidation.md)
  migrates every shell domain to the canonical handle, removes unearned layers,
  and shares verified chrome across eight standard modals while leaving the
  draggable text-entry modal custom.
- [Research the Supported Xterm Selection Boundary](tickets/research-xterm-selection-boundary.md)
  — The [supported boundary](research/2026-07-12-xterm-selection-boundary.md)
  pins xterm 5.5.0, uses public APIs for selection and buffer behavior, and
  permits one guarded private adapter only for exact render geometry.
- [Write the Xterm Selection Architecture Plan](tickets/write-xterm-selection-plan.md)
  — The
  [12-task execution plan](../../superpowers/plans/2026-07-12-xterm-selection-architecture.md)
  replaces the giant selection module with focused tested units and a real
  Chromium contract while preserving bridge and gesture behavior.
- [Define the Auto-Connect Runtime State Model](tickets/define-auto-connect-state-model.md)
  — The approved
  [reducer-and-effect-runner design](../../superpowers/specs/2026-07-12-auto-connect-runtime-state-model-design.md)
  owns one automatic cycle, keeps background work best-effort, publishes
  versioned navigation intents, and sends every real connection failure to the
  host page.
- [Write the Auto-Connect Runtime Migration Plan](tickets/write-auto-connect-runtime-plan.md)
  — The
  [11-task execution plan](../../superpowers/plans/2026-07-12-auto-connect-runtime-migration.md)
  test-drives the reducer, runner, ports, projection, reversible React cutover,
  legacy deletion, race matrix, and final maintainability gate.
- [Define the Rust Shell-Startup Module Boundaries](tickets/define-rust-shell-startup-boundaries.md)
  — The approved
  [four-owner design](../../superpowers/specs/2026-07-12-rust-shell-startup-module-boundaries-design.md)
  keeps the public API stable while separating startup, buffering, reader
  lifetime, and session registration without adding an abstraction stack.
- [Write the Rust Shell-Startup Decomposition Plan](tickets/write-rust-shell-startup-plan.md)
  — The
  [seven-task execution plan](../../superpowers/plans/2026-07-12-rust-shell-startup-decomposition.md)
  test-drives buffer, registry, message, reader, and startup ownership cuts,
  then locks public compatibility, exact size limits, real SSH behavior, and a
  final thermo-nuclear maintainability gate.
- [Define the Portable Source-Quality Gate Policy](tickets/define-portable-quality-policy.md)
  — The approved
  [portable gate policy](../../superpowers/specs/2026-07-12-portable-source-quality-gate-policy-design.md)
  makes every host-only source and test check merge-blocking, ratchets exact
  existing debt toward 500/1,000/80/15 limits, and reserves Nix and device work
  for release gates.
- [Write the Quality-Gate and Test-Architecture Plan](tickets/write-quality-test-plan.md)
  — The
  [23-task execution plan](../../superpowers/plans/2026-07-12-portable-quality-gate-test-architecture.md)
  builds exact portable ratchets, splits ten giant suites around their owners,
  and adds required host CI plus separate safe Nix and Android release evidence.
- [Assemble the Staged Source-Quality Implementation Package](tickets/assemble-staged-plan-package.md)
  — The
  [final staged package](../../superpowers/plans/2026-07-12-source-quality-recovery-package.md)
  orders storage first, separates the shell, Xterm, and Rust lanes, fixes every
  verification and rollback boundary, and maps all eight audit findings to one
  measurable acceptance path.

## Not yet specified

None. The staged package fixes the final dependency, verification, release, and
rollback sequence.

## Out of scope

- Implementing, committing, deploying, or publishing any planned fix.
- Destructive reset of existing private keys, connections, or application data.
- Product-feature changes unrelated to preserving current user-visible behavior
  while improving source quality.
- App Store, Play Store, EAS build, OTA, or physical-device rollout work.
