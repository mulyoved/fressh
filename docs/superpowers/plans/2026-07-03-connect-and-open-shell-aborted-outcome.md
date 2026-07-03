# Connect And Open Shell Aborted Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `connectAndOpenShell` return an explicit aborted result when it cleans up a late successful shell after abort.

**Architecture:** Keep cleanup ownership in `connectAndOpenShell` when `cleanupOnAbort` is true, and make that helper return `{ status: 'aborted', reason }` after cleanup. Widen saved-entry result mapping so auto-connect and connection-attempt lifecycle treat aborted as aborted instead of casting it to tmux failure.

**Tech Stack:** TypeScript, Expo React Native mobile app, Node `node:test` integration tests, pnpm workspace scripts.

---

## File Structure

- Modify `apps/mobile/src/lib/connect-and-open-shell.ts`
  - Add the `aborted` branch to `ConnectAndOpenShellResult`.
  - Add a small helper to read the abort reason from the active shell signal, parent signal, or generic fallback error.
  - Return `aborted` after `cleanupAbortedConnection()` instead of returning a cleaned-up `connected` result.

- Modify `apps/mobile/src/lib/auto-connect-saved-entry.ts`
  - Add `aborted` to `SavedEntryConnectResult`.
  - Add `aborted` to `SavedEntryRecoveryOutcome`.
  - Make `attemptSavedEntryWithTailscaleRecovery()` return aborted immediately when `connectSavedEntry()` returns aborted.

- Modify `apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts`
  - Keep connected cleanup behavior unchanged.
  - Return `aborted` unchanged from `toAutoConnectSavedEntryResult()`.
  - Keep tmux attach failures distinct from aborted.

- Modify `apps/mobile/src/lib/connection-attempt-lifecycle.ts`
  - Map saved-entry aborted results to the existing `ConnectionAttemptOutcome` aborted shape.
  - Normalize unknown abort reasons to known `ConnectionRunAbortReason` values at this boundary.

- Modify `apps/mobile/src/lib/connection-diagnostic-runner.ts`
  - Add an `aborted` branch for the direct saved-entry recovery switch.
  - Preserve existing public diagnostic statuses by throwing the abort reason into the current diagnostic failure handling path.

- Modify `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
  - Update late-success abort tests to expect `aborted`.
  - Assert no navigation, one shell close, one SSH disconnect, and reason propagation.
  - Preserve the `cleanupOnAbort: false` connected behavior.
  - Assert `toAutoConnectSavedEntryResult()` preserves aborted instead of casting it to tmux failure.

- Modify `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
  - Add an aborted saved-entry recovery test and harness branch.

- Modify `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
  - Add a lifecycle test proving saved-entry aborted maps to the existing connection-attempt aborted outcome.

## Task 1: Write Failing Tests For Public Helper And Adapter

**Files:**
- Modify: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts:193-446`
- Test: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Update the shell operation abort late-success test**

In `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`, replace the body of `connectAndOpenShell cleans up shell operation abort after late shell success` with:

```ts
void test('connectAndOpenShell cleans up shell operation abort after late shell success', async () => {
	const shellAbortController = new AbortController();
	const abortReason = new Error('shell operation aborted after start');
	let closeCalls = 0;
	let disconnectCalls = 0;
	let navigated = false;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			shell: shellAbortController.signal,
		},
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					shellAbortController.abort(abortReason);
					return {
						channelId: 7,
						close: async () => {
							closeCalls += 1;
						},
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			navigated = true;
		},
	});

	assert.equal(result.status, 'aborted');
	assert.equal(result.reason, abortReason);
	assert.equal(navigated, false);
	assert.equal(closeCalls, 1);
	assert.equal(disconnectCalls, 1);
});
```

- [ ] **Step 2: Update the parent abort late-success test**

In the same file, replace the body of `connectAndOpenShell cleans up an aborted late success` with:

```ts
void test('connectAndOpenShell cleans up an aborted late success', async () => {
	const abortController = new AbortController();
	const abortReason = new Error('parent connection attempt aborted');
	let closeCalls = 0;
	let disconnectCalls = 0;
	let navigated = false;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		abortSignal: abortController.signal,
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					abortController.abort(abortReason);
					return {
						channelId: 7,
						close: async () => {
							closeCalls += 1;
						},
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			navigated = true;
		},
	});

	assert.equal(result.status, 'aborted');
	assert.equal(result.reason, abortReason);
	assert.equal(navigated, false);
	assert.equal(closeCalls, 1);
	assert.equal(disconnectCalls, 1);
});
```

- [ ] **Step 3: Add a fallback reason test**

Add this test immediately after `connectAndOpenShell cleans up an aborted late success`:

```ts
void test('connectAndOpenShell returns generic abort reason when signal has no reason', async () => {
	const abortSignal = {
		aborted: false,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true,
		onabort: null,
		reason: undefined,
		throwIfAborted: () => {},
	} as AbortSignal;
	let closeCalls = 0;
	let disconnectCalls = 0;
	let navigated = false;

	const result = await connectAndOpenShell({
		connectionDetails,
		resolvedSecurity: { type: 'key', privateKey: 'secret' },
		operationSignals: {
			shell: abortSignal,
		},
		connect: async () =>
			({
				connectionId: 'conn-1',
				disconnect: async () => {
					disconnectCalls += 1;
				},
				startShell: async () => {
					Object.assign(abortSignal, { aborted: true });
					return {
						channelId: 7,
						close: async () => {
							closeCalls += 1;
						},
					};
				},
			}) as never,
		saveConnection: async () => {},
		navigate: () => {
			navigated = true;
		},
	});

	assert.equal(result.status, 'aborted');
	assert.ok(result.reason instanceof Error);
	assert.equal(result.reason.message, 'Connection attempt aborted');
	assert.equal(navigated, false);
	assert.equal(closeCalls, 1);
	assert.equal(disconnectCalls, 1);
});
```

- [ ] **Step 4: Extend the adapter test for aborted results**

In `auto-connect saved-entry result exposes cleanup for connected results only`, add this block after the existing tmux failure assertions:

```ts
const abortReason = new Error('auto-connect aborted');
const aborted = toAutoConnectSavedEntryResult({
	status: 'aborted',
	reason: abortReason,
});
assert.equal(aborted.status, 'aborted');
assert.equal(aborted.reason, abortReason);
assert.equal('cleanup' in aborted, false);
```

- [ ] **Step 5: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected before implementation: FAIL. The late-success tests still receive `status: 'connected'`, and the adapter test cannot pass until `ConnectAndOpenShellResult` and `SavedEntryConnectResult` include `aborted`.

## Task 2: Implement The Public Aborted Outcome

**Files:**
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts:30-32`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts:146-150`
- Modify: `apps/mobile/src/lib/connect-and-open-shell.ts:203-205`
- Test: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Add the aborted result type**

In `apps/mobile/src/lib/connect-and-open-shell.ts`, replace the `ConnectAndOpenShellResult` type with:

```ts
export type ConnectAndOpenShellResult =
	| Omit<ConnectedSshShellLifecycleResult, 'storedConnectionId'>
	| TmuxAttachFailedSshShellLifecycleResult
	| {
			status: 'aborted';
			reason: unknown;
	  };
```

- [ ] **Step 2: Add an abort reason helper**

Immediately after `resolveSecurityFromDetails()`, add:

```ts
function getConnectionAbortReason(
	activeShellAbortSignal: AbortSignal | undefined,
	abortSignal: AbortSignal | undefined,
) {
	return (
		activeShellAbortSignal?.reason ??
		abortSignal?.reason ??
		new Error('Connection attempt aborted')
	);
}
```

- [ ] **Step 3: Return aborted after helper-owned cleanup**

In `connectAndOpenShell()`, replace:

```ts
if (cleanupOnAbort && isShellLifecycleAborted()) {
	await cleanupAbortedConnection(result, abortSignalTimeoutMs);
	return result;
}
```

with:

```ts
if (cleanupOnAbort && isShellLifecycleAborted()) {
	await cleanupAbortedConnection(result, abortSignalTimeoutMs);
	return {
		status: 'aborted',
		reason: getConnectionAbortReason(activeShellAbortSignal, abortSignal),
	};
}
```

- [ ] **Step 4: Run the focused helper test**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts
```

Expected after this task: the public helper late-success tests pass. Type errors may still exist in saved-entry mapping until Task 3 is complete.

- [ ] **Step 5: Commit the public helper change**

Run:

```bash
git add apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts
git commit -m "Expose aborted connect shell outcome"
```

## Task 3: Preserve Aborted Through Saved-Entry Mapping

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect-saved-entry.ts:10-62`
- Modify: `apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts:1-37`
- Modify: `apps/mobile/src/lib/connection-attempt-lifecycle.ts:159-183`
- Modify: `apps/mobile/src/lib/connection-attempt-lifecycle.ts:376-383`
- Modify: `apps/mobile/src/lib/connection-diagnostic-runner.ts:225-253`
- Modify: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts:19-110`
- Modify: `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts:104-148`
- Test: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Test: `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`
- Test: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`

- [ ] **Step 1: Add an aborted saved-entry result test**

In `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`, add this helper after `tmuxAttachFailedResult()`:

```ts
function abortedResult(reason: unknown = 'caller-aborted'): SavedEntryConnectResult {
	return {
		status: 'aborted',
		reason,
	};
}
```

In the `harness()` switch, add this branch after `case 'tmuxAttachFailed':`:

```ts
case 'aborted':
	return { connected: false, aborted: true, reason: result.result.reason };
```

Add this test after `saved-entry recovery helper returns connected outcome`:

```ts
void test('saved-entry recovery helper returns aborted outcome without recovery', async () => {
	let connectCount = 0;
	let recoveryCount = 0;
	const abortReason = new Error('saved-entry connect aborted');
	const context = harness({
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => {
				recoveryCount += 1;
				return {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				};
			},
		},
		connectSavedEntry: async () => {
			connectCount += 1;
			return abortedResult(abortReason);
		},
	});

	const result = await context.attempt();

	assert.deepEqual(result, {
		connected: false,
		aborted: true,
		reason: abortReason,
	});
	assert.equal(connectCount, 1);
	assert.equal(recoveryCount, 0);
	assert.equal(context.clearAttentionCount, 0);
	assert.deepEqual(context.attention, []);
});
```

- [ ] **Step 2: Add a direct saved-entry recovery outcome test**

In `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`, add this test after `saved-entry recovery helper returns aborted outcome without recovery`:

```ts
void test('saved-entry recovery helper exposes aborted result directly', async () => {
	const abortReason = new Error('saved-entry direct abort');

	const result = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: 'android',
		recovery: {
			ensureReady: async () => ({
				kind: 'ready',
				attempted: true,
				available: true,
			}),
			recoverAfterFailure: async () => {
				throw new Error('aborted result should not recover');
			},
		},
		connectSavedEntry: async () => abortedResult(abortReason),
	});

	assert.deepEqual(result, {
		status: 'aborted',
		result: {
			status: 'aborted',
			reason: abortReason,
		},
	});
});
```

- [ ] **Step 3: Add a connection-attempt lifecycle aborted mapping test**

In `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`, add this helper after `tmuxAttachFailedResult()`:

```ts
function abortedResult(reason: unknown = 'caller-aborted'): SavedEntryConnectResult {
	return {
		status: 'aborted',
		reason,
	};
}
```

Add this test after `saved-entry lifecycle returns connected outcome and passes initial phase`:

```ts
void test('saved-entry lifecycle maps saved-entry aborted result', async () => {
	const { runContext } = runHarness();
	const abortReason = new Error('connect helper aborted after cleanup');

	const outcome = await runSavedEntryConnectionAttempt({
		platformOS: 'android',
		runContext,
		recovery: readyRecovery(),
		connectSavedEntry: async () => abortedResult(abortReason),
		cleanupConnected: async () => {
			throw new Error('aborted saved-entry result should not clean up again');
		},
	});

	assert.deepEqual(outcome, {
		status: 'aborted',
		reason: 'caller-aborted',
	});
});
```

- [ ] **Step 4: Run the new mapping tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/auto-connect-saved-entry.test.ts test/integration/connection-attempt-lifecycle.test.ts
```

Expected before implementation: FAIL. `SavedEntryConnectResult` and `SavedEntryRecoveryOutcome` do not yet include `aborted`, and lifecycle mapping does not yet handle it.

- [ ] **Step 5: Widen saved-entry types and recovery mapping**

In `apps/mobile/src/lib/auto-connect-saved-entry.ts`, replace the `SavedEntryConnectResult` type with:

```ts
export type SavedEntryConnectResult =
	| {
			status: 'connected';
			connectionId: string;
			channelId: number;
			cleanup?: (opts?: { signal?: AbortSignal }) => Promise<void>;
	  }
	| {
			status: 'tmux_attach_failed';
			connectionId: string;
			tmuxAttachFailureReason: string | null;
			tmuxSessionName: string;
			storedConnectionId: string;
	  }
	| {
			status: 'aborted';
			reason: unknown;
	  };
```

After `TmuxAttachFailedResult`, add:

```ts
export type AbortedSavedEntryConnectResult = Extract<
	SavedEntryConnectResult,
	{ status: 'aborted' }
>;
```

In `SavedEntryRecoveryOutcome`, add this union member after `tmuxAttachFailed`:

```ts
| { status: 'aborted'; result: AbortedSavedEntryConnectResult }
```

In `handleConnectResult`, replace the current non-connected check with:

```ts
if (result.status === 'tmux_attach_failed') {
	return { status: 'tmuxAttachFailed', result };
}
if (result.status === 'aborted') {
	return { status: 'aborted', result };
}

return { status: 'connected', result };
```

- [ ] **Step 6: Preserve aborted in the auto-connect adapter**

In `apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts`, replace the imports with:

```ts
import {
	type SavedEntryConnectResult,
	type TmuxAttachFailedResult,
} from './auto-connect-saved-entry';
import { type ConnectAndOpenShellResult } from './connect-and-open-shell';
```

Keep those imports if they already match after formatting. Replace `toAutoConnectSavedEntryResult()` with:

```ts
export function toAutoConnectSavedEntryResult(
	result: ConnectAndOpenShellResult,
): SavedEntryConnectResult {
	if (result.status === 'tmux_attach_failed') {
		return result as TmuxAttachFailedResult;
	}
	if (result.status === 'aborted') {
		return result;
	}
	return {
		status: 'connected',
		connectionId: result.connectionId,
		channelId: result.channelId,
		cleanup: async (opts?: { signal?: AbortSignal }) => {
			await cleanupAutoConnectSavedEntryResult(result, opts);
		},
	};
}
```

- [ ] **Step 7: Map saved-entry aborted in connection-attempt lifecycle**

In `apps/mobile/src/lib/connection-attempt-lifecycle.ts`, add this helper before `mapSavedEntryResult()`:

```ts
function normalizeSavedEntryAbortReason(
	reason: unknown,
): Exclude<ConnectionRunAbortReason, 'timeout'> {
	switch (reason) {
		case 'caller-aborted':
		case 'stale-run':
		case 'stopped':
		case 'replaced':
		case 'unmounted':
			return reason;
		default:
			return 'caller-aborted';
	}
}
```

Replace the `mapSavedEntryResult()` return type with:

```ts
): Extract<
	ConnectionAttemptOutcome,
	{ status: 'connected' | 'tmuxAttachFailed' | 'aborted' }
> {
```

Inside `mapSavedEntryResult()`, add this branch after the tmux branch:

```ts
if (result.status === 'aborted') {
	return {
		status: 'aborted',
		reason: normalizeSavedEntryAbortReason(result.reason),
	};
}
```

In the `switch (savedEntryOutcome.status)` inside `runSavedEntryConnectionAttempt()`, add this case after `case 'tmuxAttachFailed':`:

```ts
case 'aborted':
	return mapSavedEntryResult(savedEntryOutcome.result);
```

- [ ] **Step 8: Preserve manual diagnostic public statuses**

In `apps/mobile/src/lib/connection-diagnostic-runner.ts`, add this case after `case 'tmuxAttachFailed':` in the `switch (result.status)` inside `runManualConnectionDiagnosticAttempt()`:

```ts
case 'aborted':
	throw result.result.reason instanceof Error
		? result.result.reason
		: new Error('Saved-entry connection aborted');
```

This keeps the manual diagnostic public statuses unchanged. The surrounding `catch` path records a diagnostic failure and finishes with the existing `failed` status.

- [ ] **Step 9: Run focused integration tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/connect-and-open-shell-diagnostics.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/connection-attempt-lifecycle.test.ts
```

Expected after implementation: PASS. The helper returns aborted after cleanup, saved-entry recovery returns aborted without recovery, and the lifecycle maps unknown abort reasons to `caller-aborted`.

- [ ] **Step 10: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 11: Commit saved-entry mapping**

Run:

```bash
git add apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts apps/mobile/src/lib/connection-attempt-lifecycle.ts apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts apps/mobile/test/integration/connection-attempt-lifecycle.test.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts
git commit -m "Preserve aborted saved-entry connect results"
```

## Task 4: Final Verification

**Files:**
- Verify: `apps/mobile/src/lib/connect-and-open-shell.ts`
- Verify: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Verify: `apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts`
- Verify: `apps/mobile/src/lib/connection-attempt-lifecycle.ts`
- Verify: `apps/mobile/src/lib/connection-diagnostic-runner.ts`
- Verify: `apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts`
- Verify: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Verify: `apps/mobile/test/integration/connection-attempt-lifecycle.test.ts`

- [ ] **Step 1: Run the mobile integration suite**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS for all integration tests.

- [ ] **Step 2: Run mobile lint check**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS with no ESLint errors.

- [ ] **Step 3: Run mobile typecheck again**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes. If verification formatting or lint fixes changed files, commit them with:

```bash
git add apps/mobile/src/lib/connect-and-open-shell.ts apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/src/lib/auto-connect-saved-entry-cleanup.ts apps/mobile/src/lib/connection-attempt-lifecycle.ts apps/mobile/src/lib/connection-diagnostic-runner.ts apps/mobile/test/integration/connect-and-open-shell-diagnostics.test.ts apps/mobile/test/integration/auto-connect-saved-entry.test.ts apps/mobile/test/integration/connection-attempt-lifecycle.test.ts
git commit -m "Verify aborted connect shell outcome"
```
