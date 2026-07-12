# Source-Quality Recovery Staged Implementation Package

**Baseline:** `dev` at `82d6f44`

**Purpose:** Order the eight source-quality fixes into independently landable
stages. Each stage has a clear input, output, acceptance checkpoint, and
rollback boundary.

This document coordinates the existing implementation plans. It does not replace
their task lists or authorize deployment.

## What Changes

- Private-key lookup is fixed first, then private keys and the restore journal
  move to transactional storage with automatic migration.
- Shell, controller, Xterm, auto-connect, and Rust ownership are decomposed
  behind tested boundaries.
- A portable merge gate prevents new giant files, giant functions, complexity,
  duplication, and dead-code debt.

## User and Data Impact

**UX impact:** Existing behavior stays the same except for two approved changes:
an invalid shell route shows a recoverable Back screen, and every real automatic
connection failure goes to the host page.

**Database/data impact:** Only Stage 1 changes a stored format. Existing private
keys and restore-journal data migrate automatically. Version-1 data remains
untouched until a fresh process reopens a complete version-2 snapshot.
Connections and backup JSON keep their current formats.

**Code impact:** Ownership moves from large mixed files into focused storage,
shell-session, controller, Xterm, auto-connect, and Rust units. The final stage
adds one exact, check-only quality policy over the resulting tree.

## Rules for Every Stage

1. Start from a clean implementation branch based on the accepted previous
   stage.
2. Execute one linked plan from start to finish. Do not mix tasks from another
   stage into its commits.
3. Use test-driven development and observe each planned failing test before the
   production change.
4. Pass the plan's focused checks, full relevant package checks, source limits,
   and thermo-nuclear maintainability review.
5. Record the exact test results and any manual evidence in the pull request.
6. Merge only when the stage is independently usable. Update downstream plans if
   an accepted filename or contract changed; do not add compatibility shims.
7. Never clear app data, run `test:e2e:clear-state`, edit generated files, or
   use a differently signed Android build.

## Dependency Order

```text
Stage 0: lookup hotfix
    |
Stage 1: transactional storage v2
    |
    +--> Stage 2: ShellDetail/Wispr --> Stage 3: controllers/modals
    |                                      |
    |                                      +--> Stage 4: auto-connect
    |
    +--> Stage 5: Xterm selection
    |
    +--> Stage 6: Rust shell startup
                                           |
                 all completed ------------+
                                           |
                 Stage 7: portable quality gate
                                           |
                 Final release checkpoint
```

Stages 2-4 are one ordered shell lane. Stages 5 and 6 may be developed in
parallel after Stage 1 because they do not change stored data or the shell
lane's internal TypeScript contracts. Stage 7 must use the final merged tree.

## First Execution Tranche

Execute Stage 0, Stage 1, Stage 2, and Stage 5 first, in that order. This fixes
the live key-read and key-loss risks, then removes the two largest mobile
ownership tangles without stacking all three shell rewrites together.

After Stage 5, rerun the source audit and review production evidence. Decide the
timing of Stages 3, 4, and 6 from the remaining maintenance pain and regression
risk. This is a scheduling checkpoint, not deletion of scope: completing the
full eight-finding recovery still requires all planned stages. Stage 7 remains
last and uses the final accepted source tree.

## Stage 0: Multi-Manifest Lookup Safety Hotfix

**Plan:**
[Multi-Manifest Lookup Safety Hotfix](./2026-07-12-multi-manifest-lookup-hotfix.md)

**Input:** Audit baseline `82d6f44` and the existing version-1 storage format.

**Output:** `getEntry()` searches every manifest chunk. A focused regression
proves values and metadata are readable from two chunks.

**Checkpoint:** Focused regression, mobile typecheck, full mobile integration
suite, two-file diff check, and thermo-nuclear review all pass.

**Rollback:** Revert the hotfix commit. It changes no key, format, write order,
or stored value, so no data action is needed.

## Stage 1: Transactional Secure Storage V2

**Plan:**
[Secure Storage V2 and Automatic Migration](./2026-07-12-secure-storage-v2-automatic-migration.md)

**Input:** Stage 0 is merged. The version-1 reader remains available for private
keys, the restore journal, and unchanged connection migration.

**Output:** Two-root transactional stores own private keys and the restore
journal. Reads validate and fall back without mutation; writes are serialized;
replace-all is atomic; delete becomes durable before cleanup; migration is
automatic and idempotent.

**Scope boundary:** This protocol is limited to private keys and the restore
journal. Do not reuse it for connections or general application storage without
a separate failure analysis and design decision.

**Migration checkpoint:** Prove this exact sequence with synthetic storage:

1. Seed readable version-1 private keys and restore-journal data.
2. Open version 2, migrate, and confirm version 1 still exists.
3. Simulate process restart with a fresh store instance.
4. Reopen a complete version-2 snapshot and confirm identical values.
5. Only then allow retryable version-1 cleanup.

Also prove interruption or disappearing writes at every publication boundary
leave either version 1 or a complete version 2 readable.

**Checkpoint:** The full storage fault matrix, service and startup-order tests,
mobile formatting/lint/typecheck/integration checks, and thermo-nuclear review
pass. No device, EAS, or destructive e2e work is used.

**Rollback:** Before legacy cleanup, the stage can be reverted because version 1
remains intact. After a user installation has completed the fresh-reopen
checkpoint and cleaned version 1, version 2 becomes the minimum storage
compatibility level. An emergency rollback build must retain the version-2
reader and migration service; it may revert callers or other product code, but
must not ship the old version-1-only storage owner. Never uninstall, clear data,
or ask the user to export and re-import as a rollback mechanism.

## Stage 2: ShellDetail and Wispr Ownership

**Plan:**
[ShellDetail and Wispr Decomposition](./2026-07-12-shell-detail-wispr-decomposition.md)

**Input:** Stage 1 is accepted. Existing shell behavior and live SSH ownership
remain the contract.

**Output:** Typed route parsing, one screen-session owner, one Workmux owner,
generation-bound ports, focused Wispr units, a real `ShellScreenView`, and a
small composition-only `ShellDetail`.

**Checkpoint:** Focused route/session/Workmux/Wispr/boundary tests, the full
mobile integration and repository checks, size and forbidden-pattern gates,
thermo-nuclear review, and a non-destructive local preview check pass.

**Rollback:** Revert the complete stage before starting Stage 3. It changes no
stored format and does not destroy live connections on screen unmount. After
Stage 3 or 4 lands, roll those stages back first in reverse order.

## Stage 3: Canonical Controllers and Modal Chrome

**Plan:**
[Shell Controller and Modal Consolidation](./2026-07-12-shell-controller-modal-consolidation.md)

**Input:** Stage 2's session, Wispr, typed ports, and `ShellScreenView` are the
only accepted shell composition boundary.

**Output:** Every shell controller exposes `{ state, commands, view }`; obsolete
facades and forwarding layers are deleted; eight standard modals share one frame
while the draggable text-entry modal remains custom.

**Checkpoint:** Modal, controller architecture, ShellDetail boundary, complete
mobile, repository, size, maintainability, and non-destructive preview checks
pass.

**Rollback:** Revert the complete stage to the Stage 2 controller contracts.
There is no data migration. If Stage 4 has landed, restore its deleted legacy
orchestration and revert its cutover before reverting this stage.

## Stage 4: Auto-Connect Runtime

**Plan:**
[Auto-Connect Runtime Migration](./2026-07-12-auto-connect-runtime-migration.md)

**Input:** Stage 3 supplies the final ShellDetail and controller boundaries. The
approved behavior contract is one automatic cycle and host-page routing for
every real failure.

**Output:** A pure reducer, serialized effect runner, mobile ports, immutable
environment snapshots, read-only projections, and a thin React manager replace
the legacy ref/effect orchestration.

**Checkpoint:** The complete race matrix and behavior checklist pass, including
priority replacement, stale-result suppression, one trace, navigation intent
acknowledgement, Tailscale actions, foreground reconciliation, and every real
failure reaching the host page. Then pass full mobile checks, ownership/size
gates, and thermo-nuclear review. Build the local Android preview and, without
clearing data, smoke-test initial connect, reconnect, background/foreground
recovery, Tailscale Retry and Reset, host-page failure routing, and continued
terminal input/output.

**Rollback:** Tasks 1-8 are additive. Task 9 is the ownership cutover; reverting
it restores the old manager. Task 10 deletes the legacy implementation only
after cutover verification and can be reverted independently. After Task 10,
restore that deletion commit first, then revert the cutover. No data migration
or app reset is needed.

## Stage 5: Xterm Selection Architecture

**Plan:**
[Xterm Selection Architecture](./2026-07-12-xterm-selection-architecture.md)

**Input:** The supported-boundary research and exact xterm 5.5.0/addon-fit
0.10.0 versions. The React Native bridge schema is unchanged.

**Output:** One guarded capability adapter owns the only permitted private
geometry cast. Pure range/geometry code, typed interaction state, focused
runtimes, one DOM view, and one controller replace the 1,514-line module.

**Checkpoint:** Dependency pin and architecture tests, pure unit tests, real
Chromium xterm contract, package build/tests, mobile bridge/scrollback
integration checks, size gates, preview behavior, and thermo-nuclear review
pass.

**Rollback:** Revert the complete stage, including exact dependency pins and the
rebuilt generated package artifact. The bridge contract and stored data do not
change. Do not keep a multi-version compatibility adapter.

## Stage 6: Rust Shell-Startup Ownership

**Plan:**
[Rust Shell-Startup Decomposition](./2026-07-12-rust-shell-startup-decomposition.md)

**Input:** The current UniFFI and TypeScript shell APIs and the approved
four-owner module design.

**Output:** Dedicated buffer, registry, reader, and startup modules. The public
API, generated bindings, timing, limits, Workmux command, and SSH behavior stay
unchanged.

**Scope boundary:** Stage 6 decomposes `SshConnection::start_shell()`,
`ssh_connection.rs`, and shell lifetime ownership. It does not decompose the
separate 1,431-line `ssh_command.rs`; that requires a focused future plan if the
scope expands to every existing giant Rust file.

**Checkpoint:** Rust formatting, full tests, real-SSH scenarios, Clippy with
warnings denied, TypeScript wrapper compatibility, package checks, architecture
and generated-diff guards, repository checks, and thermo-nuclear review pass.

**Rollback:** Tasks 1-4 replace internal owners while startup remains callable.
Task 5 is the coordinator cutover and can be reverted alone. Task 6 removes
obsolete source. There is no stored-data or generated-binding migration.

## Stage 7: Portable Quality Gate and Test Architecture

**Plan:**
[Portable Quality Gate and Test Architecture](./2026-07-12-portable-quality-gate-test-architecture.md)

**Input:** Stages 1-6 are merged and have passed their own maintainability
gates. Their final filenames and test owners define the baseline source tree.

Keep the full approved gate unless the project intentionally narrows the
original audit goal. ESLint alone does not cover Rust, exact existing-debt
ratchets, duplicate code, dead code, giant test splits, or release evidence.

**Output:** One check-only Linux gate, exact no-growth baselines, portable task
graph, focused splits for the ten remaining giant tests, required GitHub status,
separate Nix evidence, and safe Android release evidence.

**Checkpoint:** Run the portable gate twice and prove it changes neither the
lockfile, baseline, nor generated bindings. Pass tool/helper tests, suite/task/
CI/release contracts, non-device Nix checks, safe Android runner tests, and the
final thermo-nuclear review. Branch protection must require the aggregate
`Portable Quality` status.

**Rollback:** Disable the required branch-protection status before reverting its
workflow, so pull requests are not left permanently blocked. The baseline and
tooling contain no product data. Revert this stage as a unit; do not leave
partially active workflows pointing at removed scripts.

## Cross-Plan Verification

| After stage | Required integration proof                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0           | Multi-manifest reads plus existing private-key and device-migration tests.                                                                                     |
| 1           | Fresh-instance migration, restore recovery ordering, key usage, security-center flow, and complete mobile integration.                                         |
| 2           | Route, session, Workmux, terminal, scrollback, keyboard, Wispr, reconnect, and screen re-entry behavior.                                                       |
| 3           | Stage 2 boundary tests plus every canonical controller and all standard/custom modal behavior.                                                                 |
| 4           | All shell tests plus auto-connect, diagnostics, foreground service, Tailscale, notification bridge, host-page routing, and safe Android preview smoke testing. |
| 5           | Xterm unit/Chromium/build checks plus mobile terminal, selection, bridge, and scrollback integration.                                                          |
| 6           | Rust real-SSH/API compatibility plus unchanged generated bindings and package checks.                                                                          |
| 7           | The complete portable gate twice, exact baseline immutability, Nix release gate, and safe Android evidence contract.                                           |

If a stage changes a shared file already touched by an earlier plan, its pull
request must run both plans' focused boundary tests. In particular, `detail.tsx`
changes in Stages 2-4 require the shell boundary, Workmux, reconnect, and
host-page routing suites together. Test splits in Stage 7 must prove the same
test inventory before deleting an old giant suite.

## Original Audit Coverage

| Finding                                                  | Recovery stage | Acceptance evidence                                                         |
| -------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| Multi-manifest lookup misses older entries               | 0              | A real two-manifest regression reads every entry.                           |
| Delete-first, non-transactional secure storage           | 1              | Two-root fault matrix and automatic fresh-reopen migration.                 |
| Giant `ShellDetail` and mixed Wispr/session ownership    | 2              | Explicit owners, typed ports, size gates, and boundary tests.               |
| Fragmented shell controllers and duplicate modal chrome  | 3              | One controller contract, deleted forwarding layers, and shared-frame tests. |
| Giant Xterm selection module and private-internal spread | 5              | One guarded adapter, real Chromium contract, and focused units.             |
| Ref/effect-driven auto-connect orchestration             | 4              | Pure reducer, serialized runner, race matrix, and single navigation owner.  |
| Giant Rust shell startup and mixed lifetime ownership    | 6              | Four internal owners, real-SSH tests, and unchanged public API.             |
| Non-portable checks and giant test suites                | 7              | Required Linux gate, exact ratchets, and owner-focused suite splits.        |

All eight findings have one owning stage and one measurable acceptance path.

## Final Release Checkpoint

The implementation package is ready for release consideration only when:

- every stage is merged in dependency order and its pull-request evidence is
  complete;
- `pnpm run quality:portable` passes twice without changing tracked inputs;
- non-device Nix evidence passes;
- authorized Android preview evidence uses `com.finalapp.vibe2`, the existing
  signing lane, and preserved app data;
- migrated private keys and restore-journal data survive the fresh-process
  checkpoint;
- no generated, signing, APK, log, or device-state artifact is in the diff;
- the final thermo-nuclear review has no blocking finding.

App Store, Play Store, OTA, publication, and physical-device rollout remain
separate authorized work. If a release must be backed out after storage-v2
cleanup, use a rollback build that retains the version-2 storage reader.

## Ready-to-Execute Checklist

- [x] All original findings have an owner.
- [x] Every implementation stage links to a complete test-first plan.
- [x] Dependencies and safe parallel lanes are explicit.
- [x] The first execution tranche and reassessment point are explicit.
- [x] Each stage has an input, output, checkpoint, and rollback boundary.
- [x] Stored-data migration has a fresh-process safety checkpoint.
- [x] Shared-file and cross-package verification is explicit.
- [x] Final release work is separated from planning and implementation.
