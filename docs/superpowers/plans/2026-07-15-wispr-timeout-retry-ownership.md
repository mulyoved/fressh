# Wispr Timeout Retry Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep unresolved native Wispr transactions non-retryable without
overwriting their exact request identity, and split the lifecycle tests into
focused protocol suites.

**Architecture:** `WisprStartProtocol` remains the owner of acquisition and
lease state and exposes one read-only outstanding-transaction signal. The shell
core composes that signal with automation state for snapshot and admission.
Existing late-settlement and close-coordinator paths reconcile the preserved
request identity. Lifecycle tests move by ownership protocol after the new race
is green.

**Tech Stack:** TypeScript, Node test runner, Jest, fake timers, pnpm, Prettier,
ESLint.

## Global Constraints

- Preserve every Task 4 wave-1 lifecycle behavior and exact-lease settlement.
- Do not replace the protocol with a transaction-state rewrite.
- Do not increment request generation or invoke native status/start work for a
  refused retry.
- Keep shared harness code in `shell-wispr-controller-test-support.ts`.
- Do not use source-text assertions or an empty facade test file.

---

### Task 1: Timeout Retry Regression

**Files:**

- Modify:
  `apps/mobile/test/integration/shell-wispr-controller-lifecycle.test.ts`

**Interfaces:**

- Consumes: `createHarness`, `openReady`, `settled`, and the shared native
  authority.
- Produces: behavioral requirements for retry admission and exact late
  settlement.

- [ ] **Step 1: Write failing late-success and late-rejection tests**

Add a matrix that starts request A, advances 750 ms through its uncertain
timeout, and then calls `openTextEditor()` before A settles:

```ts
assert.equal(harness.core.getSnapshot().busy, true);
assert.deepEqual(await harness.core.openTextEditor(), {
	status: 'superseded',
});
assert.equal(harness.statusRequests.length, 1);
assert.equal(harness.taps.length, 1);
```

For late success, resolve A, verify recording, close, settle exactly one
compensating close, and prove a successor starts only afterward. For late
rejection, reject A, verify `busy` becomes false, then retry and prove the new
request acquires and starts normally. In both cases assert native-active state
and acquisition outcome so no lease is stranded.

- [ ] **Step 2: Add a failing auto-start re-enable test**

After A times out, call `setAutoStart(false)` and `setAutoStart(true)`. Assert
no new tap or request identity is created, then late-settle A and exercise the
same release/cleanup behavior.

- [ ] **Step 3: Run focused RED tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test \
  test/integration/shell-wispr-controller-lifecycle.test.ts
```

Expected: new tests fail because `busy` is false and retry admits replacement
work; all pre-existing cases remain green.

---

### Task 2: Outstanding Native Transaction Admission

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/wispr-start-protocol.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/wispr-core.ts`

**Interfaces:**

- Produces: `WisprStartProtocol.hasOutstandingNativeTransaction(): boolean`.
- Consumes: existing `controlAcquisition` and `controlLease` ownership records.

- [ ] **Step 1: Expose the authoritative ownership query**

Add the protocol interface method and implementation:

```ts
hasOutstandingNativeTransaction: () =>
	controlAcquisition != null || controlLease != null,
```

- [ ] **Step 2: Compose snapshot busy state**

Use one core helper:

```ts
const nativeTransactionBusy = () =>
	startProtocol.hasOutstandingNativeTransaction();
const automationBusy = () =>
	isWisprAutomationBusy(automation) || nativeTransactionBusy();
```

Because snapshot construction precedes protocol initialization, declare the
protocol-backed query through a safely initialized closure or move snapshot
construction after protocol creation without changing publisher semantics.

- [ ] **Step 3: Guard every retry entry point**

Replace the automation-only checks in `openTextEditor()` and
`setAutoStart(true)` with the composed busy helper. A refused opener returns
`superseded`; auto-start re-enable publishes the toggle but does not call
`beginRequest()` or `start()`.

- [ ] **Step 4: Run focused GREEN tests**

Run the lifecycle test file and the controller contract test. Expected: all
tests pass, including both late-settlement branches and auto-start re-enable.

---

### Task 3: Focused Lifecycle Test Files

**Files:**

- Delete:
  `apps/mobile/test/integration/shell-wispr-controller-lifecycle.test.ts`
- Create:
  `apps/mobile/test/integration/shell-wispr-controller-acquisition.test.ts`
- Create:
  `apps/mobile/test/integration/shell-wispr-controller-issued-cleanup.test.ts`
- Create:
  `apps/mobile/test/integration/shell-wispr-controller-authority.test.ts`
- Modify: `apps/mobile/test/integration/shell-wispr-controller-test-support.ts`

**Interfaces:**

- Shared support additionally exports `shareNativeControl` and the reusable
  blocked-cleanup failure value if more than one focused file needs them.
- Each new test file imports production behavior directly; there is no facade
  file.

- [ ] **Step 1: Move acquisition and supersession cases**

Move pending status, retry delay, fallback, screen-prime, tap-runner, and
request replacement/admission tests into the acquisition file.

- [ ] **Step 2: Move issued cleanup cases**

Move close coordinator, close/invalidate/dispose after issued start, cleanup
deadline, scheduling failure, and late-result cases into the issued-cleanup
file.

- [ ] **Step 3: Move authority and successor cases**

Move process-wide waiting, newest-waiter replacement, successor acquisition,
close failure, bounded poison, and late inertness cases into the authority file.

- [ ] **Step 4: Delete the monolith and verify structure**

Run `wc -l` on all three files. None may be an empty importer or exceed the old
1,006-line surface; test names from the original suite must appear exactly once.

- [ ] **Step 5: Run the exact Task 4 Node lane**

Update the command to include all three focused files. Expected: prior cases
plus the new wave-2 cases pass with no skips or duplicates.

---

### Task 4: Evidence and Final Verification

**Files:**

- Create: `.superpowers/ce1/issue141-stage2-ce1/task-4/wave-2/fix-report.md`
- Modify: `.superpowers/sdd/task-4-report.md`
- Modify: `docs/run/issue-141-stage-2-reconciliation-evidence.md`

**Interfaces:**

- Produces: CE1-T4-006 and CE1-T4-007 requirement-to-test mapping and exact
  RED/GREEN evidence.

- [ ] **Step 1: Record RED and GREEN results**

Include the focused failing assertions, exact counts, the admission invariant,
late success/rejection results, and the real test-file split.

- [ ] **Step 2: Run final gates**

Run exact Task 4 Node/Jest, `pnpm run test:integration`,
`pnpm run test:components`, `pnpm run fmt:check`, `pnpm run typecheck`, scoped
ESLint, and `git diff --check`.

- [ ] **Step 3: Review requirements and commit**

Confirm both CE1 IDs map to behavioral evidence, force-add ignored
`.superpowers` reports, and commit with an imperative Task 4 subject.
