# Portable Quality Gate and Test Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one merge-blocking Linux quality gate, exact no-growth source
ratchets, focused test suites, and separate Nix and Android release evidence
without requiring platform tooling for ordinary pull requests.

**Architecture:** A small root TypeScript quality tool owns canonical source
scope, normalized findings, fingerprints, and baseline comparison. Existing
ESLint, Clippy, Knip, and JSCPD remain the analyzers; one focused Rust helper
uses `syn` only for Rust function spans. Package-owned `lint:portable` and
`test:portable` scripts feed two GitHub jobs, while Nix and Android/device
checks remain separate release lanes.

**Tech Stack:** Node 22 LTS, pnpm 10.18.0, Turbo 2.5.7, TypeScript 5.9, ESLint
9.35, Knip 5.63, JSCPD 4.0, Rust stable, Clippy, `syn`, Node test runner, Jest,
Playwright/Chromium, GitHub Actions, Nix, Expo/EAS, Maestro.

## Prerequisites

Read
`docs/superpowers/specs/2026-07-12-portable-source-quality-gate-policy-design.md`
first. Execute this plan only after these exact plans:

- `docs/superpowers/plans/2026-07-12-secure-storage-v2-automatic-migration.md`
- `docs/superpowers/plans/2026-07-12-shell-detail-wispr-decomposition.md`
- `docs/superpowers/plans/2026-07-12-shell-controller-modal-consolidation.md`
- `docs/superpowers/plans/2026-07-12-xterm-selection-architecture.md`
- `docs/superpowers/plans/2026-07-12-auto-connect-runtime-migration.md`
- `docs/superpowers/plans/2026-07-12-rust-shell-startup-decomposition.md`

If a prerequisite changes an exact final file name consumed below, update this
plan before implementation rather than improvising a second owner.

## Global Constraints

- Implement this plan only after the secure-storage v2, controller/modal,
  xterm-selection, auto-connect runtime, and Rust shell-startup plans have
  landed and passed their own maintainability gates.
- Start every production or developer-tool behavior change with a focused
  failing test and observe the expected failure before implementation.
- Use check-only commands in CI. No merge gate may rewrite source, baselines,
  lockfiles, or generated output.
- The normal pull-request gate runs on Linux with Node 22 LTS, pnpm 10.18.0, and
  the checked-in Rust toolchain only.
- The normal pull-request gate must not invoke Nix, Android/iOS SDKs, native
  UniFFI builds, ADB, Maestro, EAS, signing, publication, or deployment.
- Every portable formatting, lint, type, dependency, dead-code, duplication,
  structural, unit, integration, Rust, and headless Chromium check is
  merge-blocking.
- Final maxima are 500 nonblank lines for handwritten production/support files,
  1,000 for handwritten tests, 80 for TypeScript/JavaScript/Rust functions, and
  15 for TypeScript/JavaScript cyclomatic or Rust cognitive complexity.
- Count nonblank physical lines and include comments. Test classification uses
  `*.test.*`, `*.spec.*`, or a `test`, `tests`, or `__tests__` directory.
- New items get no allowance. Existing over-limit findings may stay level or
  decrease, never increase; a decrease must lower or remove its baseline entry.
- Duplication remains reportable at both 33 lines and 50 tokens. One removed
  clone cannot pay for a different clone.
- Dead-code and clone baselines use exact, non-fungible fingerprints. Real
  implicit entry points are configured; genuine existing debt is baselined.
- Exclude `.git`, `.worktrees`, dependencies, caches, build output, generated
  bindings/projects, Rust targets, agent assets, APKs, logs, and temporary
  files. Do not exclude tracked handwritten native source merely because its
  path contains `android` or `ios`.
- Do not add a global coverage percentage or automatic test retry.
- Normal mobile e2e uses `test:e2e`, preserves application data, and never calls
  `test:e2e:clear-state`.
- Android native release evidence uses the existing local EAS `preview` build,
  package `com.finalapp.vibe2`, and the single signing lane.
- Keep iOS as a documented manual release check until a reliable runner exists.
- Do not hand-edit generated bindings, generated native projects, or package
  build output.
- Run `$thermo-nuclear-code-quality-review` on the completed implementation and
  resolve every blocker through a fresh red-green cycle.

---

## Final File Shape

### Root quality tool

- `scripts/quality/policy.ts` — canonical include/exclude policy and thresholds.
- `scripts/quality/findings.ts` — finding types, stable SHA-256 IDs, sorting,
  and rendering.
- `scripts/quality/baseline.ts` — strict schema, comparison, initial creation,
  monotonic update, and rename handling.
- `scripts/quality/file-metrics.ts` — source discovery and nonblank counts.
- `scripts/quality/eslint-metrics.ts` — TypeScript/JavaScript structural reports
  mapped to stable function identities.
- `scripts/quality/rust-metrics.ts` — Rust helper and Clippy report adapter.
- `scripts/quality/clippy.toml` — structural-only cognitive threshold 15.
- `scripts/quality/jscpd-findings.ts` — JSCPD JSON normalization and clone hash.
- `scripts/quality/knip-findings.ts` — Knip JSON normalization.
- `scripts/quality/collect.ts` — runs analyzers and returns one sorted set.
- `scripts/quality/check.ts` — check-only CLI.
- `scripts/quality/init-baseline.ts` — first baseline creation only.
- `scripts/quality/update-baseline.ts` — removals, decreases, and explicit
  no-growth renames only.
- `scripts/quality/test-inventory.ts` — test declaration comparison for moves.
- `scripts/quality/*.test.ts` — policy, adapter, baseline, task-graph,
  suite-boundary, CI, and release contracts.
- `source-quality-baseline.json` — deterministic reviewed current debt.

### Rust span helper

- `tools/source-quality-rust/Cargo.toml`
- `tools/source-quality-rust/Cargo.lock`
- `tools/source-quality-rust/src/main.rs`
- `tools/source-quality-rust/tests/function_spans.rs`
- `tools/source-quality-rust/tests/fixtures/functions.rs`

The helper prints Rust function identities and nonblank span lengths as JSON. It
does not become a product workspace dependency and does not calculate
complexity; Clippy remains the Rust complexity analyzer.

### Automation

- Workspace manifests expose `lint:portable` and `test:portable`.
- `turbo.jsonc` defines platform-free portable tasks.
- `.jscpd.json` and `knip.ts` use the canonical scope.
- `.github/workflows/portable-quality.yml` publishes one required aggregate
  `Portable Quality` status.
- `.github/workflows/nix-release-quality.yml` records Nix release evidence.
- `.github/workflows/mobile-release-quality.yml` runs only on the dedicated
  Android self-hosted runner.
- `apps/mobile/scripts/run-release-quality.ts` safely creates commit-bound
  device/build evidence.
- `docs/quality-gates.md` documents reproduction, baseline updates, branch
  protection, and release evidence.

### Focused test suites

After prerequisite plans replace their own giant suites, delete the ten
remaining files over 1,000 nonblank lines and split them by owner:

- mdev bridge: protocol, deadlines, queue, lifecycle;
- connection run context: operations, cleanup, lifecycle, classification;
- security center: transfer, restore, recovery;
- Tailscale recovery: readiness, failure, concurrency, reset;
- shell browser actions: GitHub, host URL, Diffity;
- detected open: policy, controller, picker;
- keyboard remote: command, config, restart, lifecycle;
- scrollback executor: commands, reset, cleanup;
- xterm bridge: routing, load generations, scrollback failures, artifacts; and
- touch scroll: selection handoff, gestures, viewport, entry lifecycle.

Each family gets one domain fixture no larger than 500 nonblank lines. Generic
helpers are limited to deferred values, bounded settlement, microtask flushing,
and test-name inventory.

## Normalized Interfaces

```ts
export type FindingKind =
	| 'file-lines'
	| 'function-lines'
	| 'typescript-complexity'
	| 'rust-complexity'
	| 'clone'
	| 'dead-code';

export type SourceFinding = {
	id: string;
	kind: FindingKind;
	path: string;
	symbol?: string;
	value?: number;
	limit?: number;
	detail: string;
};

export type SourceQualityBaseline = {
	version: 1;
	findings: Array<
		Pick<SourceFinding, 'id' | 'kind' | 'path' | 'symbol' | 'value'>
	>;
};
```

`id` is SHA-256 over a versioned canonical identity: kind/path for files;
kind/path/qualified syntax identity/signature hash for functions; language,
sorted file identities, and normalized fragment hash for clones; and Knip
category/workspace/file/name for dead code. Line ranges are diagnostic only.

---

### Task 1: Create a Truly Portable Task Graph

**Files:**

- Create: `scripts/quality/portable-task-contract.test.ts`
- Modify: `package.json`
- Modify: `turbo.jsonc`
- Modify: `apps/mobile/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/react-native-uniffi-russh/package.json`
- Modify: `packages/react-native-xtermjs-webview/package.json`

**Interfaces:**

- Produces root `quality:static`, `quality:test`, and `quality:portable`
  scripts.
- Produces package `lint:portable` and `test:portable` scripts.
- Does not enable new source analyzers yet.

- [ ] **Step 1: Write the failing task-graph contract**

Read all manifests and `turbo.jsonc`. Assert:

```ts
assert.equal(root.scripts['quality:static'], 'turbo run lint:portable');
assert.equal(root.scripts['quality:test'], 'turbo run test:portable');
assert.equal(
	root.scripts['quality:portable'],
	'pnpm run quality:static && pnpm run quality:test',
);
assert.equal(
	root.scripts['test:quality'],
	'tsx --test scripts/quality/*.test.ts',
);
```

Assert the two Turbo tasks have no `dependsOn`. Recursively inspect their exact
scripts and reject:

```ts
const forbidden = [
	'nix ',
	'adb ',
	'maestro',
	'eas ',
	'build:android',
	'build:ios',
	'build:native',
	'test:e2e',
];
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/portable-task-contract.test.ts
```

Expected: FAIL because the portable scripts/tasks do not exist.

- [ ] **Step 3: Add exact package behaviors**

```text
root lint:portable = repository Prettier check + Syncpack check
root test:portable = scripts/quality tests
mobile lint:portable = ESLint check + TypeScript check
mobile test:portable = test:integration only
web lint:portable = ESLint check + TypeScript check
web test:portable = Astro build
UniFFI lint:portable = ESLint + TypeScript + Rustfmt + Clippy -D warnings
UniFFI test:portable = Jest + cargo test in rust/uniffi-russh
xterm lint:portable = ESLint + TypeScript
xterm test:portable = the prerequisite unit + browser test script
```

Declare root `lint:portable` and `test:portable` so Turbo includes the root. Do
not reuse the platform-coupled `lint:check` or mobile `test` Turbo graph.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/portable-task-contract.test.ts
pnpm run quality:static
pnpm run quality:test
git add package.json turbo.jsonc apps/mobile/package.json apps/web/package.json packages/react-native-uniffi-russh/package.json packages/react-native-xtermjs-webview/package.json scripts/quality/portable-task-contract.test.ts
git commit -m "Add portable repository quality tasks"
```

Expected: all host-only checks pass and the Turbo summary contains no forbidden
platform command.

### Task 2: Canonical Source Scope, File Metrics, and Test Inventory

**Files:**

- Create: `scripts/quality/policy.ts`
- Create: `scripts/quality/file-metrics.ts`
- Create: `scripts/quality/test-inventory.ts`
- Create: `scripts/quality/policy.test.ts`
- Create: `scripts/quality/test-inventory.test.ts`

**Interfaces:**

- Produces `classifySourcePath`, `discoverSourceFiles`, `countNonblankLines`,
  `collectFileMetrics`, and `collectTestDeclarations`.

- [ ] **Step 1: Write failing scope and limit tests**

```ts
assert.deepEqual(SOURCE_LIMITS, {
	productionFileLines: 500,
	testFileLines: 1_000,
	functionLines: 80,
	typescriptComplexity: 15,
	rustComplexity: 15,
	cloneLines: 33,
	cloneTokens: 50,
});
assert.equal(classifySourcePath('apps/mobile/src/a.ts'), 'production');
assert.equal(
	classifySourcePath('apps/mobile/test/integration/a.test.ts'),
	'test',
);
assert.equal(
	classifySourcePath('packages/native/android/src/main/Foo.kt'),
	'production',
);
assert.equal(classifySourcePath('.worktrees/x/apps/mobile/src/a.ts'), null);
assert.equal(classifySourcePath('packages/p/src/generated/api.ts'), null);
assert.equal(classifySourcePath('packages/p/android/build/Foo.kt'), null);
```

Add exact-maximum/one-line-over fixtures, an inline Rust test module that keeps
the production allowance, and literal/template-string test inventory cases.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/policy.test.ts scripts/quality/test-inventory.test.ts
```

Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement one canonical scope**

Use `globby` for `apps`, `packages`, `scripts`, `tools`, and tracked native
source. Normalize separators, reject absolute paths, apply exclusions before
extension classification, and count `line.trim() !== ''` including comments.

Use this exact handwritten extension set:

```ts
const SOURCE_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.astro',
	'.rs',
	'.kt',
	'.kts',
	'.java',
	'.swift',
	'.m',
	'.mm',
	'.c',
	'.cc',
	'.cpp',
	'.h',
	'.hpp',
	'.sh',
];
```

Use the TypeScript compiler API to return a sorted multiset of normalized first
arguments to `test()`/`it()`. The CLI accepts explicit paths and prints JSON.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/policy.test.ts scripts/quality/test-inventory.test.ts
git add scripts/quality/policy.ts scripts/quality/file-metrics.ts scripts/quality/test-inventory.ts scripts/quality/policy.test.ts scripts/quality/test-inventory.test.ts
git commit -m "Define canonical source quality scope"
```

### Task 3: Exact Finding and Ratchet Engine

**Files:**

- Create: `scripts/quality/findings.ts`
- Create: `scripts/quality/baseline.ts`
- Create: `scripts/quality/findings.test.ts`
- Create: `scripts/quality/baseline.test.ts`

**Interfaces:**

- Produces `findingId`, `parseBaseline`, `compareWithBaseline`,
  `createInitialBaseline`, and `createMonotonicBaselineUpdate`.

- [ ] **Step 1: Write the failing matrix**

```ts
assert.deepEqual(compareWithBaseline([], []), { ok: true, failures: [] });
assert.equal(compareWithBaseline([newFinding], []).failures[0]?.reason, 'new');
assert.equal(
	compareWithBaseline([grownFinding], [oldEntry]).failures[0]?.reason,
	'grew',
);
assert.equal(
	compareWithBaseline([reducedFinding], [oldEntry]).failures[0]?.reason,
	'stale-baseline',
);
assert.equal(
	compareWithBaseline([], [oldEntry]).failures[0]?.reason,
	'stale-baseline',
);
```

Add malformed version, duplicate ID, unsorted baseline, non-finite value,
replacement debt, exact rename, rename growth, and new-entry update tests.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/findings.test.ts scripts/quality/baseline.test.ts
```

Expected: FAIL because the engine is absent.

- [ ] **Step 3: Implement fail-closed comparison**

Canonicalize identity fields as JSON arrays, hash with Node SHA-256, sort by
kind/path/symbol/id, and reject unknown baseline keys. A lower current value
fails until its entry is lowered. Monotonic update accepts only deletion, lower
numeric values, or an explicit `oldPath=newPath` mapping with no growth.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/findings.test.ts scripts/quality/baseline.test.ts
git add scripts/quality/findings.ts scripts/quality/baseline.ts scripts/quality/findings.test.ts scripts/quality/baseline.test.ts
git commit -m "Add exact source quality ratchets"
```

### Task 4: TypeScript and JavaScript Function Metrics

**Files:**

- Create: `scripts/quality/eslint-metrics.ts`
- Create: `scripts/quality/eslint-metrics.test.ts`
- Create: `scripts/quality/fixtures/eslint-structural.ts`

**Interfaces:**

- Produces `collectEslintMetricFindings(run)`.
- Maps pinned ESLint messages to stable TypeScript syntax identities.

- [ ] **Step 1: Write failing real-ESLint tests**

Create one 80-line and one 81-line function, complexity-15 and complexity-16
functions, an anonymous callback, comments, and blank lines. Invoke ESLint with
`complexity` warning max 15 and `max-lines-per-function` warning max 80,
`skipBlankLines: true`, `skipComments: false`, IIFEs included. Assert only 81
and 16 report, comments count, blank lines do not, line movement keeps IDs, and
signature change changes IDs.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/eslint-metrics.test.ts
```

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the adapter**

Run package-local ESLint for mobile, web, UniFFI, and xterm with JSON output and
the two structural warning rules. Accept only exit 0/1 with valid JSON. Parse
measured values from the pinned messages and map each location to the smallest
containing TypeScript function node. Build qualified identity from enclosing
class/function/property/call, normalized signature hash, and an AST sibling
ordinal for anonymous callbacks. Do not use source line as identity.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/eslint-metrics.test.ts
git add scripts/quality/eslint-metrics.ts scripts/quality/eslint-metrics.test.ts scripts/quality/fixtures/eslint-structural.ts
git commit -m "Collect TypeScript structural metrics"
```

### Task 5: Rust Function Spans and Cognitive Complexity

**Files:**

- Create: `tools/source-quality-rust/Cargo.toml`
- Create: `tools/source-quality-rust/src/main.rs`
- Create: `tools/source-quality-rust/tests/function_spans.rs`
- Create: `tools/source-quality-rust/tests/fixtures/functions.rs`
- Create: `scripts/quality/rust-metrics.ts`
- Create: `scripts/quality/rust-metrics.test.ts`
- Create: `scripts/quality/clippy.toml`
- Modify: `package.json`
- Modify: `scripts/quality/portable-task-contract.test.ts`

**Interfaces:**

- Helper stdin: newline-delimited repository-relative `.rs` paths.
- Helper stdout:
  `[{ path, symbol, signatureHash, startLine, endLine, nonblankLines }]`.
- Produces `collectRustMetricFindings(run)`.

- [ ] **Step 1: Write failing span and adapter tests**

Use `syn` fixtures with free functions, impl methods, nested inline modules,
attributes, comments, blank lines, declarations, and closures. Assert only free
functions/methods are counted and identities survive inserted lines. Add Clippy
JSON fixtures proving score 15 passes, 16 reports, malformed score fails closed,
and unrelated Clippy messages are ignored here.

Add failing task-contract assertions that root `lint:portable` formats and
Clippy-checks the helper and root `test:portable` runs its Cargo tests.

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path tools/source-quality-rust/Cargo.toml
pnpm exec tsx --test scripts/quality/rust-metrics.test.ts
```

Expected: FAIL because helper/adapter are absent.

- [ ] **Step 3: Implement the helper and adapter**

Use `syn` (`full`, `visit`), `proc-macro2` (`span-locations`), `serde`,
`serde_json`, and `sha2`. Keep it outside product Cargo workspaces. Reject
outside-repository paths and parser errors.

Run the helper for scoped Rust files. Collect cognitive-complexity JSON from
both the UniFFI crate and the quality-helper crate:

```bash
CLIPPY_CONF_DIR="$(git rev-parse --show-toplevel)/scripts/quality" \
  cargo clippy --message-format=json --all-targets --all-features -- \
  -W clippy::cognitive_complexity

CLIPPY_CONF_DIR="$(git rev-parse --show-toplevel)/scripts/quality" \
  cargo clippy --manifest-path tools/source-quality-rust/Cargo.toml \
  --message-format=json --all-targets -- \
  -W clippy::cognitive_complexity
```

Set `cognitive-complexity-threshold = 15` in the dedicated `clippy.toml`. The
normal portable Clippy command does not set `CLIPPY_CONF_DIR` or enable the
restriction lint and continues to deny ordinary warnings.

Extend root portable scripts so helper `cargo fmt --check`, normal
`cargo clippy -D warnings`, and `cargo test` are always included after this
task.

- [ ] **Step 4: Run GREEN and commit**

```bash
cargo test --manifest-path tools/source-quality-rust/Cargo.toml
pnpm exec tsx --test scripts/quality/rust-metrics.test.ts
git add tools/source-quality-rust scripts/quality/rust-metrics.ts scripts/quality/rust-metrics.test.ts scripts/quality/clippy.toml package.json scripts/quality/portable-task-contract.test.ts
git commit -m "Collect Rust structural metrics"
```

### Task 6: Scoped Clone Fingerprints

**Files:**

- Modify: `.jscpd.json`
- Create: `scripts/quality/jscpd-findings.ts`
- Create: `scripts/quality/jscpd-findings.test.ts`
- Create: `scripts/quality/fixtures/jscpd-report.json`

**Interfaces:**

- Produces `collectJscpdFindings(run)`.
- JSCPD detects; the adapter decides failure.

- [ ] **Step 1: Write failing fingerprint tests**

Using a real JSON fixture, assert paths are relative/sorted; ID uses format,
both paths, normalized fragment hash; line movement/whitespace keep ID; content
change changes it; file swap keeps it; malformed JSON, absolute paths, missing
fragment, or unexpected exit fails closed.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/jscpd-findings.test.ts
```

Expected: FAIL because adapter is absent.

- [ ] **Step 3: Scope JSCPD and normalize**

Set 33 lines, 50 tokens, 10,000 max lines, `2mb` max size, and detector
threshold above 100. Scan only `apps`, `packages`, `scripts`; ignore canonical
worktree/generated/build/cache/target/agent/dependency/artifact paths. Write
JSON to an OS temp directory and hash fragments after
newline/horizontal-whitespace normalization.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/jscpd-findings.test.ts
pnpm exec tsx -e "import('./scripts/quality/jscpd-findings.ts').then(async m => console.log((await m.collectJscpdFindings()).length))"
git add .jscpd.json scripts/quality/jscpd-findings.ts scripts/quality/jscpd-findings.test.ts scripts/quality/fixtures/jscpd-report.json
git commit -m "Fingerprint scoped source duplication"
```

Expected: no finding path mentions `.worktrees` or generated/build output.

### Task 7: Curated Knip Findings

**Files:**

- Modify: `knip.ts`
- Create: `scripts/quality/knip-findings.ts`
- Create: `scripts/quality/knip-findings.test.ts`
- Create: `scripts/quality/fixtures/knip-report.json`

**Interfaces:**

- Produces `collectKnipFindings(run)`.
- Models implicit entry points; remaining findings become exact debt.

- [ ] **Step 1: Write failing normalization tests**

Cover unused files, dependencies, dev dependencies, unlisted dependencies,
unresolved imports, exports, types, enum members, duplicate exports, and config
hints. Line/column changes keep IDs; category/workspace/file/name changes do
not. Invalid or unexpected schema fails closed.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/knip-findings.test.ts
```

Expected: FAIL because adapter is absent.

- [ ] **Step 3: Declare exact implicit entry points**

```text
apps/mobile/app.config.ts
apps/mobile/plugins/**/*.ts
apps/mobile/scripts/**/*.ts
apps/mobile/.release-it.ts
packages/react-native-xtermjs-webview/src-internal/main.tsx
packages/react-native-xtermjs-webview/src-internal/dev.ts
packages/react-native-xtermjs-webview/vite*.ts
packages/react-native-xtermjs-webview/.release-it.ts
packages/react-native-uniffi-russh/babel.config.js
packages/react-native-uniffi-russh/react-native.config.js
packages/react-native-uniffi-russh/scripts/**/*.ts
packages/react-native-uniffi-russh/.release-it.ts
scripts/quality/**/*.ts
```

Keep agent/generated/build exclusions. Add only exact documented implicit tool
dependencies such as `react-native-worklets` for Reanimated and Astro's
build-time `sharp`; no wildcard dependency ignore. Leave remaining real findings
visible for baseline.

Collect the JSON reporter plus the compact reporter's `Configuration hints`
section because Knip 5.63 omits those hints from its JSON schema. Normalize each
hint as dead-code category `configuration-hint`; an unrecognized compact-report
shape fails closed.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/knip-findings.test.ts
pnpm exec knip --reporter json >/tmp/fressh-knip.json || test $? -eq 1
jq -e '.files and .issues' /tmp/fressh-knip.json
git add knip.ts scripts/quality/knip-findings.ts scripts/quality/knip-findings.test.ts scripts/quality/fixtures/knip-report.json
git commit -m "Curate repository dead code detection"
```

Expected: real entries disappear as false positives; genuine findings remain.

### Task 8: Check-Only Orchestration and Safe Baseline Commands

**Files:**

- Create: `scripts/quality/collect.ts`
- Create: `scripts/quality/check.ts`
- Create: `scripts/quality/init-baseline.ts`
- Create: `scripts/quality/update-baseline.ts`
- Create: `scripts/quality/check.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces `quality:source:check`, `quality:baseline:init`, and
  `quality:baseline:update`.
- Initialization remains unused until suite splitting finishes.

- [ ] **Step 1: Write failing orchestration tests**

Inject collectors and cover deterministic merge/sort, duplicate IDs, analyzer
crash, missing/malformed report, malformed baseline, new/grown/reduced/stale
findings, and a clean comparison. Assert init refuses an existing file and
update refuses additions/growth while accepting removals/decreases/explicit
no-growth renames.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/check.test.ts
```

Expected: FAIL because CLIs are absent.

- [ ] **Step 3: Implement check-only CLIs**

Use OS temp reports removed in `finally`. `check.ts` reads but never writes the
baseline. Print check, path, symbol, measured/allowed value, reason, and local
reproduction command. A missing analyzer fails.

```json
{
	"quality:source:check": "tsx scripts/quality/check.ts",
	"quality:baseline:init": "tsx scripts/quality/init-baseline.ts",
	"quality:baseline:update": "tsx scripts/quality/update-baseline.ts"
}
```

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/check.test.ts scripts/quality/*.test.ts
git add package.json scripts/quality/collect.ts scripts/quality/check.ts scripts/quality/init-baseline.ts scripts/quality/update-baseline.ts scripts/quality/check.test.ts
git commit -m "Add check-only source quality orchestration"
```

### Task 9: Split the Mdev Bridge Suite

**Files:**

- Create: `scripts/quality/test-suite-boundaries.test.ts`
- Create: `apps/mobile/test/integration/helpers/async-fixtures.ts`
- Create: `apps/mobile/test/integration/helpers/async-fixtures.test.ts`
- Create: `apps/mobile/test/integration/helpers/mdev-bridge-client-fixture.ts`
- Create: `apps/mobile/test/integration/mdev-bridge-client-protocol.test.ts`
- Create: `apps/mobile/test/integration/mdev-bridge-client-deadlines.test.ts`
- Create: `apps/mobile/test/integration/mdev-bridge-client-queue.test.ts`
- Create: `apps/mobile/test/integration/mdev-bridge-client-lifecycle.test.ts`
- Delete: `apps/mobile/test/integration/mdev-bridge-client.test.ts`

**Interfaces:**

- Fixture owns byte/text conversion, deferred values, fake bridge clock, stream
  harness, bounded timeout, and write parsing.
- Shared async fixture exports only `deferred`, `flushMicrotasks`, and
  `settlesWithin`; later mobile domain fixtures reuse those exact functions.
- Production mdev behavior remains unchanged.

- [ ] **Step 1: Record the passing declaration inventory**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/mdev-bridge-client.test.ts >/tmp/mdev-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/mdev-bridge-client.test.ts
```

Expected: old suite passes and inventory is valid JSON.

- [ ] **Step 2: Add RED suite-boundary assertions**

Assert old file absent, five replacements present, both fixtures at most 500
nonblank lines, and each test at most 1,000. Add direct tests that deferred
resolve/reject, microtasks flush, and settlement timeout succeeds/fails. Run and
observe the boundary failure on the old file.

- [ ] **Step 3: Move tests by owner**

- protocol: hello/capabilities, protocol/malformed errors, serialization,
  stdout/stderr, UTF-8, and write failures;
- deadlines: cold startup, hello, request, queue wait, overrides, single budget;
- queue: sequential execution, queued settlement, bounded replacement;
- lifecycle: stream close, dispose/reconnect, startup abort, late stream,
  cleanup containment.

Remove local duplicates and import only used fixture methods.

- [ ] **Step 4: Prove declarations and behavior**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/mdev-bridge-client-*.test.ts >/tmp/mdev-after.json
diff -u /tmp/mdev-before.json /tmp/mdev-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/mdev-bridge-client-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

Expected: inventories match; all split suites pass.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile/test/integration/mdev-bridge-client.test.ts apps/mobile/test/integration/mdev-bridge-client-*.test.ts apps/mobile/test/integration/helpers/mdev-bridge-client-fixture.ts apps/mobile/test/integration/helpers/async-fixtures.ts apps/mobile/test/integration/helpers/async-fixtures.test.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split mdev bridge integration tests"
```

### Task 10: Split Connection-Run Context Tests

**Files:**

- Create:
  `apps/mobile/test/integration/helpers/connection-run-context-fixture.ts`
- Create:
  `apps/mobile/test/integration/connection-run-context-operations.test.ts`
- Create: `apps/mobile/test/integration/connection-run-context-cleanup.test.ts`
- Create:
  `apps/mobile/test/integration/connection-run-context-lifecycle.test.ts`
- Create:
  `apps/mobile/test/integration/connection-run-context-classification.test.ts`
- Delete: `apps/mobile/test/integration/connection-run-context.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Fixture owns controlled timers, tracked/no-reason abort controllers, signal
  assertions, and promise flushing.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run the old suite and save `/tmp/run-context-before.json`. Add old-file-absent,
replacement-present, and 500/1,000 assertions; observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/connection-run-context.test.ts >/tmp/run-context-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-run-context.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move tests by owner**

- operations: operation timeout, caller abort, stale operation, result
  suppression;
- cleanup: post-timeout cleanup, cleanup abort/timeout, remembered stop reason;
- lifecycle: finish/disposal, timer/listener cleanup, manual abort;
- classification: context error, DOM abort, network abort text, metadata.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/connection-run-context-*.test.ts >/tmp/run-context-after.json
diff -u /tmp/run-context-before.json /tmp/run-context-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/connection-run-context-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/connection-run-context.test.ts apps/mobile/test/integration/connection-run-context-*.test.ts apps/mobile/test/integration/helpers/connection-run-context-fixture.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split connection run context tests"
```

### Task 11: Split Security-Center Flow Tests

**Files:**

- Create: `apps/mobile/test/integration/helpers/security-center-fixtures.ts`
- Create: `apps/mobile/test/integration/security-center-transfer.test.ts`
- Create: `apps/mobile/test/integration/security-center-restore.test.ts`
- Create: `apps/mobile/test/integration/security-center-recovery.test.ts`
- Delete: `apps/mobile/test/integration/security-center-flow.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Consumes transactional-storage fixtures from the storage-v2 plan.
- Adds only backup-payload and memory restore-journal helpers.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run the post-storage-v2 old suite, save `/tmp/security-center-before.json`, add
old-file/replacement/limit assertions, and observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/security-center-flow.test.ts >/tmp/security-center-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/security-center-flow.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move by public operation**

- transfer: export/share cleanup, picker cancel/validation, preflight summary;
- restore: normalization, counts, replacements, rollback and rollback failure;
- recovery: target/previous replay, completed/stale/legacy journals, invalid or
  unreadable journal cleanup, non-fatal clear failure.

Do not recreate the source-regex test removed by storage v2.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/security-center-*.test.ts >/tmp/security-center-after.json
diff -u /tmp/security-center-before.json /tmp/security-center-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/security-center-*.test.ts test/integration/transactional-storage-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/security-center-flow.test.ts apps/mobile/test/integration/security-center-*.test.ts apps/mobile/test/integration/helpers/security-center-fixtures.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split security center flow tests"
```

### Task 12: Split Tailscale Recovery Tests

**Files:**

- Create: `apps/mobile/test/integration/helpers/tailscale-recovery-fixture.ts`
- Create: `apps/mobile/test/integration/tailscale-recovery-readiness.test.ts`
- Create: `apps/mobile/test/integration/tailscale-recovery-failure.test.ts`
- Create: `apps/mobile/test/integration/tailscale-recovery-concurrency.test.ts`
- Create: `apps/mobile/test/integration/tailscale-recovery-reset.test.ts`
- Delete: `apps/mobile/test/integration/tailscale-recovery.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Fixture owns native variants, network snapshots, deferred values, controlled
  clocks, cooldown state, and bounded settlement.
- Auto-connect runtime port tests remain separate.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run the post-auto-connect old suite, save `/tmp/tailscale-before.json`, add
replacement/limit assertions, and observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/tailscale-recovery.test.ts >/tmp/tailscale-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move by recovery command**

- readiness: platform/availability, preflight, timeout, cooldown, connect;
- failure: network classification, retry consumption, result kinds, cooldown;
- concurrency: shared connect, readiness/failure join, stuck native calls,
  independent controllers;
- reset: disconnect/connect ordering, skipped/failed calls, cooldown, `openApp`.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/tailscale-recovery-readiness.test.ts apps/mobile/test/integration/tailscale-recovery-failure.test.ts apps/mobile/test/integration/tailscale-recovery-concurrency.test.ts apps/mobile/test/integration/tailscale-recovery-reset.test.ts >/tmp/tailscale-after.json
diff -u /tmp/tailscale-before.json /tmp/tailscale-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-*.test.ts test/integration/auto-connect-runtime-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/tailscale-recovery.test.ts apps/mobile/test/integration/tailscale-recovery-*.test.ts apps/mobile/test/integration/helpers/tailscale-recovery-fixture.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split Tailscale recovery tests"
```

### Task 13: Split Shell Browser-Action Tests

**Files:**

- Create:
  `apps/mobile/test/integration/helpers/shell-browser-action-fixtures.ts`
- Create: `apps/mobile/test/integration/shell-browser-actions-github.test.ts`
- Create: `apps/mobile/test/integration/shell-browser-actions-host-url.test.ts`
- Create: `apps/mobile/test/integration/shell-browser-actions-diffity.test.ts`
- Delete: `apps/mobile/test/integration/shell-modals.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Aligns with the canonical browser-actions controller from the controller plan;
  modal chrome stays in `shell-modal-frame.test.ts`.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run old suite, save `/tmp/shell-modals-before.json`, assert old file absent and
replacements meet limits, then observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/shell-modals.test.ts >/tmp/shell-modals-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-modals.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move browser-action tests**

- GitHub: cleanup/error inputs, resolution/redaction, staleness, Android open;
- host URL: read/edit/open, invalid/missing, submit/save/open, stale cleanup;
- Diffity: output/reporting, stale cleanup, empty/failed command, Android open.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/shell-browser-actions-github.test.ts apps/mobile/test/integration/shell-browser-actions-host-url.test.ts apps/mobile/test/integration/shell-browser-actions-diffity.test.ts >/tmp/shell-modals-after.json
diff -u /tmp/shell-modals-before.json /tmp/shell-modals-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-browser-actions-*.test.ts test/integration/shell-modal-frame.test.ts test/integration/shell-controller-architecture.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/shell-modals.test.ts apps/mobile/test/integration/shell-browser-actions-*.test.ts apps/mobile/test/integration/helpers/shell-browser-action-fixtures.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split shell browser action tests"
```

### Task 14: Split Detected-Open Tests

**Files:**

- Create: `apps/mobile/test/integration/helpers/detected-open-fixtures.ts`
- Create: `apps/mobile/test/integration/detected-open-policy.test.ts`
- Create: `apps/mobile/test/integration/detected-open-controller.test.ts`
- Create: `apps/mobile/test/integration/detected-open-picker.test.ts`
- Delete: `apps/mobile/test/integration/detected-open-actions.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Aligns detected-open policy, command execution, and picker tests with their
  separate browser-actions controller units.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run old suite, save `/tmp/detected-open-before.json`, assert old file absent and
replacements meet limits, then observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/detected-open-actions.test.ts >/tmp/detected-open-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/detected-open-actions.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move by detected-open owner**

- policy: timeouts, shortcuts, request admission, callback selection;
- controller: auto/pick, invalid/empty output, busy, legacy error, stale
  command;
- picker: current/stale bridge, pane context, URL failure, stale open rejection.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/detected-open-policy.test.ts apps/mobile/test/integration/detected-open-controller.test.ts apps/mobile/test/integration/detected-open-picker.test.ts >/tmp/detected-open-after.json
diff -u /tmp/detected-open-before.json /tmp/detected-open-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/detected-open-*.test.ts test/integration/shell-browser-actions-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/detected-open-actions.test.ts apps/mobile/test/integration/detected-open-*.test.ts apps/mobile/test/integration/helpers/detected-open-fixtures.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split detected-open integration tests"
```

### Task 15: Split Keyboard-Remote Tests

**Files:**

- Create:
  `apps/mobile/test/integration/helpers/shell-keyboard-remote-fixture.ts`
- Create: `apps/mobile/test/integration/shell-keyboard-remote-command.test.ts`
- Create: `apps/mobile/test/integration/shell-keyboard-remote-config.test.ts`
- Create: `apps/mobile/test/integration/shell-keyboard-remote-restart.test.ts`
- Create: `apps/mobile/test/integration/shell-keyboard-remote-lifecycle.test.ts`
- Delete:
  `apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Fixture owns target, activity, Workmux channel, log/alert, reload, and restart
  controls from the final keyboard runtime.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run old suite, save `/tmp/keyboard-remote-before.json`, add replacement/limit
assertions, and observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts >/tmp/keyboard-remote-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-keyboard-remote-controller.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move by remote operation**

- command: success/failure, clocks, invalidation, logging, target, queue;
- config: reload ownership, apply, callback containment, feedback, replacement;
- restart: timeout, admission, operation, alert/log reentry, stale failure;
- lifecycle: activity/nav reentry, detach, disposal, unresolved work, inertness.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/shell-keyboard-remote-*.test.ts >/tmp/keyboard-remote-after.json
diff -u /tmp/keyboard-remote-before.json /tmp/keyboard-remote-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-keyboard-*.test.ts test/integration/keyboard-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts apps/mobile/test/integration/shell-keyboard-remote-*.test.ts apps/mobile/test/integration/helpers/shell-keyboard-remote-fixture.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split keyboard remote tests"
```

### Task 16: Split Scrollback Executor Tests

**Files:**

- Create:
  `apps/mobile/test/integration/helpers/tmux-scrollback-executor-fixture.ts`
- Create:
  `apps/mobile/test/integration/tmux-scrollback-executor-commands.test.ts`
- Create: `apps/mobile/test/integration/tmux-scrollback-executor-reset.test.ts`
- Create:
  `apps/mobile/test/integration/tmux-scrollback-executor-cleanup.test.ts`
- Delete: `apps/mobile/test/integration/tmux-scrollback-executor.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Fixture owns page/line commands, recording transport, executor factory,
  deferred results, owner registry, and runtime reset.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run old suite, save `/tmp/scrollback-executor-before.json`, add
replacement/limit assertions, and observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/tmux-scrollback-executor.test.ts >/tmp/scrollback-executor-before.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/tmux-scrollback-executor.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
```

- [ ] **Step 2: Move by protocol phase**

- commands: enter/move/exit, failure hooks, pending batches, bounded fanout,
  typed movement, replacement;
- reset: enter cancellation, pending batches, active/inactive copy mode,
  repeated reset, exit failure;
- cleanup: dispose rollback, barrier, stale/current ownership, mixed/same
  target.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts apps/mobile/test/integration/tmux-scrollback-executor-*.test.ts >/tmp/scrollback-executor-after.json
diff -u /tmp/scrollback-executor-before.json /tmp/scrollback-executor-after.json
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-scrollback-*.test.ts test/integration/tmux-scrollback-*.test.ts
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A apps/mobile/test/integration/tmux-scrollback-executor.test.ts apps/mobile/test/integration/tmux-scrollback-executor-*.test.ts apps/mobile/test/integration/helpers/tmux-scrollback-executor-fixture.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split scrollback executor tests"
```

### Task 17: Split Xterm Bridge Tests

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/test-support/bridge-fixture.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/bridge-message-routing.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/bridge-load-generation.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/bridge-scrollback-failure.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/bridge-artifact-contract.test.ts`
- Delete:
  `packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Reuses xterm plan `fake-dom.ts`; adds only bridge behavior.
- Leaves Playwright selection contracts unchanged.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run post-xterm-plan bridge file plus browser tests, save inventory, assert old
file absent and replacements meet limits, then observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts >/tmp/xterm-bridge-before.json
pnpm --filter @fressh/react-native-xtermjs-webview exec tsx --test src-internal/bridge-contract.test.ts
```

- [ ] **Step 2: Move bridge tests**

- routing: batch mapping, current/stale instance, selection, size, ack handles;
- load generation: IDs/tokens, invalidation, initialized messages, resets;
- scrollback failure: rejection/throw/missing callback and fallback exit;
- artifacts: public dist, native scrolling CSS, touch action, generated sync.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts packages/react-native-xtermjs-webview/src-internal/bridge-message-routing.test.ts packages/react-native-xtermjs-webview/src-internal/bridge-load-generation.test.ts packages/react-native-xtermjs-webview/src-internal/bridge-scrollback-failure.test.ts packages/react-native-xtermjs-webview/src-internal/bridge-artifact-contract.test.ts >/tmp/xterm-bridge-after.json
diff -u /tmp/xterm-bridge-before.json /tmp/xterm-bridge-after.json
pnpm --filter @fressh/react-native-xtermjs-webview run test:unit
pnpm --filter @fressh/react-native-xtermjs-webview run test:browser
pnpm --filter @fressh/react-native-xtermjs-webview run typecheck
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts packages/react-native-xtermjs-webview/src-internal/bridge-*.test.ts packages/react-native-xtermjs-webview/src-internal/test-support/bridge-fixture.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split xterm bridge tests"
```

### Task 18: Split Xterm Touch-Scroll Tests

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/test-support/touch-scroll-fixture.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-selection-handoff.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-gestures.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-viewport.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-entry-lifecycle.test.ts`
- Delete:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.test.ts`
- Modify: `scripts/quality/test-suite-boundaries.test.ts`

**Interfaces:**

- Reuses `fake-dom.ts` and keeps selection-owner tests untouched.

- [ ] **Step 1: Capture inventory and add RED boundary**

Run the post-xterm-plan touch-scroll file, save inventory, assert old file
absent and replacements meet limits, then observe failure.

```bash
pnpm exec tsx scripts/quality/test-inventory.ts packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.test.ts >/tmp/touch-scroll-before.json
pnpm --filter @fressh/react-native-xtermjs-webview exec tsx --test src-internal/touch-scroll-controller.test.ts
```

- [ ] **Step 2: Move by touch-scroll phase**

- handoff: pending/active/mid-drag selection transfer;
- gestures: pointer/touch slop, drag, release, cancel;
- viewport: page step, body class, telemetry, bottom pin, local scroll;
- entry lifecycle: delayed/lost ack, force close, restart, exit, cleanup.

- [ ] **Step 3: Compare, run GREEN, and commit**

```bash
pnpm exec tsx scripts/quality/test-inventory.ts packages/react-native-xtermjs-webview/src-internal/touch-scroll-*.test.ts >/tmp/touch-scroll-after.json
diff -u /tmp/touch-scroll-before.json /tmp/touch-scroll-after.json
pnpm --filter @fressh/react-native-xtermjs-webview run test:unit
pnpm --filter @fressh/react-native-xtermjs-webview run test:browser
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts
git add -A packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.test.ts packages/react-native-xtermjs-webview/src-internal/touch-scroll-*.test.ts packages/react-native-xtermjs-webview/src-internal/test-support/touch-scroll-fixture.ts scripts/quality/test-suite-boundaries.test.ts
git commit -m "Split xterm touch scroll tests"
```

### Task 19: Create the Reviewed Initial Baseline and Enable the Gate

**Files:**

- Create: `source-quality-baseline.json`
- Modify: `package.json`
- Modify: `scripts/quality/portable-task-contract.test.ts`
- Modify: `scripts/quality/check.test.ts`

**Interfaces:**

- Makes `quality:source:check` part of root `lint:portable`.
- Baseline captures only remaining post-prerequisite, post-split debt.

- [ ] **Step 1: Add failing gate assertions**

Assert root `lint:portable` ends with `pnpm run quality:source:check`. Assert
baseline parses, is sorted/version 1, contains no entry at/below final limit,
and contains no excluded path.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/portable-task-contract.test.ts scripts/quality/check.test.ts
```

Expected: FAIL because baseline is absent and source check is unwired.

- [ ] **Step 3: Generate and review the baseline once**

```bash
test ! -e source-quality-baseline.json
pnpm run quality:baseline:init
pnpm exec prettier --write source-quality-baseline.json
git diff -- source-quality-baseline.json
```

Review every Knip implicit entry and clone path. Reject worktree, generated,
build, or agent paths instead of accepting them. Confirm ten deleted giant test
paths are absent.

- [ ] **Step 4: Wire and run GREEN**

Add `pnpm run quality:source:check` to root `lint:portable`, then run:

```bash
pnpm run quality:source:check
pnpm exec tsx --test scripts/quality/*.test.ts
pnpm run quality:static
```

Expected: exact baseline, no stale/new/grown findings, full static gate passes.

- [ ] **Step 5: Prove regression failures**

In temporary fixtures, increase a baselined metric by one and observe `grew`;
remove a finding without baseline update and observe `stale-baseline`; replace
it and observe stale plus new. Restore fixtures and rerun GREEN.

- [ ] **Step 6: Commit**

```bash
git add source-quality-baseline.json package.json scripts/quality/portable-task-contract.test.ts scripts/quality/check.test.ts
git commit -m "Enable source quality ratchets"
```

### Task 20: Required GitHub Portable Quality Status

**Files:**

- Create: `.github/workflows/portable-quality.yml`
- Create: `scripts/quality/ci-contract.test.ts`
- Create: `docs/quality-gates.md`

**Interfaces:**

- Produces `Portable Static`, `Portable Tests`, aggregate `Portable Quality`.
- Branch protection requires the aggregate only.

- [ ] **Step 1: Write failing workflow contract**

Assert `contents: read`, pull-request and `dev` push triggers, concurrency
cancellation, Node 22, frozen install, static/test jobs, and an `if: always()`
aggregate that fails unless both needs results equal `success`. Reject every
portable forbidden command.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test scripts/quality/ci-contract.test.ts
```

Expected: FAIL because workflow is absent.

- [ ] **Step 3: Create exact workflow**

Use `actions/checkout@v7`, `pnpm/action-setup@v6`, and `actions/setup-node@v6`
with pnpm cache. Both jobs run frozen install. Static runs
`pnpm run quality:static` then `git diff --exit-code`. Tests install Playwright
Chromium with dependencies, run `pnpm run quality:test`, then the same diff
check. Aggregate performs no checkout and exits nonzero unless both succeeded;
display name is exactly `Portable Quality`.

- [ ] **Step 4: Run GREEN and document protection**

```bash
pnpm exec tsx --test scripts/quality/ci-contract.test.ts
pnpm run quality:portable
git diff --check
```

Document the repository-admin step to require `Portable Quality`. Do not mutate
remote branch protection silently; record API/UI confirmation in handoff.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/portable-quality.yml scripts/quality/ci-contract.test.ts docs/quality-gates.md
git commit -m "Add required portable quality workflow"
```

### Task 21: Nix Release Gate

**Files:**

- Create: `.github/workflows/nix-release-quality.yml`
- Create: `scripts/quality/release-contract.test.ts`
- Modify: `package.json`
- Modify: `apps/mobile/.release-it.ts`
- Modify: `packages/react-native-uniffi-russh/.release-it.ts`
- Modify: `packages/react-native-xtermjs-webview/.release-it.ts`
- Modify: `docs/quality-gates.md`

**Interfaces:**

- Produces `quality:release:nix`.
- All release-it flows run portable and Nix gates before version/tag/publish.

- [ ] **Step 1: Write failing contracts**

```ts
assert.equal(
	root.scripts['quality:release:nix'],
	'nix flake check --no-update-lock-file && nix fmt flake.nix -- -c',
);
```

Assert all release configs invoke root `quality:portable` and
`quality:release:nix` in `before:init`. Assert Nix workflow is manual, checks
out requested ref, uses `DeterminateSystems/determinate-nix-action@v3`, and runs
only Nix script.

Use exact root invocation `pnpm --dir ../.. run <script>` from each release
config; all three package directories are exactly two levels below the root.

- [ ] **Step 2: Run RED**

Expected: release contract fails because scripts/workflow/hooks are absent.

- [ ] **Step 3: Implement without disturbing publish hooks**

Use `actions/checkout@v7`. Never update `flake.lock`. Preserve current build,
version, tag, and publication hooks after new checks.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test scripts/quality/release-contract.test.ts
pnpm run quality:release:nix
git diff --exit-code -- flake.lock
git add .github/workflows/nix-release-quality.yml scripts/quality/release-contract.test.ts package.json apps/mobile/.release-it.ts packages/react-native-uniffi-russh/.release-it.ts packages/react-native-xtermjs-webview/.release-it.ts docs/quality-gates.md
git commit -m "Require Nix quality evidence for releases"
```

### Task 22: Safe Android Release Evidence

**Files:**

- Create: `apps/mobile/scripts/run-release-quality.ts`
- Create: `apps/mobile/test/integration/run-release-quality.test.ts`
- Create: `.github/workflows/mobile-release-quality.yml`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/.release-it.ts`
- Modify: `.gitignore`
- Modify: `scripts/quality/release-contract.test.ts`
- Modify: `docs/quality-gates.md`

**Interfaces:**

- CLI requires `--kind js` or `--kind native` and a dedicated device serial.
- Output: `artifacts/release-quality/<commit>.json`.
- Native output: `artifacts/release-quality/<commit>-preview.apk`.

- [ ] **Step 1: Write failing injected-runner tests**

Test JS/native command plans. Both run Expo `install --check`, package/channel
identity, and non-destructive `test:e2e`. Native additionally uses local preview
EAS with `EAS_SKIP_AUTO_FINGERPRINT=1`, explicit SDK roots, `--output`, and
`adb -s <serial> install -r`.

Reject dirty tree, commit mismatch, missing/multiple devices, wrong package,
wrong channel, destructive Maestro environment variables, and commands
containing `pm clear`, `test:e2e:clear-state`, submit, update, or publish.
Evidence contains commit, kind, serial, package, channel, command results, UTC
timestamps, and APK SHA-256 in native mode.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/run-release-quality.test.ts
```

Expected: FAIL because runner is absent.

- [ ] **Step 3: Implement safe runner**

Expose `buildReleaseQualityPlan()` and `runReleaseQuality(plan, runner)`; CLI
supplies real runner. Use:

```bash
cd apps/mobile
pnpm exec expo install --check
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --non-interactive --profile preview \
  --platform android --output <absolute-artifact-apk>
```

Install only with `adb -s "$FRESSH_RELEASE_DEVICE_SERIAL" install -r`. Run
`pnpm --filter @fressh/mobile test:e2e`; never uninstall, clear, or mix signing.
Unset `MAESTRO_E2E_CLEAR_STATE` and the destructive confirmation variable before
the e2e child process.

- [ ] **Step 4: Add workflow and evidence hook**

Manual workflow accepts `ref`/`kind`, runs on
`[self-hosted, linux, fressh-android-release]`, requires runner >=2.327.1,
checks out exact ref with `actions/checkout@v7`, uses `pnpm/action-setup@v6` and
`actions/setup-node@v6`, runs portable quality, invokes runner, uploads with
`actions/upload-artifact@v7`, and never publishes.

Add `quality:release:mobile` and commit-evidence verification to mobile
release-it `before:init`; evidence for another commit is rejected. Document the
manual iOS build/device check and state that it cannot satisfy or replace the
Android evidence file.

- [ ] **Step 5: Run GREEN without device mutation**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/run-release-quality.test.ts
pnpm exec tsx --test scripts/quality/release-contract.test.ts
pnpm --filter @fressh/mobile run typecheck
```

Expected: injected command/evidence and workflow contracts pass. Do not invoke
real release CLI unless dedicated runner is available and authorized.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/scripts/run-release-quality.ts apps/mobile/test/integration/run-release-quality.test.ts apps/mobile/package.json apps/mobile/.release-it.ts .github/workflows/mobile-release-quality.yml .gitignore scripts/quality/release-contract.test.ts docs/quality-gates.md
git commit -m "Add safe Android release quality evidence"
```

### Task 23: Full Verification and Thermo-Nuclear Review

**Files:**

- Modify only files required by a failing check or confirmed maintainability
  blocker. Every behavior fix starts with a failing test.

**Interfaces:**

- Verifies all gates without publication, data clearing, or deployment.

- [ ] **Step 1: Run tool/helper tests**

```bash
pnpm exec tsx --test scripts/quality/*.test.ts
cargo fmt --manifest-path tools/source-quality-rust/Cargo.toml -- --check
cargo test --manifest-path tools/source-quality-rust/Cargo.toml
cargo clippy --manifest-path tools/source-quality-rust/Cargo.toml --all-targets -- -D warnings
```

- [ ] **Step 2: Run portable gate twice and prove immutability**

```bash
pnpm run quality:portable
git diff --exit-code -- pnpm-lock.yaml source-quality-baseline.json packages/react-native-uniffi-russh/src/generated packages/react-native-uniffi-russh/cpp/generated
pnpm run quality:portable
git diff --exit-code -- pnpm-lock.yaml source-quality-baseline.json packages/react-native-uniffi-russh/src/generated packages/react-native-uniffi-russh/cpp/generated
```

Expected: both runs pass and mutate none of the listed files.

- [ ] **Step 3: Verify suite, task, CI, and release contracts**

```bash
pnpm exec tsx --test scripts/quality/test-suite-boundaries.test.ts scripts/quality/portable-task-contract.test.ts scripts/quality/ci-contract.test.ts scripts/quality/release-contract.test.ts
if rg -n "test:e2e:clear-state|pm clear|eas (update|submit)|publish" .github/workflows/portable-quality.yml .github/workflows/mobile-release-quality.yml; then exit 1; fi
git diff --check
```

- [ ] **Step 4: Run non-device release checks**

```bash
pnpm run quality:release:nix
git diff --exit-code -- flake.lock
pnpm --filter @fressh/mobile exec tsx --test test/integration/run-release-quality.test.ts
```

Record real Android evidence later only on the authorized dedicated runner.

- [ ] **Step 5: Audit policy coverage**

Map every approved policy requirement to a passing test, script, workflow,
baseline rule, suite split, or release step. Add a failing test before fixing a
gap. Confirm branch protection requires aggregate `Portable Quality`.

- [ ] **Step 6: Run thermo-nuclear review**

Invoke `$thermo-nuclear-code-quality-review` on complete diff. Inspect quality
tool abstraction growth, analyzer failures, baseline fungibility, rename/path
bypasses, schema brittleness, hidden platform dependencies, replacement giant
fixtures/tests, duplicate setup, CI mutation, release/device safety, and
generated noise. Resolve blockers via new red-green cycles; repeat Steps 1-4.

- [ ] **Step 7: Confirm branch state**

```bash
git status --short
git log --oneline --decorate -23
```

Expected: intentional changes only, independently reviewable commits, no
generated/release artifact staged, all required evidence in handoff.
