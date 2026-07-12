# Portable Source-Quality Gate Policy

**Status:** Approved design

**Date:** 2026-07-12

## Purpose

Fressh needs one merge-blocking quality gate that works on an ordinary Linux CI
runner without Nix, Android, iOS, a connected device, signing credentials, or
deployment access. Platform checks still matter, but they belong in separate
release lanes.

This policy defines:

- which checks block a normal pull request;
- exact size, complexity, duplication, and test limits;
- how existing debt is grandfathered without allowing it to grow;
- which Nix and device checks block a release; and
- the evidence every lane must publish.

It is a policy, not an implementation plan. It does not change source code, CI,
builds, generated files, or devices.

## Approved Decisions

1. Use a ratchet. Existing debt may remain temporarily, but it cannot grow or be
   replaced by different debt.
2. Use the balanced structural limits: 500 production-file lines, 1,000
   test-file lines, 80 function lines, and complexity 15.
3. Make all portable static checks and unit/integration tests merge-blocking.
4. Record existing duplication and dead-code findings by exact fingerprint, not
   by a replaceable total count.
5. Make Nix and Android/device checks release-blocking rather than normal
   pull-request checks.
6. Keep iOS verification manual until a reliable iOS runner exists.

## Current Repository Facts

The implementation plan must start from these observed facts:

- `turbo lint:check` already reaches Prettier, ESLint, TypeScript, Syncpack,
  JSCPD, Rustfmt, and Clippy, but its graph also reaches Nix formatting and
  native UniFFI build work. It is not currently a portable gate.
- The mobile Turbo `test` task includes Maestro e2e, so it cannot be the
  portable test entry point as written.
- JSCPD uses useful existing clone minima of 33 lines and 50 tokens, but its
  broad input currently scans `.worktrees` and reports copies from unrelated
  worktrees.
- Knip is configured but disabled in the root lint graph. A fresh run reports
  existing unused files, dependencies, exports, and configuration hints that
  need classification and a baseline.
- The repository has no checked-in CI workflow.
- Handwritten production files currently exceed 2,000 lines and test files
  exceed 2,000 lines, so an immediate absolute-only limit would keep CI red.

These facts explain the ratchet. They do not weaken the final limits.

## Lane Model

There are three lanes with different authority.

### 1. Portable pull-request gate

This lane is required for every pull request and every protected-branch update.
It runs on a clean Linux worker with:

- Node 22 LTS for the canonical CI result, while local development may use any
  runtime accepted by the repository's `node >=22` declaration;
- pnpm 10.18.0 from `packageManager`;
- the checked-in Rust toolchain and components; and
- dependencies installed from the lockfile without mutation.

It must not require Nix, an Android or iOS SDK, an emulator, ADB, Maestro,
signing credentials, EAS access, network services used by the product, or a
native mobile build.

The portable gate may use parallel CI jobs, but all of them are required. A
single aggregate status must make it obvious whether the commit is mergeable.

### 2. Nix release gate

This lane is optional for ordinary pull requests and required before a release.
It verifies the checked-in flake without changing its lock file.

### 3. Mobile release gate

This lane is optional for ordinary pull requests and required for mobile release
evidence. It owns Expo dependency validation, required preview native builds,
and non-destructive Maestro verification on a dedicated device.

## Portable Pull-Request Checks

Every item in this section blocks merging.

### Repository installation and hygiene

- Install with the frozen pnpm lockfile.
- Reject a changed lockfile or generated output caused merely by running a
  check.
- Reject whitespace errors with `git diff --check` semantics.
- Keep generated code, build products, caches, dependency trees, and linked Git
  worktrees out of structural and duplication scans.
- Do not hide a real failure by appending `|| true`, accepting warnings, or
  automatically rewriting files in a check command.

### Formatting

- Prettier check mode covers owned JavaScript, TypeScript, TSX, Astro, JSON,
  Markdown, and supported configuration files.
- Rustfmt check mode covers the Rust workspace.
- Formatting checks never modify the worker.
- Nix formatting is removed from this portable lane and runs in the Nix release
  lane.

### Lint and type safety

- ESLint runs with zero warnings and reports unused disable directives.
- TypeScript checks every workspace TypeScript project without emitting files.
- Rust Clippy checks all targets and all features with warnings denied.
- Syncpack rejects workspace dependency-version mismatches.
- Portable package builds that need only Node and a headless browser may run as
  prerequisites. Native UniFFI, Android, and iOS builds may not be hidden inside
  lint or typecheck prerequisites.

### Tests

- Run every JavaScript/TypeScript unit and integration test.
- Run every Rust unit and integration test.
- Run the headless Chromium xterm contract tests once they exist; a headless
  browser test is portable when it needs no device, display server, credentials,
  or external product service.
- Do not retry a failed portable test automatically. A flaky failure is still a
  failure to fix.
- Split mobile `test:integration` from `test:e2e`; Maestro is not part of the
  portable aggregate.
- Do not require a global coverage percentage. Each behavior change still needs
  focused regression evidence, and subsystem plans may impose stronger local
  coverage or scenario matrices.

### Dead code

- Knip checks unused files, dependencies, development dependencies, exports,
  exported types, duplicate exports, missing dependencies, and actionable
  configuration findings.
- Real entry points that Knip cannot infer are declared explicitly in its
  configuration with a short reason.
- Generated code and repository-local agent/skill assets are outside the product
  dead-code scan. Product source, package source, build scripts, CI scripts, and
  their dependencies remain in scope.
- Each known genuine finding is stored as an exact baseline fingerprint. Every
  new unbaselined finding fails.
- A broad wildcard ignore cannot replace a list of real entry points or exact
  false-positive exclusions.

### Duplication

- Scan handwritten source and tests under `apps`, `packages`, and owned root
  scripts.
- A clone is reportable when it meets both existing minima: at least 33 lines
  and at least 50 tokens.
- New reportable clone fingerprints fail. The allowed duplicate percentage
  beyond the committed baseline is zero.
- Test code is in scope. Shared setup may be extracted into test helpers, but
  assertions should stay readable in the test that owns the behavior.
- Exclude at least dependency directories, `.git`, `.worktrees`, Turbo/Expo
  caches, Rust targets, `dist`, `lib`, generated UniFFI output, and generated
  Android/iOS project output.

### Structural limits

Count nonblank physical lines, including comments. Exclude generated files and
build output before counting.

A file is test code when its name uses a repository test suffix such as
`*.test.*` or `*.spec.*`, or it lives in a recognized `test`, `tests`, or
`__tests__` tree. A test module embedded in a production file does not convert
the whole production file to the larger test allowance; move a large test module
to its own test file.

| Item                                         | Final maximum |
| -------------------------------------------- | ------------: |
| Handwritten production or support file       |     500 lines |
| Handwritten test file                        |   1,000 lines |
| Production or test function/method           |      80 lines |
| Production or test language complexity score |            15 |

The file limit applies to all handwritten source, including TypeScript, TSX,
JavaScript, JSX, Astro, Rust, Kotlin, Java, Swift, Objective-C, C, C++, and
owned executable scripts. Configuration and data files are not forced through a
source-code function metric, but a handwritten executable config remains subject
to the production-file limit.

Function counting uses language-aware syntax, not regular expressions:

- TypeScript/JavaScript functions, methods, constructors, and callbacks with a
  body are counted;
- Rust free functions and methods are counted; and
- declarations without a body are ignored.

The 80-line function and complexity gates apply to the audited TypeScript,
JavaScript, and Rust source. Native languages without a portable analyzer still
receive the 500/1,000 file gate; their compiler/linter checks stay in the
appropriate platform lane until a portable analyzer is deliberately added.

TypeScript and JavaScript use ESLint's cyclomatic `complexity` rule with a
maximum of 15. Rust uses Clippy's cognitive-complexity lint with a configured
threshold of 15. These two reports run through the structural ratchet, separate
from the ordinary zero-warning ESLint and Clippy invocations, so exact existing
findings can be grandfathered without inline disables. Any unbaselined report is
treated as a failed check. Ordinary boolean branches, loops, matches/switches,
catches, and conditional expressions count according to the selected analyzer's
documented rules. The implementation must pin the analyzer and test its edge
cases instead of pretending that both analyzers implement the same internal
formula.

## Ratchet Rules

The ratchet is a debt boundary, not a quota.

### Structural debt

For every existing file or function over a final maximum, the baseline records
its stable identity and measured value.

- A change may leave the value unchanged or reduce it.
- A change may not increase it by even one counted line or one complexity point.
- When a value decreases but remains over the final maximum, the baseline must
  decrease in the same change.
- When a value reaches the final maximum, its baseline entry must be deleted.
- A deleted baseline entry cannot be restored.
- A rename or move does not turn old debt into a new allowance. Stable content
  identity and explicit rename handling must preserve the ratchet.
- New files and new functions receive no baseline allowance and must meet the
  final maximum immediately.

### Duplication fingerprints

A duplication fingerprint contains the language, normalized clone content hash,
and the participating file identities. Line ranges are diagnostic data, not the
identity, so unrelated edits above a clone do not create false new findings.

- Removing either copy removes the fingerprint.
- Moving a copy requires an explicit no-growth baseline rename.
- Changing a clone into a different clone creates a new fingerprint and fails.
- One removed clone cannot pay for one new clone elsewhere.

### Dead-code fingerprints

A dead-code fingerprint contains the Knip category plus the exact file,
dependency, export, or symbol identity.

- Removing a finding removes its fingerprint.
- One removed finding cannot pay for another.
- A legitimate entry point is modeled as configuration, not mislabeled as debt.
- New baseline additions are forbidden in routine feature work. If a final
  threshold or tool rule is genuinely wrong, change this policy explicitly
  rather than silently adding an exception.

### Baseline review

The baseline is committed, deterministic, and human-readable. CI verifies that
it contains no stale entries and no increased measurements. Updating it is a
reviewable source change; check commands never rewrite it automatically.

## Scan Scope

All structural tools share one canonical scope policy so each tool does not
invent a different repository view.

### Included

- handwritten product and package source in `apps/**` and `packages/**`;
- unit, integration, architecture, and browser-contract tests;
- owned root and package build/validation scripts; and
- CI scripts added to implement this policy.

### Excluded

- `.git/**`, `.worktrees/**`, `node_modules/**`, and package-manager stores;
- `.turbo/**`, `.expo/**`, coverage output, logs, and temporary files;
- `dist/**`, `lib/**`, Rust `target/**`, APKs, and other build products;
- `src/generated/**`, `cpp/generated/**`, UniFFI bindings, and other clearly
  generated source;
- generated Android and iOS project output; and
- `.agents/**`, `.codex/**`, and `.claude/**` assets that configure development
  agents rather than ship in the product.

Tracked handwritten Kotlin, Java, Swift, Objective-C, C, C++, or Rust source is
still product source even when it sits below a directory named `android` or
`ios`. Only proved generated native output is excluded.

An excluded path must be excluded for a stated category, not because it happens
to contain a finding.

## Release Gates

### Nix

Before any release, record successful results for:

- `nix flake check --no-update-lock-file`; and
- `nix fmt flake.nix -- -c`, extended to any later owned Nix files.

Nix failure blocks release but does not make an ordinary pull request
unmergeable. A release commit change invalidates earlier evidence.

### Android and Expo

Before a mobile release:

- run `cd apps/mobile && pnpm exec expo install --check` without auto-fixing;
- run the non-destructive `pnpm --filter @fressh/mobile test:e2e` lane on a
  dedicated preview device;
- never use `test:e2e:clear-state` as the normal release check; and
- preserve the single signing lane and application data rules in `AGENTS.md`.

When a release contains native/runtime changes, also produce and verify the
canonical local EAS preview Android build. Native/runtime scope includes the
Rust/UniFFI package, Android/native configuration, native dependency changes,
and runtime-version-affecting configuration. A JS/assets-only change may use the
existing OTA path and does not need a new native preview build solely for this
quality policy.

Device evidence is tied to the exact commit, preview channel/build identity,
device identity, and test result. A later code change requires new evidence.

### iOS

iOS build and device checks remain a documented manual release step until the
project has a reliable macOS/iOS runner. The future runner may make this lane
automated, but it must not be folded into the portable Linux gate.

## Failure Output

Every failure must explain:

- the check that failed;
- the file, symbol, clone pair, dependency, or test involved;
- the measured value and allowed value;
- whether the item is new, grew above its ratchet, or has a stale baseline; and
- the local check-only command that reproduces the failure.

Reports may be uploaded as CI artifacts, but the job log must contain a short
actionable summary. A tool crash or unreadable baseline is a failed check, not a
warning.

## Quality-Tool Test Contract

The implementation of this policy needs its own small fixture suite. Fixtures
must prove that:

- `.worktrees`, generated files, and build products are excluded;
- a new file at the exact maximum passes and one line over fails;
- a grandfathered item may stay level or shrink but may not grow;
- a reduced baseline cannot become stale or increase later;
- rename handling preserves existing debt without creating new allowance;
- one removed dead-code or clone fingerprint cannot mask a different finding;
- line-number movement alone does not change a clone fingerprint;
- test files use the 1,000-line limit while their functions still use 80/15;
- a missing analyzer, malformed report, or malformed baseline fails closed; and
- the portable aggregate never invokes Nix, ADB, Maestro, EAS, Android/iOS SDKs,
  or a native mobile build.

## Delivery Boundaries

The later implementation plan must keep these changes separate and reversible:

1. create clean portable task entry points without enabling new structural
   checks;
2. fix scan scope, especially `.worktrees` and generated/build noise;
3. classify Knip findings and create exact initial fingerprints;
4. add the tested structural/ratchet checker and initial measurements;
5. wire required portable CI statuses;
6. add Nix release evidence; and
7. add Android/device release evidence without changing signing or clearing app
   data.

The initial baseline must be produced once from the reviewed implementation
commit. It is not an excuse to refactor unrelated code inside the quality-gate
change. The already planned subsystem work lowers the baseline over time.

## Acceptance Criteria

This policy is satisfied when an implementation plan can point to exact work for
all of the following:

- a clean-clone Linux command that runs every portable blocker without platform
  dependencies;
- no Nix or native/mobile work hidden inside portable lint, typecheck, build, or
  test dependencies;
- deterministic formatting, lint, type, Rust, dependency, dead-code,
  duplication, structural, and unit/integration results;
- exact 500/1,000/80/15 limits with no-growth baselines;
- exact, non-fungible Knip and clone fingerprints;
- one canonical include/exclude policy tested against linked worktrees and
  generated output;
- required release evidence for Nix and Android/device lanes;
- non-destructive Maestro behavior and signing/data safety; and
- clear local reproduction commands for every failure.

## Out of Scope

- Implementing CI workflows or package scripts in this ticket.
- Refactoring the oversized production and test files in this ticket.
- Requiring a global code-coverage percentage.
- Running App Store, Play Store, EAS publication, OTA publication, or device
  installation while defining the policy.
- Making Nix, Android, iOS, signing credentials, or a physical device a normal
  pull-request dependency.
- Hand-editing generated bindings or generated native projects.

## Rejected Alternatives

- **Strict limits immediately:** rejected because existing files would keep the
  first CI run permanently red and obscure new regressions.
- **Changed-files-only checks:** rejected because moving or indirectly changing
  old debt can bypass them and clean default-branch verification would not prove
  the repository state.
- **Numeric debt totals:** rejected because one removed problem could be
  replaced by a different problem.
- **Warning-only structural checks:** rejected because they do not constrain
  growth.
- **Nix and device checks on every pull request:** rejected because they destroy
  the portable lane and require scarce platform resources for unrelated changes.
