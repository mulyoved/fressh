# Tailscale Recovery Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Android Tailscale recovery behavior stable while moving recovery outcomes, saved-entry retry logic, reconnect scheduling, and manual reset orchestration out of `AutoConnectManager`.

**Architecture:** Replace optional-boolean recovery objects with discriminated result unions, move Tailscale-aware SSH retry behavior into a focused saved-entry helper, and move reconnect loop state into a dedicated controller. `AutoConnectManager` remains the lifecycle wiring component: it chooses active shells/connections, delegates saved-entry recovery and reconnect scheduling, and renders the recovery banner.

**Tech Stack:** React Native, Expo Router, Zustand, TypeScript, Node `node:test`, Expo config plugins, Android/Kotlin native module, pnpm/Turbo.

---

## File Structure

- Modify `apps/mobile/src/lib/tailscale-recovery-core.ts`
  - Owns platform gating, SSH network-error classification, cooldowns, and the typed Tailscale recovery result model.
- Modify `apps/mobile/src/lib/tailscale-recovery.ts`
  - Returns discriminated union outcomes from `ensureReady`, `recoverAfterFailure`, and `reset`.
- Create `apps/mobile/src/lib/auto-connect-saved-entry.ts`
  - Owns Tailscale-aware saved-entry connection attempts, retry-after-recovery behavior, and attention-message mapping.
- Create `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
  - Owns reconnect timer state, replacement reconnect, stale-loop cancellation, reset blocking, and retry window limits.
- Create `apps/mobile/src/lib/tailscale-recovery-actions.ts`
  - Owns manual banner actions: open Tailscale, retry, and reset-then-reconnect.
- Modify `apps/mobile/src/lib/auto-connect-recovery.ts`
  - Shrink to exported user-facing recovery messages only, or delete it if all exports move to the new focused modules.
- Modify `apps/mobile/src/lib/auto-connect.tsx`
  - Remove direct Tailscale branching, direct reset transaction logic, and reconnect-loop internals. Wire the new helpers/controllers into existing lifecycle effects.
- Modify tests:
  - `apps/mobile/test/integration/tailscale-recovery-core.test.ts`
  - `apps/mobile/test/integration/tailscale-recovery.test.ts`
  - `apps/mobile/test/integration/auto-connect.test.ts`
- Create tests:
  - `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
  - `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
  - `apps/mobile/test/integration/tailscale-recovery-actions.test.ts`

## Task 1: Typed Tailscale Recovery Outcomes

**Files:**
- Modify: `apps/mobile/src/lib/tailscale-recovery-core.ts`
- Modify: `apps/mobile/src/lib/tailscale-recovery.ts`
- Modify: `apps/mobile/test/integration/tailscale-recovery-core.test.ts`
- Modify: `apps/mobile/test/integration/tailscale-recovery.test.ts`

- [ ] **Step 1: Add failing tests for explicit result kinds**

Append these tests to `apps/mobile/test/integration/tailscale-recovery-core.test.ts`:

```ts
void test('Tailscale recovery attention messages come from explicit outcome kinds', () => {
	assert.equal(
		getTailscaleRecoveryAttentionMessage({
			kind: 'unavailable',
			available: false,
			attempted: false,
		}),
		'Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.',
	);
	assert.equal(
		getTailscaleRecoveryAttentionMessage({
			kind: 'cooldown',
			available: true,
			attempted: false,
		}),
		'Fressh could not reach the SSH host through Tailscale.',
	);
	assert.equal(
		getTailscaleRecoveryAttentionMessage({
			kind: 'failed',
			available: true,
			attempted: false,
		}),
		'Tailscale reset failed. Open Tailscale, then retry Fressh.',
	);
	assert.equal(
		getTailscaleRecoveryAttentionMessage({
			kind: 'ready',
			available: true,
			attempted: true,
		}),
		null,
	);
});

void test('manual reset decisions come from explicit reset result kinds', () => {
	assert.equal(
		getTailscaleManualResetAttentionMessage({
			kind: 'failed',
			attempted: false,
		}),
		'Tailscale reset failed. Open Tailscale, then retry Fressh.',
	);
	assert.equal(
		getTailscaleManualResetAttentionMessage({
			kind: 'notStarted',
			attempted: false,
		}),
		'Tailscale reset did not start. Open Tailscale, then retry Fressh.',
	);
	assert.equal(
		getTailscaleManualResetAttentionMessage({
			kind: 'reset',
			attempted: true,
		}),
		null,
	);
});
```

Update existing `apps/mobile/test/integration/tailscale-recovery.test.ts` assertions so they expect `kind` values. Replace representative assertions like this:

```ts
assert.deepEqual(await controller.ensureReady(), {
	kind: 'unsupported',
	attempted: false,
	available: false,
});

assert.deepEqual(await controller.ensureReady(), {
	kind: 'ready',
	attempted: true,
	available: true,
});

assert.deepEqual(await controller.ensureReady(), {
	kind: 'cooldown',
	attempted: false,
	available: true,
});

assert.deepEqual(
	await controller.recoverAfterFailure(new Error('No route to host')),
	{
		kind: 'recovered',
		attempted: true,
		available: true,
		networkLikeFailure: true,
	},
);

assert.deepEqual(await controller.reset(), {
	kind: 'reset',
	attempted: true,
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-core.test.ts test/integration/tailscale-recovery.test.ts
```

Expected: fail with missing exports `getTailscaleRecoveryAttentionMessage` and `getTailscaleManualResetAttentionMessage`, plus deep-equality failures because current results do not include `kind`.

- [ ] **Step 3: Add typed outcomes and attention-message helpers**

Update `apps/mobile/src/lib/tailscale-recovery-core.ts` with these exports after the delay constants:

```ts
export const TAILSCALE_UNAVAILABLE_MESSAGE =
	'Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.';
export const TAILSCALE_REACHABILITY_MESSAGE =
	'Fressh could not reach the SSH host through Tailscale.';
export const TAILSCALE_RESTART_FAILED_MESSAGE =
	'Fressh could not reach the SSH host after restarting Tailscale.';
export const TAILSCALE_RESET_FAILED_MESSAGE =
	'Tailscale reset failed. Open Tailscale, then retry Fressh.';
export const TAILSCALE_RESET_NOT_STARTED_MESSAGE =
	'Tailscale reset did not start. Open Tailscale, then retry Fressh.';

export type TailscaleReadyResult =
	| { kind: 'unsupported'; attempted: false; available: false }
	| { kind: 'unavailable'; attempted: false; available: false }
	| { kind: 'ready'; attempted: true; available: true }
	| { kind: 'cooldown'; attempted: false; available: true }
	| { kind: 'failed'; attempted: boolean; available: true };

export type TailscaleRecoverAfterFailureResult =
	| {
			kind: 'nonNetworkFailure';
			attempted: false;
			networkLikeFailure: false;
			available: boolean;
	  }
	| {
			kind: 'unsupported';
			attempted: false;
			networkLikeFailure: true;
			available: false;
	  }
	| {
			kind: 'unavailable';
			attempted: false;
			networkLikeFailure: true;
			available: false;
	  }
	| {
			kind: 'cooldown';
			attempted: false;
			networkLikeFailure: true;
			available: true;
	  }
	| {
			kind: 'recovered';
			attempted: true;
			networkLikeFailure: true;
			available: true;
	  }
	| {
			kind: 'failed';
			attempted: boolean;
			networkLikeFailure: true;
			available: true;
	  };

export type TailscaleManualResetResult =
	| { kind: 'unsupported'; attempted: false }
	| { kind: 'notStarted'; attempted: false }
	| { kind: 'reset'; attempted: true }
	| { kind: 'failed'; attempted: boolean };

export function getTailscaleRecoveryAttentionMessage(
	result: TailscaleReadyResult | TailscaleRecoverAfterFailureResult,
) {
	switch (result.kind) {
		case 'unavailable':
			return TAILSCALE_UNAVAILABLE_MESSAGE;
		case 'cooldown':
			return TAILSCALE_REACHABILITY_MESSAGE;
		case 'failed':
			return TAILSCALE_RESET_FAILED_MESSAGE;
		case 'unsupported':
		case 'ready':
		case 'recovered':
		case 'nonNetworkFailure':
			return null;
	}
}

export function getTailscaleManualResetAttentionMessage(
	result: TailscaleManualResetResult,
) {
	switch (result.kind) {
		case 'failed':
			return TAILSCALE_RESET_FAILED_MESSAGE;
		case 'notStarted':
			return TAILSCALE_RESET_NOT_STARTED_MESSAGE;
		case 'unsupported':
		case 'reset':
			return null;
	}
}
```

- [ ] **Step 4: Return the typed outcomes from the recovery controller**

Update `apps/mobile/src/lib/tailscale-recovery.ts` imports:

```ts
import {
	DEFAULT_TAILSCALE_RESET_DELAY_MS,
	DEFAULT_TAILSCALE_SETTLE_DELAY_MS,
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
	type TailscaleManualResetResult,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';
```

Replace `ensureReady`, `recoverAfterFailure`, and `reset` in `createTailscaleRecoveryController` with:

```ts
async ensureReady(): Promise<TailscaleReadyResult> {
	if (!isSupported()) {
		return { kind: 'unsupported', attempted: false, available: false };
	}

	const available = await checkAvailability();
	if (!available) {
		return { kind: 'unavailable', attempted: false, available: false };
	}

	const result = await connectWithCooldown();
	if (result.failed === true) {
		return {
			kind: 'failed',
			attempted: result.attempted,
			available: true,
		};
	}
	if (!result.attempted) {
		return { kind: 'cooldown', attempted: false, available: true };
	}
	return { kind: 'ready', attempted: true, available: true };
},

async recoverAfterFailure(
	error: unknown,
): Promise<TailscaleRecoverAfterFailureResult> {
	const networkLikeFailure = isNetworkLikeSshError(error);
	if (!networkLikeFailure) {
		const available = isSupported() ? await checkAvailability() : false;
		return {
			kind: 'nonNetworkFailure',
			attempted: false,
			networkLikeFailure,
			available,
		};
	}
	if (!isSupported()) {
		return {
			kind: 'unsupported',
			attempted: false,
			networkLikeFailure,
			available: false,
		};
	}

	const available = await checkAvailability();
	if (!available) {
		return {
			kind: 'unavailable',
			attempted: false,
			networkLikeFailure,
			available: false,
		};
	}

	const result = await connectWithCooldown();
	if (result.failed === true) {
		return {
			kind: 'failed',
			attempted: result.attempted,
			networkLikeFailure,
			available: true,
		};
	}
	if (!result.attempted) {
		return {
			kind: 'cooldown',
			attempted: false,
			networkLikeFailure,
			available: true,
		};
	}
	return {
		kind: 'recovered',
		attempted: true,
		networkLikeFailure,
		available: true,
	};
},

async reset(): Promise<TailscaleManualResetResult> {
	if (!isSupported()) {
		return { kind: 'unsupported', attempted: false };
	}

	const disconnectResult = await native.disconnect();
	if (disconnectResult.attempted) {
		await sleep(DEFAULT_TAILSCALE_RESET_DELAY_MS);
	}

	const connectResult = await connectWithTimeout();
	if (shouldRecordCooldown(connectResult)) {
		cooldown.recordAttempt(getNowMs());
	}
	if (connectResult.attempted) {
		await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
	}

	const attempted = disconnectResult.attempted || connectResult.attempted;
	if (disconnectResult.failed === true || connectResult.failed === true) {
		return { kind: 'failed', attempted };
	}
	if (!attempted) {
		return { kind: 'notStarted', attempted: false };
	}
	return { kind: 'reset', attempted: true };
},
```

Remove the old `createRecoveryResult` helper from `tailscale-recovery.ts`.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-core.test.ts test/integration/tailscale-recovery.test.ts
```

Expected: all tests in both files pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/mobile/src/lib/tailscale-recovery-core.ts apps/mobile/src/lib/tailscale-recovery.ts apps/mobile/test/integration/tailscale-recovery-core.test.ts apps/mobile/test/integration/tailscale-recovery.test.ts
git commit -m "Refine Tailscale recovery result model"
```

## Task 2: Extract Saved-Entry Tailscale Retry Flow

**Files:**
- Create: `apps/mobile/src/lib/auto-connect-saved-entry.ts`
- Create: `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`

- [ ] **Step 1: Write failing tests for the saved-entry helper**

Create `apps/mobile/test/integration/auto-connect-saved-entry.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryTailscaleRecovery,
} from '../../src/lib/auto-connect-saved-entry';
import type { ConnectAndOpenShellResult } from '../../src/lib/query-fns';

const connectedResult: ConnectAndOpenShellResult = {
	status: 'connected',
	connectionId: 'connection-1',
	channelId: 7,
	sshConnection: {} as ConnectAndOpenShellResult['sshConnection'],
	shellHandle: {} as ConnectAndOpenShellResult['shellHandle'],
};

function recoveryFixture(
	overrides: Partial<SavedEntryTailscaleRecovery> = {},
): SavedEntryTailscaleRecovery {
	return {
		ensureReady: async () => ({
			kind: 'ready',
			attempted: true,
			available: true,
		}),
		recoverAfterFailure: async () => ({
			kind: 'recovered',
			attempted: true,
			available: true,
			networkLikeFailure: true,
		}),
		...overrides,
	};
}

void test('saved-entry helper connects once when Tailscale is ready', async () => {
	const calls: string[] = [];
	const result = await attemptSavedEntryWithTailscaleRecovery({
		recovery: recoveryFixture(),
		connectSavedEntry: async () => {
			calls.push('connect');
			return connectedResult;
		},
		clearAttention: () => calls.push('clearAttention'),
		markAttention: (message) => calls.push(`attention:${message}`),
		logTmuxAttachFailure: () => calls.push('tmux'),
		logger: { warn: () => {} },
	});

	assert.deepEqual(result, { connected: true });
	assert.deepEqual(calls, ['connect', 'clearAttention']);
});

void test('saved-entry helper marks unavailable Tailscale before SSH connect', async () => {
	const calls: string[] = [];
	const result = await attemptSavedEntryWithTailscaleRecovery({
		recovery: recoveryFixture({
			ensureReady: async () => ({
				kind: 'unavailable',
				attempted: false,
				available: false,
			}),
		}),
		connectSavedEntry: async () => {
			calls.push('connect');
			return connectedResult;
		},
		clearAttention: () => calls.push('clearAttention'),
		markAttention: (message) => calls.push(`attention:${message}`),
		logTmuxAttachFailure: () => calls.push('tmux'),
		logger: { warn: () => {} },
	});

	assert.deepEqual(result, { connected: false });
	assert.deepEqual(calls, [
		'attention:Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.',
	]);
});

void test('saved-entry helper retries once after recovered network-like failure', async () => {
	const calls: string[] = [];
	const result = await attemptSavedEntryWithTailscaleRecovery({
		recovery: recoveryFixture(),
		connectSavedEntry: async () => {
			calls.push('connect');
			if (calls.length === 1) throw new Error('No route to host');
			return connectedResult;
		},
		clearAttention: () => calls.push('clearAttention'),
		markAttention: (message) => calls.push(`attention:${message}`),
		logTmuxAttachFailure: () => calls.push('tmux'),
		logger: { warn: () => {} },
	});

	assert.deepEqual(result, { connected: true });
	assert.deepEqual(calls, ['connect', 'connect', 'clearAttention']);
});

void test('saved-entry helper rethrows non-network failures', async () => {
	const error = new Error('Permission denied');
	await assert.rejects(
		attemptSavedEntryWithTailscaleRecovery({
			recovery: recoveryFixture({
				recoverAfterFailure: async () => ({
					kind: 'nonNetworkFailure',
					attempted: false,
					available: true,
					networkLikeFailure: false,
				}),
			}),
			connectSavedEntry: async () => {
				throw error;
			},
			clearAttention: () => {},
			markAttention: () => {},
			logTmuxAttachFailure: () => {},
			logger: { warn: () => {} },
		}),
		error,
	);
});

void test('saved-entry helper marks attention when retry fails after recovery', async () => {
	const calls: string[] = [];
	const warnings: unknown[][] = [];
	const result = await attemptSavedEntryWithTailscaleRecovery({
		recovery: recoveryFixture(),
		connectSavedEntry: async () => {
			calls.push('connect');
			throw new Error('No route to host');
		},
		clearAttention: () => calls.push('clearAttention'),
		markAttention: (message) => calls.push(`attention:${message}`),
		logTmuxAttachFailure: () => calls.push('tmux'),
		logger: { warn: (...args) => warnings.push(args) },
	});

	assert.deepEqual(result, { connected: false });
	assert.deepEqual(calls, [
		'connect',
		'connect',
		'attention:Fressh could not reach the SSH host after restarting Tailscale.',
	]);
	assert.equal(warnings[0]?.[0], 'Auto-connect failed after Tailscale recovery retry');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-saved-entry.test.ts
```

Expected: fail with `Cannot find module '../../src/lib/auto-connect-saved-entry'`.

- [ ] **Step 3: Implement the saved-entry helper**

Create `apps/mobile/src/lib/auto-connect-saved-entry.ts`:

```ts
import type { ConnectAndOpenShellResult } from './query-fns';
import {
	TAILSCALE_REACHABILITY_MESSAGE,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	getTailscaleRecoveryAttentionMessage,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

export type SavedEntryTailscaleRecovery = {
	ensureReady: () => Promise<TailscaleReadyResult>;
	recoverAfterFailure: (
		error: unknown,
	) => Promise<TailscaleRecoverAfterFailureResult>;
};

type SavedEntryLogger = {
	warn: (message: string, ...args: unknown[]) => void;
};

export async function attemptSavedEntryWithTailscaleRecovery(input: {
	recovery: SavedEntryTailscaleRecovery;
	connectSavedEntry: () => Promise<ConnectAndOpenShellResult>;
	clearAttention: () => void;
	markAttention: (message: string) => void;
	logTmuxAttachFailure: (
		result: Extract<ConnectAndOpenShellResult, { status: 'tmux_attach_failed' }>,
	) => void;
	logger: SavedEntryLogger;
}): Promise<{ connected: boolean }> {
	const readiness = await input.recovery.ensureReady();
	const readinessMessage = getTailscaleRecoveryAttentionMessage(readiness);
	if (readiness.kind === 'unavailable') {
		input.markAttention(readinessMessage ?? TAILSCALE_REACHABILITY_MESSAGE);
		return { connected: false };
	}

	const connectOnce = async () => {
		const result = await input.connectSavedEntry();
		if (result.status === 'tmux_attach_failed') {
			input.logTmuxAttachFailure(result);
			return false;
		}
		input.clearAttention();
		return true;
	};

	try {
		return { connected: await connectOnce() };
	} catch (error) {
		const recovery = await input.recovery.recoverAfterFailure(error);
		if (recovery.kind === 'nonNetworkFailure') {
			throw error;
		}

		if (recovery.kind !== 'recovered') {
			const message =
				recovery.kind === 'cooldown' && readiness.kind === 'ready'
					? TAILSCALE_REACHABILITY_MESSAGE
					: getTailscaleRecoveryAttentionMessage(recovery);
			if (message !== null) {
				input.markAttention(message);
			}
			return { connected: false };
		}

		try {
			return { connected: await connectOnce() };
		} catch (retryError) {
			input.markAttention(TAILSCALE_RESTART_FAILED_MESSAGE);
			input.logger.warn(
				'Auto-connect failed after Tailscale recovery retry',
				retryError,
			);
			return { connected: false };
		}
	}
}
```

- [ ] **Step 4: Wire `AutoConnectManager` to the helper**

In `apps/mobile/src/lib/auto-connect.tsx`, add:

```ts
import { attemptSavedEntryWithTailscaleRecovery } from './auto-connect-saved-entry';
```

Inside `attemptAutoConnect`, keep the existing active-shell and active-connection paths. Replace the saved-entry `ensureReady` / `connectSavedEntry` / retry `try` blocks with:

```ts
const connectSavedEntry = () =>
	connectAndOpenShell({
		connectionDetails: normalizedDetails,
		resolvedSecurity,
		connect,
		navigate: ({ connectionId, channelId }) => {
			navigateToShell(connectionId, channelId);
		},
	});
const logTmuxAttachFailure = (
	result: Extract<
		Awaited<ReturnType<typeof connectSavedEntry>>,
		{ status: 'tmux_attach_failed' }
	>,
) => {
	logger.info('Auto-connect tmux attach failed, will retry', {
		connectionId: result.connectionId,
		tmuxAttachFailureReason: result.tmuxAttachFailureReason,
		tmuxSessionName: result.tmuxSessionName,
	});
};

const result = await attemptSavedEntryWithTailscaleRecovery({
	recovery: tailscaleRecovery,
	connectSavedEntry,
	clearAttention: clearTailscaleAttention,
	markAttention: markTailscaleAttention,
	logTmuxAttachFailure,
	logger,
});
return result.connected;
```

Remove direct imports of `isTailscaleRecoverySupported` and `shouldMarkTailscaleRecoveryAttention` from `auto-connect.tsx`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect.test.ts test/integration/tailscale-recovery.test.ts test/integration/tailscale-recovery-core.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/mobile/src/lib/auto-connect-saved-entry.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/auto-connect-saved-entry.test.ts apps/mobile/test/integration/auto-connect.test.ts
git commit -m "Extract Tailscale saved-entry retry flow"
```

## Task 3: Extract Reconnect Scheduling Controller

**Files:**
- Create: `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
- Create: `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Modify: `apps/mobile/src/lib/auto-connect-recovery.ts`

- [ ] **Step 1: Write failing tests for reconnect controller behavior**

Create `apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoConnectReconnectController } from '../../src/lib/auto-connect-reconnect-controller';

function harness() {
	let nowMs = 1_000;
	let reconnecting = false;
	let nextTimerId = 1;
	const timers = new Map<number, () => void>();
	const events: string[] = [];

	const controller = createAutoConnectReconnectController({
		delaysMs: [10, 20],
		windowMs: 100,
		now: () => nowMs,
		setTimeout: (callback, _delayMs) => {
			const id = nextTimerId;
			nextTimerId += 1;
			timers.set(id, callback);
			return id;
		},
		clearTimeout: (id) => {
			timers.delete(id);
		},
		getSnapshot: () => ({
			isAutoConnecting: false,
			isReconnecting: reconnecting,
			resetInFlight: false,
			platformOS: 'android',
			appActive: true,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: false,
		}),
		setReconnecting: (next) => {
			reconnecting = next;
			events.push(`reconnecting:${String(next)}`);
		},
		attemptAutoConnect: async () => {
			events.push('attempt');
			return false;
		},
		logger: {
			info: (message) => events.push(`info:${message}`),
			warn: (message) => events.push(`warn:${message}`),
		},
	});

	return {
		controller,
		events,
		timers,
		advance(ms: number) {
			nowMs += ms;
		},
		fireNextTimer() {
			const [id, callback] = timers.entries().next().value as
				| [number, () => void]
				| undefined;
			if (id === undefined) return false;
			timers.delete(id);
			callback();
			return true;
		},
	};
}

void test('reconnect controller starts once and schedules retries', async () => {
	const state = harness();
	assert.equal(state.controller.start('shell-drop'), true);
	await Promise.resolve();
	assert.deepEqual(state.events.slice(0, 3), [
		'reconnecting:true',
		'info:Reconnect cycle started',
		'attempt',
	]);
	assert.equal(state.timers.size, 1);
});

void test('reconnect controller blocks duplicate starts', () => {
	const state = harness();
	assert.equal(state.controller.start('shell-drop'), true);
	assert.equal(state.controller.start('resume'), false);
});

void test('replacement reconnect stops the current loop first', () => {
	const state = harness();
	assert.equal(state.controller.start('shell-drop'), true);
	assert.equal(state.controller.replace('tailscale-retry-action'), true);
	assert.deepEqual(
		state.events.filter((event) => event.startsWith('reconnecting:')),
		['reconnecting:true', 'reconnecting:false', 'reconnecting:true'],
	);
});

void test('stopped stale reconnect loop cannot schedule another retry', async () => {
	const state = harness();
	assert.equal(state.controller.start('shell-drop'), true);
	state.controller.stop('manual-stop');
	await Promise.resolve();
	assert.equal(state.timers.size, 0);
});

void test('reconnect controller stops after retry window expires', async () => {
	const state = harness();
	assert.equal(state.controller.start('shell-drop'), true);
	await Promise.resolve();
	state.advance(101);
	state.fireNextTimer();
	await Promise.resolve();
	assert.equal(
		state.events.includes('warn:Reconnect timeout reached'),
		true,
	);
	assert.equal(state.controller.isRunning(), false);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts
```

Expected: fail with `Cannot find module '../../src/lib/auto-connect-reconnect-controller'`.

- [ ] **Step 3: Implement the reconnect controller**

Create `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`:

```ts
import {
	canAttemptBackgroundReconnect,
	shouldWaitForForegroundServiceCoverage,
} from './foreground-service-runtime';

type TimeoutId = ReturnType<typeof setTimeout>;

export type AutoConnectReconnectSnapshot = {
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	resetInFlight: boolean;
	platformOS: string;
	appActive: boolean;
	backgroundWorkAllowed: boolean;
	foregroundServiceRequired: boolean;
};

type AutoConnectReconnectLogger = {
	info: (message: string, meta?: unknown) => void;
	warn: (message: string, meta?: unknown) => void;
};

export function createAutoConnectReconnectController(input: {
	delaysMs: readonly number[];
	windowMs: number;
	now: () => number;
	setTimeout: (callback: () => void, delayMs: number) => TimeoutId;
	clearTimeout: (id: TimeoutId) => void;
	getSnapshot: () => AutoConnectReconnectSnapshot;
	setReconnecting: (next: boolean) => void;
	attemptAutoConnect: () => Promise<boolean>;
	logger: AutoConnectReconnectLogger;
}) {
	let timer: TimeoutId | null = null;
	let startedAtMs: number | null = null;
	let attemptIndex = 0;
	let running = false;
	let generation = 0;

	const clearTimer = () => {
		if (timer !== null) {
			input.clearTimeout(timer);
			timer = null;
		}
	};

	const isCurrent = (loopGeneration: number) =>
		running && generation === loopGeneration;

	const stop = (reason: string) => {
		clearTimer();
		generation += 1;
		running = false;
		startedAtMs = null;
		attemptIndex = 0;
		input.setReconnecting(false);
		input.logger.info('Reconnect cycle stopped', { reason });
	};

	const canStart = () => {
		const snapshot = input.getSnapshot();
		return (
			!running &&
			!snapshot.resetInFlight &&
			!snapshot.isReconnecting &&
			!snapshot.isAutoConnecting
		);
	};

	const startInternal = (reason: string) => {
		if (!canStart()) return false;
		running = true;
		generation += 1;
		const loopGeneration = generation;
		startedAtMs = input.now();
		attemptIndex = 0;
		input.setReconnecting(true);
		input.logger.info('Reconnect cycle started', { reason });

		const scheduleNext = () => {
			if (!isCurrent(loopGeneration)) return;
			const attempt = attemptIndex;
			attemptIndex += 1;
			const delayMs =
				input.delaysMs[Math.min(attempt, input.delaysMs.length - 1)] ??
				10_000;
			timer = input.setTimeout(() => {
				void attemptWithBackoff();
			}, delayMs);
		};

		const attemptWithBackoff = async () => {
			if (!isCurrent(loopGeneration)) return;
			const startedAt = startedAtMs ?? input.now();
			const elapsedMs = input.now() - startedAt;
			if (elapsedMs >= input.windowMs) {
				input.logger.warn('Reconnect timeout reached', { elapsedMs });
				stop('retry-timeout');
				return;
			}

			const snapshot = input.getSnapshot();
			if (snapshot.resetInFlight) {
				stop('tailscale-reset-in-progress');
				return;
			}
			if (
				shouldWaitForForegroundServiceCoverage({
					platformOS: snapshot.platformOS,
					appActive: snapshot.appActive,
					backgroundWorkAllowed: snapshot.backgroundWorkAllowed,
					foregroundServiceRequired: snapshot.foregroundServiceRequired,
				})
			) {
				scheduleNext();
				return;
			}
			if (
				!canAttemptBackgroundReconnect({
					platformOS: snapshot.platformOS,
					appActive: snapshot.appActive,
					backgroundWorkAllowed: snapshot.backgroundWorkAllowed,
				})
			) {
				stop('app-not-active');
				return;
			}

			const success = await input.attemptAutoConnect();
			if (!isCurrent(loopGeneration)) return;
			if (success) {
				input.logger.info('Reconnected successfully', { elapsedMs });
				stop('reconnected');
				return;
			}
			if (input.getSnapshot().resetInFlight) {
				stop('tailscale-reset-in-progress');
				return;
			}
			scheduleNext();
		};

		void attemptWithBackoff();
		return true;
	};

	return {
		start: startInternal,
		replace(reason: string) {
			if (running) {
				stop(`${reason}-restart`);
			}
			return startInternal(reason);
		},
		stop,
		isRunning() {
			return running;
		},
	};
}
```

- [ ] **Step 4: Wire `AutoConnectManager` to the controller**

In `apps/mobile/src/lib/auto-connect.tsx`, import:

```ts
import { createAutoConnectReconnectController } from './auto-connect-reconnect-controller';
```

Remove these refs from `AutoConnectManager`:

```ts
const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
const reconnectStartedAtMsRef = React.useRef<number | null>(null);
const reconnectAttemptRef = React.useRef(0);
const reconnectLoopRunningRef = React.useRef(false);
const reconnectLoopGenerationRef = React.useRef(0);
```

Replace `clearReconnectTimer`, `stopReconnectCycle`, and `scheduleReconnect` with a single controller ref:

```ts
const reconnectControllerRef = React.useRef<ReturnType<
	typeof createAutoConnectReconnectController
> | null>(null);

const getReconnectSnapshot = React.useCallback(
	() => ({
		isAutoConnecting: useAutoConnectStore.getState().isAutoConnecting,
		isReconnecting: useAutoConnectStore.getState().isReconnecting,
		resetInFlight: tailscaleResetInFlightRef.current,
		platformOS: Platform.OS,
		appActive: isActiveRef.current,
		backgroundWorkAllowed: allowBackgroundRef.current,
		foregroundServiceRequired: shouldRunForegroundService({
			shellCount: Object.keys(useSshStore.getState().shells).length,
			isAutoConnecting: useAutoConnectStore.getState().isAutoConnecting,
			isReconnecting: useAutoConnectStore.getState().isReconnecting,
		}),
	}),
	[],
);

if (reconnectControllerRef.current === null) {
	reconnectControllerRef.current = createAutoConnectReconnectController({
		delaysMs: RECONNECT_DELAYS_MS,
		windowMs: RECONNECT_WINDOW_MS,
		now: () => Date.now(),
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (id) => clearTimeout(id),
		getSnapshot: getReconnectSnapshot,
		setReconnecting,
		attemptAutoConnect: () => attemptAutoConnect(),
		logger,
	});
}

const stopReconnectCycle = React.useCallback((reason: string) => {
	reconnectControllerRef.current?.stop(reason);
}, []);

const scheduleReconnect = React.useCallback((reason: string) => {
	return reconnectControllerRef.current?.start(reason) ?? false;
}, []);

const replaceReconnect = React.useCallback((reason: string) => {
	return reconnectControllerRef.current?.replace(reason) ?? false;
}, []);
```

If the inline initialization causes a dependency-order issue because `attemptAutoConnect` is declared later, move controller creation into a `React.useEffect` placed after `attemptAutoConnect` and store the latest `attemptAutoConnect` in a ref:

```ts
const attemptAutoConnectRef = React.useRef<() => Promise<boolean>>(async () => false);
attemptAutoConnectRef.current = attemptAutoConnect;
```

Then pass `attemptAutoConnect: () => attemptAutoConnectRef.current()`.

Replace call sites:

```ts
scheduleReconnect('app-resume-no-shell');
scheduleReconnect('shell-drop');
replaceReconnect('tailscale-retry-action');
replaceReconnect('tailscale-reset-action');
stopReconnectCycle('app-backgrounded');
```

Delete imports of `canStartReplacementReconnect` and `isCurrentReconnectLoop` from `auto-connect.tsx`. Delete those helpers from `auto-connect-recovery.ts` after tests stop using them.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect-reconnect-controller.test.ts test/integration/auto-connect.test.ts
```

Expected: all tests pass. If `auto-connect.test.ts` still imports deleted helper functions, move those assertions into `auto-connect-reconnect-controller.test.ts` and remove the old imports.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/mobile/src/lib/auto-connect-reconnect-controller.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/lib/auto-connect-recovery.ts apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts apps/mobile/test/integration/auto-connect.test.ts
git commit -m "Extract auto-connect reconnect controller"
```

## Task 4: Extract Manual Tailscale Recovery Actions

**Files:**
- Create: `apps/mobile/src/lib/tailscale-recovery-actions.ts`
- Create: `apps/mobile/test/integration/tailscale-recovery-actions.test.ts`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Modify: `apps/mobile/src/lib/auto-connect-recovery.ts`

- [ ] **Step 1: Write failing tests for manual actions**

Create `apps/mobile/test/integration/tailscale-recovery-actions.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTailscaleRecoveryActions } from '../../src/lib/tailscale-recovery-actions';

void test('manual retry replaces reconnect and clears attention only when it starts', () => {
	const calls: string[] = [];
	const actions = createTailscaleRecoveryActions({
		recovery: {
			openApp: async () => ({ attempted: true }),
			reset: async () => ({ kind: 'reset', attempted: true }),
		},
		waitForAutoConnectIdle: async () => true,
		reconnect: {
			stop: (reason) => calls.push(`stop:${reason}`),
			replace: (reason) => {
				calls.push(`replace:${reason}`);
				return true;
			},
		},
		attention: {
			clear: () => calls.push('clear'),
			mark: (message) => calls.push(`mark:${message}`),
			recovering: (message) => calls.push(`recovering:${message}`),
		},
		logger: { warn: () => {} },
	});

	assert.equal(actions.retry(), true);
	assert.deepEqual(calls, ['replace:tailscale-retry-action', 'clear']);
});

void test('manual retry preserves attention when reconnect cannot start', () => {
	const calls: string[] = [];
	const actions = createTailscaleRecoveryActions({
		recovery: {
			openApp: async () => ({ attempted: true }),
			reset: async () => ({ kind: 'reset', attempted: true }),
		},
		waitForAutoConnectIdle: async () => true,
		reconnect: {
			stop: (reason) => calls.push(`stop:${reason}`),
			replace: (reason) => {
				calls.push(`replace:${reason}`);
				return false;
			},
		},
		attention: {
			clear: () => calls.push('clear'),
			mark: (message) => calls.push(`mark:${message}`),
			recovering: (message) => calls.push(`recovering:${message}`),
		},
		logger: { warn: () => {} },
	});

	assert.equal(actions.retry(), false);
	assert.deepEqual(calls, ['replace:tailscale-retry-action']);
});

void test('manual reset waits for idle, resets Tailscale, and replaces reconnect', async () => {
	const calls: string[] = [];
	const actions = createTailscaleRecoveryActions({
		recovery: {
			openApp: async () => ({ attempted: true }),
			reset: async () => {
				calls.push('reset');
				return { kind: 'reset', attempted: true };
			},
		},
		waitForAutoConnectIdle: async () => {
			calls.push('waitIdle');
			return true;
		},
		reconnect: {
			stop: (reason) => calls.push(`stop:${reason}`),
			replace: (reason) => {
				calls.push(`replace:${reason}`);
				return true;
			},
		},
		attention: {
			clear: () => calls.push('clear'),
			mark: (message) => calls.push(`mark:${message}`),
			recovering: (message) => calls.push(`recovering:${message}`),
		},
		logger: { warn: () => {} },
	});

	await actions.reset();

	assert.deepEqual(calls, [
		'stop:tailscale-reset-action',
		'recovering:Resetting Tailscale...',
		'waitIdle',
		'reset',
		'replace:tailscale-reset-action',
		'clear',
	]);
	assert.equal(actions.isResetInFlight(), false);
});

void test('manual reset reports attention when reset does not start', async () => {
	const calls: string[] = [];
	const actions = createTailscaleRecoveryActions({
		recovery: {
			openApp: async () => ({ attempted: true }),
			reset: async () => ({ kind: 'notStarted', attempted: false }),
		},
		waitForAutoConnectIdle: async () => true,
		reconnect: {
			stop: (reason) => calls.push(`stop:${reason}`),
			replace: (reason) => {
				calls.push(`replace:${reason}`);
				return true;
			},
		},
		attention: {
			clear: () => calls.push('clear'),
			mark: (message) => calls.push(`mark:${message}`),
			recovering: (message) => calls.push(`recovering:${message}`),
		},
		logger: { warn: () => {} },
	});

	await actions.reset();

	assert.deepEqual(calls, [
		'stop:tailscale-reset-action',
		'recovering:Resetting Tailscale...',
		'mark:Tailscale reset did not start. Open Tailscale, then retry Fressh.',
	]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-actions.test.ts
```

Expected: fail with `Cannot find module '../../src/lib/tailscale-recovery-actions'`.

- [ ] **Step 3: Implement manual action coordinator**

Create `apps/mobile/src/lib/tailscale-recovery-actions.ts`:

```ts
import {
	TAILSCALE_RESET_FAILED_MESSAGE,
	getTailscaleManualResetAttentionMessage,
	type TailscaleManualResetResult,
} from './tailscale-recovery-core';

type TailscaleRecoveryActionDeps = {
	recovery: {
		openApp: () => Promise<{ attempted: boolean }>;
		reset: () => Promise<TailscaleManualResetResult>;
	};
	waitForAutoConnectIdle: () => Promise<boolean>;
	reconnect: {
		stop: (reason: string) => void;
		replace: (reason: string) => boolean;
	};
	attention: {
		clear: () => void;
		mark: (message: string) => void;
		recovering: (message: string) => void;
	};
	logger: {
		warn: (message: string, ...args: unknown[]) => void;
	};
};

export function createTailscaleRecoveryActions(input: TailscaleRecoveryActionDeps) {
	let resetInFlight = false;

	return {
		isResetInFlight() {
			return resetInFlight;
		},

		open() {
			void input.recovery.openApp();
		},

		retry() {
			const started = input.reconnect.replace('tailscale-retry-action');
			if (started) {
				input.attention.clear();
			}
			return started;
		},

		async reset() {
			if (resetInFlight) return false;
			resetInFlight = true;
			input.reconnect.stop('tailscale-reset-action');
			input.attention.recovering('Resetting Tailscale...');
			try {
				const idle = await input.waitForAutoConnectIdle();
				if (!idle) {
					input.attention.mark(
						'Fressh is still reconnecting. Try resetting Tailscale again.',
					);
					return false;
				}

				const result = await input.recovery.reset();
				const message = getTailscaleManualResetAttentionMessage(result);
				if (message !== null) {
					input.attention.mark(message);
					return false;
				}

				resetInFlight = false;
				const started = input.reconnect.replace('tailscale-reset-action');
				if (started) {
					input.attention.clear();
					return true;
				}
				input.attention.mark('Tailscale reset finished. Retry Fressh to reconnect.');
				return false;
			} catch (error) {
				input.logger.warn('Manual Tailscale reset failed', error);
				input.attention.mark(TAILSCALE_RESET_FAILED_MESSAGE);
				return false;
			} finally {
				resetInFlight = false;
			}
		},
	};
}
```

- [ ] **Step 4: Wire actions into `AutoConnectManager`**

In `apps/mobile/src/lib/auto-connect.tsx`, import:

```ts
import { createTailscaleRecoveryActions } from './tailscale-recovery-actions';
```

Replace `tailscaleResetInFlightRef` usage with an actions ref:

```ts
const tailscaleRecoveryActionsRef = React.useRef<ReturnType<
	typeof createTailscaleRecoveryActions
> | null>(null);
```

Use `tailscaleRecoveryActionsRef.current?.isResetInFlight() ?? false` inside the reconnect snapshot.

Create the actions after `waitForAutoConnectIdle`, `stopReconnectCycle`, and `replaceReconnect` exist:

```ts
if (tailscaleRecoveryActionsRef.current === null) {
	tailscaleRecoveryActionsRef.current = createTailscaleRecoveryActions({
		recovery: tailscaleRecovery,
		waitForAutoConnectIdle,
		reconnect: {
			stop: stopReconnectCycle,
			replace: replaceReconnect,
		},
		attention: {
			clear: clearTailscaleAttention,
			mark: markTailscaleAttention,
			recovering: (message) => {
				setTailscaleRecoveryUiState({ phase: 'recovering', message });
			},
		},
		logger,
	});
}
```

Replace handlers with:

```ts
const handleOpenTailscale = React.useCallback(() => {
	tailscaleRecoveryActionsRef.current?.open();
}, []);

const handleRetryAfterTailscaleRecovery = React.useCallback(() => {
	tailscaleRecoveryActionsRef.current?.retry();
}, []);

const handleResetTailscale = React.useCallback(() => {
	void tailscaleRecoveryActionsRef.current?.reset();
}, []);
```

Delete `getTailscaleManualResetDecision`, `canUpdateTailscaleAttention`, and `TAILSCALE_RESET_FAILED_MESSAGE` imports from `auto-connect.tsx`. If `auto-connect-recovery.ts` no longer exports anything used, delete the file and remove its tests from `auto-connect.test.ts`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-actions.test.ts test/integration/auto-connect.test.ts test/integration/tailscale-recovery-core.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/mobile/src/lib/tailscale-recovery-actions.ts apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/lib/auto-connect-recovery.ts apps/mobile/test/integration/tailscale-recovery-actions.test.ts apps/mobile/test/integration/auto-connect.test.ts
git commit -m "Extract manual Tailscale recovery actions"
```

## Task 5: Thin `AutoConnectManager` and Remove Dead Helpers

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Delete: `apps/mobile/src/lib/auto-connect-recovery.ts` if empty
- Modify: `apps/mobile/test/integration/auto-connect.test.ts`

- [ ] **Step 1: Verify current size and helper usage**

Run:

```bash
wc -l apps/mobile/src/lib/auto-connect.tsx
rg -n "auto-connect-recovery|shouldMarkTailscaleRecoveryAttention|canStartReplacementReconnect|canUpdateTailscaleAttention|isCurrentReconnectLoop|getTailscaleManualResetDecision" apps/mobile/src apps/mobile/test/integration
```

Expected before cleanup: `auto-connect.tsx` is lower than the current `934` lines after Tasks 2-4, and `rg` shows only obsolete references that can be deleted or moved to the new focused tests.

- [ ] **Step 2: Remove obsolete local Tailscale state helpers**

In `apps/mobile/src/lib/auto-connect.tsx`, keep only this Tailscale UI state near the other React state:

```ts
const [tailscaleRecoveryUiState, setTailscaleRecoveryUiState] =
	React.useState<TailscaleRecoveryUiState>(hiddenTailscaleRecoveryState);
```

Keep these attention callbacks:

```ts
const clearTailscaleAttention = React.useCallback(() => {
	setTailscaleRecoveryUiState(hiddenTailscaleRecoveryState);
}, []);

const markTailscaleAttention = React.useCallback((message: string) => {
	setTailscaleRecoveryUiState({ phase: 'needsAttention', message });
}, []);
```

Remove any local `force` option, reset-in-flight gate, and direct reset mutation from the component. Reset transaction ownership now belongs to `tailscale-recovery-actions.ts`.

- [ ] **Step 3: Delete or shrink `auto-connect-recovery.ts`**

If `rg` shows no source imports of `apps/mobile/src/lib/auto-connect-recovery.ts`, delete it:

```bash
rm apps/mobile/src/lib/auto-connect-recovery.ts
```

If one message export remains, replace the file contents with:

```ts
export {
	TAILSCALE_REACHABILITY_MESSAGE,
	TAILSCALE_RESET_FAILED_MESSAGE,
	TAILSCALE_RESET_NOT_STARTED_MESSAGE,
	TAILSCALE_RESTART_FAILED_MESSAGE,
	TAILSCALE_UNAVAILABLE_MESSAGE,
} from './tailscale-recovery-core';
```

Use `apply_patch` for manual deletion in this repository workflow:

```diff
*** Begin Patch
*** Delete File: /home/muly/fressh/.worktrees/android-tailscale-recovery/apps/mobile/src/lib/auto-connect-recovery.ts
*** End Patch
```

- [ ] **Step 4: Remove migrated tests from `auto-connect.test.ts`**

In `apps/mobile/test/integration/auto-connect.test.ts`, keep launch URL tests. Remove tests for helpers that now live in:

```txt
apps/mobile/test/integration/auto-connect-saved-entry.test.ts
apps/mobile/test/integration/auto-connect-reconnect-controller.test.ts
apps/mobile/test/integration/tailscale-recovery-actions.test.ts
apps/mobile/test/integration/tailscale-recovery-core.test.ts
```

The top of `auto-connect.test.ts` should no longer import from `../../src/lib/auto-connect-recovery`.

- [ ] **Step 5: Enforce the decomposition target**

Run:

```bash
wc -l apps/mobile/src/lib/auto-connect.tsx
```

Expected: `auto-connect.tsx` is below `800` lines. If it is still above `800`, move one more cohesive block out before continuing. The next candidates are foreground-service start orchestration or active-connection shell reopening.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts test/integration/tailscale-recovery-actions.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/mobile/src/lib/auto-connect.tsx apps/mobile/src/lib/auto-connect-recovery.ts apps/mobile/test/integration/auto-connect.test.ts
git commit -m "Thin auto-connect manager recovery wiring"
```

If `auto-connect-recovery.ts` was deleted, use:

```bash
git add apps/mobile/src/lib/auto-connect.tsx apps/mobile/test/integration/auto-connect.test.ts
git rm apps/mobile/src/lib/auto-connect-recovery.ts
git commit -m "Thin auto-connect manager recovery wiring"
```

## Task 6: Full Verification and Android Build Sanity

**Files:**
- No feature files expected unless verification exposes a defect.

- [ ] **Step 1: Run all focused Tailscale and auto-connect tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/auto-connect.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts test/integration/tailscale-recovery-actions.test.ts test/integration/tailscale-recovery.test.ts test/integration/tailscale-recovery-core.test.ts test/integration/tailscale-native-core.test.ts test/integration/tailscale-recovery-banner.test.ts test/integration/tailscale-plugin.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: `tsc` exits 0.

- [ ] **Step 3: Focused ESLint**

Run:

```bash
pnpm --filter @fressh/mobile exec eslint src/lib/auto-connect.tsx src/lib/auto-connect-saved-entry.ts src/lib/auto-connect-reconnect-controller.ts src/lib/tailscale-recovery-actions.ts src/lib/tailscale-recovery.ts src/lib/tailscale-recovery-core.ts test/integration/auto-connect.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts test/integration/tailscale-recovery-actions.test.ts
```

Expected: exits 0 with no lint errors.

- [ ] **Step 4: Focused Prettier**

Run:

```bash
pnpm --filter @fressh/mobile exec prettier --check src/lib/auto-connect.tsx src/lib/auto-connect-saved-entry.ts src/lib/auto-connect-reconnect-controller.ts src/lib/tailscale-recovery-actions.ts src/lib/tailscale-recovery.ts src/lib/tailscale-recovery-core.ts test/integration/auto-connect.test.ts test/integration/auto-connect-saved-entry.test.ts test/integration/auto-connect-reconnect-controller.test.ts test/integration/tailscale-recovery-actions.test.ts
```

Expected: `All matched files use Prettier code style!`.

- [ ] **Step 5: Android Kotlin compile**

Run:

```bash
ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk FRESSH_UPDATE_CHANNEL=preview pnpm --filter @fressh/mobile android:prebuild-compile-debug-kotlin
```

Expected: Gradle `:app:compileDebugKotlin` succeeds. Warnings about deprecated React Native Android APIs are acceptable if they match the existing warnings from the prior build.

- [ ] **Step 6: Check worktree status**

Run:

```bash
git status --short
```

Expected: clean worktree. If prebuild reorders `apps/mobile/android/app/src/main/res/values/strings.xml` without semantic changes, restore the tracked ordering with `apply_patch` rather than committing generated churn.

- [ ] **Step 7: Commit verification-only fixes if needed**

If Step 1-6 required a source fix, run the focused verification commands again and commit the fix:

```bash
git add apps/mobile/src/lib apps/mobile/test/integration
git commit -m "Stabilize Tailscale recovery refactor verification"
```

If Step 1-6 passed without source changes, do not create a commit.

## Self-Review

**Spec coverage:** This plan directly addresses the thermo-nuclear review findings: typed recovery boundaries in Task 1, saved-entry retry extraction in Task 2, reconnect state-machine extraction in Task 3, manual reset transaction extraction in Task 4, and `AutoConnectManager` size/ownership cleanup in Task 5.

**Placeholder scan:** The plan contains exact files, commands, expected outcomes, and concrete code snippets for each new module. It does not rely on deferred design decisions.

**Type consistency:** Later tasks use the result kinds defined in Task 1: `unsupported`, `unavailable`, `ready`, `cooldown`, `failed`, `nonNetworkFailure`, `recovered`, `notStarted`, and `reset`. The saved-entry and manual-action helpers consume those same exported types.
