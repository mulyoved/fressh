# ShellDetail and Wispr Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ShellDetail`'s implicit route, screen-session, Workmux,
diagnostic, cross-controller, and Wispr ownership with typed lifetime owners,
leaving a route file below 650 nonblank lines and a `ShellDetail` composition
component below 300 lines.

**Architecture:** Parse route parameters into a discriminated result, then give
one screen-session hook ownership of connection observation, tmux configuration,
Workmux, diagnostics, and reconnect navigation while the SSH store retains live
SSH resources. Keep terminal, scrollback, keyboard, and Wispr as focused
controllers connected by typed generation-bound ports; render them through a
real `ShellScreenView`, not a pass-through facade.

**Tech Stack:** TypeScript 5.9, React 19, Expo 54, React Native 0.81, Zustand,
Node `tsx --test`, pnpm/Turbo, Prettier, ESLint.

## Global Constraints

- Start every behavior change with a failing test and observe the expected
  failure before writing production code.
- Preserve current shell, terminal, scrollback, keyboard, Workmux, notification,
  modal, and Wispr behavior except that invalid shell routes render a Back
  screen instead of throwing.
- The SSH connection store remains the only owner that creates or destroys live
  SSH connections and shells. Screen unmount must not disconnect them.
- The session owner creates, retires, and disposes every Workmux channel.
- Scrollback remains the only user-originated terminal-input gate.
- Wispr lives for the complete valid shell-screen session and owns every native
  request, timer, request ID, deferred start, and pending close.
- Controllers communicate through typed ports and identity generations, never
  another controller's ref or raw Workmux channel.
- Do not add Redux, XState, an event bus, a barrel file, a combined
  `ShellRuntime` facade, compatibility wrappers, pass-through wrappers, or no-op
  placeholder dependencies.
- Breaking TypeScript APIs are allowed. Delete replaced signatures and tests in
  the same task that introduces their replacement.
- Do not preserve render-time assignments to mutable refs. React commit work
  belongs in layout/passive effects; controller state belongs in controller
  cores.
- `ShellDetail` may parse, construct controllers, wire narrow ports, select a
  view state, and render. It may not own workflow state, timers, queues,
  generations, cleanup order, native calls, SSH/Workmux calls, or diagnostic
  event construction.
- Keep the `ShellDetail` function below 300 lines and
  `apps/mobile/src/app/shell/detail.tsx` below 650 nonblank lines.
- Keep each new session or Wispr core/hook below 350 nonblank lines. If a unit
  approaches the limit, split by owned protocol rather than adding a facade or
  field-copying adapter.
- Use local Android preview builds for device checks. Do not use Metro as the
  normal workflow, clear `com.finalapp.vibe2` data, or run
  `test:e2e:clear-state`.
- Run a thermo-nuclear maintainability review after automated verification and
  resolve every blocker before merge.

---

## File Structure

### Create

- `apps/mobile/src/app/shell/shell-route.ts`
  - Pure route parameter parser and typed route request/error contracts.
- `apps/mobile/src/app/shell/components/ShellRouteErrorScreen.tsx`
  - Recoverable invalid-route rendering with one Back command.
- `apps/mobile/src/app/shell/ShellScreenView.tsx`
  - Real terminal, overlay, keyboard, and modal rendering boundary.
- `apps/mobile/src/lib/shell-controllers/session-contracts.ts`
  - Session identities, snapshots, and terminal/host/Workmux/diagnostic ports.
- `apps/mobile/src/lib/shell-controllers/session-core.ts`
  - Pure reconnect-aware session state and navigation decisions.
- `apps/mobile/src/lib/shell-controllers/session-diagnostics.ts`
  - Generation-bound typed diagnostic port.
- `apps/mobile/src/lib/shell-controllers/session-workmux.ts`
  - Sole Workmux creator/disposer and restricted cleanup registration.
- `apps/mobile/src/lib/shell-controllers/session.tsx`
  - Thin React/store adapter for the session core and ports.
- `apps/mobile/src/lib/shell-controllers/wispr-core.ts`
  - Dependency-injected Wispr automation state machine and public snapshot.
- `apps/mobile/src/lib/shell-controllers/wispr-tap-runner.ts`
  - Native tap retry, timeout, cancellation, and late-result ownership.
- `apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts`
  - Pending start/close matching, expiry, and deferred-start release.
- `apps/mobile/src/lib/shell-controllers/wispr.tsx`
  - Thin React/native adapter exposing Wispr view props and commands.
- `apps/mobile/test/integration/shell-route.test.ts`
- `apps/mobile/test/integration/shell-session-controller.test.ts`
- `apps/mobile/test/integration/shell-session-workmux.test.ts`
- `apps/mobile/test/integration/shell-wispr-controller.test.ts`
- `apps/mobile/test/integration/shell-detail-boundary.test.ts`

### Modify

- `apps/mobile/src/app/shell/detail.tsx`
  - Replace inline ownership with typed route/session/Wispr composition.
- `apps/mobile/src/lib/shell-controllers/terminal.tsx`
- `apps/mobile/src/lib/shell-controllers/terminal-hook-runtime.ts`
- `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts`
  - Consume a session terminal-source port and publish current runtime/mode/size
    snapshots without callbacks or render-written refs.
- `apps/mobile/src/lib/shell-controllers/scrollback-contracts.ts`
- `apps/mobile/src/lib/shell-controllers/scrollback.tsx`
  - Consume the session Workmux port, register retirement cleanup, and observe
    terminal runtime/mode snapshots directly.
- `apps/mobile/src/lib/shell-controllers/keyboard-hook-contracts.ts`
- `apps/mobile/src/lib/shell-controllers/keyboard-remote-contracts.ts`
- `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
  - Consume session ports and explicit current modal commands.
- `apps/mobile/src/lib/shell-controllers/browser-actions-adapter.ts`
- `apps/mobile/src/lib/shell-controllers/browser-actions.tsx`
- `apps/mobile/src/lib/shell-controllers/notifications.tsx`
- `apps/mobile/src/lib/shell-controllers/skill-selector-adapter.ts`
- `apps/mobile/src/lib/shell-controllers/skill-selector.tsx`
  - Replace raw connection/Workmux parameters with typed session ports.
- `apps/mobile/src/lib/shell-controllers/simple-modals.tsx`
  - Remove `openRef` and its render-time assignment.
- `apps/mobile/src/lib/use-connection-debug-command.ts`
  - Replace the disabled-paste/no-op callback pair with a discriminated delivery
    contract.
- Existing shell composition integration tests that read `detail.tsx`
  - Point behavior checks at the new cores and keep only narrow architecture
    guards in `shell-detail-boundary.test.ts`.
- `apps/mobile/test/integration/wispr-automation.test.ts`
  - Retain tests for pure Wispr reducer/policy helpers; move orchestration tests
    to the controller suite.

### Delete

- `apps/mobile/src/app/shell/shell-keyboard-composition.ts`
  - Remove the field-copying input wrapper, no-op late bindings, authority shim,
    and publication shim.
- `apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts`
  - Replace shim tests with direct port and boundary tests.
- `apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts`
  - Replace source-regex navigation coverage with session-core behavior tests.

---

### Task 1: Typed Route Boundary and Recoverable Error Screen

**Files:**

- Create: `apps/mobile/src/app/shell/shell-route.ts`
- Create: `apps/mobile/src/app/shell/components/ShellRouteErrorScreen.tsx`
- Create: `apps/mobile/test/integration/shell-route.test.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx:369-415`

**Interfaces:**

- Consumes: Expo route parameter strings.
- Produces: `parseShellRoute(params): ShellRouteResult`, `ShellRouteRequest`,
  and `ShellRouteErrorScreen`.

- [ ] **Step 1: Write the failing parser tests**

Create `apps/mobile/test/integration/shell-route.test.ts` with these cases:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShellRoute } from '../../src/app/shell/shell-route';

void test('shell route normalizes a complete request', () => {
	assert.deepEqual(
		parseShellRoute({
			connectionId: ' connection-1 ',
			channelId: '7',
			storedConnectionId: ' saved-1 ',
			agentConnectionId: ' agent-1 ',
			agentSession: ' main ',
			agentWindowId: ' 2 ',
			agentEventId: ' event-1 ',
			agentTapToken: ' token-1 ',
			tmuxSessionName: ' work ',
		}),
		{
			status: 'valid',
			request: {
				connectionId: 'connection-1',
				channelId: 7,
				storedConnectionId: 'saved-1',
				agentRoute: {
					connectionId: 'agent-1',
					session: 'main',
					windowId: '2',
					eventId: 'event-1',
					tapToken: 'token-1',
				},
				tmuxAttach: { status: 'normal', sessionName: 'work' },
			},
		},
	);
});

void test('shell route rejects a missing connection id', () => {
	assert.deepEqual(parseShellRoute({ channelId: '1' }), {
		status: 'invalid',
		error: {
			code: 'missing-connection-id',
			message: 'This shell link is missing a connection.',
		},
	});
});

for (const channelId of [undefined, '', '1x', '-1', '1.5']) {
	void test(`shell route rejects channel id ${String(channelId)}`, () => {
		assert.equal(
			parseShellRoute({ connectionId: 'connection-1', channelId }).status,
			'invalid',
		);
	});
}

void test('shell route preserves tmux attach failure as typed state', () => {
	const result = parseShellRoute({
		connectionId: 'connection-1',
		channelId: '1',
		tmuxError: 'attach-failed',
		tmuxAttachFailureReason: 'session-missing',
		tmuxSessionName: 'main',
	});
	assert.equal(result.status, 'valid');
	if (result.status === 'valid') {
		assert.deepEqual(result.request.tmuxAttach, {
			status: 'failed',
			sessionName: 'main',
			failureReason: 'session-missing',
		});
	}
});
```

- [ ] **Step 2: Run the route tests and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-route.test.ts
```

Expected: FAIL with `Cannot find module .../shell-route`.

- [ ] **Step 3: Add the complete route contracts and parser**

Create `shell-route.ts` with these public contracts and parsing rules:

```ts
export type ShellRouteParams = {
	connectionId?: string;
	channelId?: string;
	storedConnectionId?: string;
	agentConnectionId?: string;
	agentSession?: string;
	agentWindowId?: string;
	agentEventId?: string;
	agentTapToken?: string;
	tmuxError?: string;
	tmuxAttachFailureReason?: string;
	tmuxSessionName?: string;
};

export type ShellAgentRoute = {
	connectionId: string | null;
	session: string | null;
	windowId: string | null;
	eventId: string | null;
	tapToken: string | null;
};

export type ShellTmuxAttachRoute =
	| { status: 'normal'; sessionName: string }
	| { status: 'failed'; sessionName: string; failureReason?: string };

export type ShellRouteRequest = {
	connectionId: string;
	channelId: number;
	storedConnectionId?: string;
	agentRoute: ShellAgentRoute;
	tmuxAttach: ShellTmuxAttachRoute;
};

export type ShellRouteError = {
	code: 'missing-connection-id' | 'invalid-channel-id';
	message: string;
};

export type ShellRouteResult =
	| { status: 'valid'; request: ShellRouteRequest }
	| { status: 'invalid'; error: ShellRouteError };

const optional = (value?: string): string | null => value?.trim() || null;

export function parseShellRoute(params: ShellRouteParams): ShellRouteResult {
	const connectionId = optional(params.connectionId);
	if (!connectionId) {
		return {
			status: 'invalid',
			error: {
				code: 'missing-connection-id',
				message: 'This shell link is missing a connection.',
			},
		};
	}
	const rawChannelId = params.channelId?.trim() ?? '';
	const channelId = Number(rawChannelId);
	if (!/^\d+$/.test(rawChannelId) || !Number.isSafeInteger(channelId)) {
		return {
			status: 'invalid',
			error: {
				code: 'invalid-channel-id',
				message: 'This shell link has an invalid channel.',
			},
		};
	}
	const sessionName = optional(params.tmuxSessionName) ?? 'main';
	const storedConnectionId = optional(params.storedConnectionId);
	return {
		status: 'valid',
		request: {
			connectionId,
			channelId,
			...(storedConnectionId ? { storedConnectionId } : {}),
			agentRoute: {
				connectionId: optional(params.agentConnectionId),
				session: optional(params.agentSession),
				windowId: optional(params.agentWindowId),
				eventId: optional(params.agentEventId),
				tapToken: optional(params.agentTapToken),
			},
			tmuxAttach:
				params.tmuxError === 'attach-failed'
					? {
							status: 'failed',
							sessionName,
							...(optional(params.tmuxAttachFailureReason)
								? { failureReason: optional(params.tmuxAttachFailureReason)! }
								: {}),
						}
					: { status: 'normal', sessionName },
		},
	};
}
```

Create `ShellRouteErrorScreen.tsx` as a real view:

```tsx
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { type ShellRouteError } from '../shell-route';

export function ShellRouteErrorScreen({
	error,
	onBack,
}: {
	error: ShellRouteError;
	onBack(): void;
}) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				alignItems: 'center',
				justifyContent: 'center',
				gap: 16,
				padding: 24,
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Shell link unavailable
			</Text>
			<Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
				{error.message}
			</Text>
			<Pressable onPress={onBack} accessibilityRole="button">
				<Text style={{ color: theme.colors.primary, fontSize: 16 }}>Back</Text>
			</Pressable>
		</View>
	);
}
```

Split the current component into a hook-free `ShellDetailRoute` that parses the
parameters and renders either that screen or
`<ShellDetail request={result.request} />`. This preserves hook order when route
validity changes.

- [ ] **Step 4: Run route tests, formatting, and typecheck**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-route.test.ts && pnpm run fmt:check && pnpm run typecheck
```

Expected: all route tests PASS; formatting and typecheck exit 0.

- [ ] **Step 5: Commit the route boundary**

```bash
git add apps/mobile/src/app/shell/shell-route.ts apps/mobile/src/app/shell/components/ShellRouteErrorScreen.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-route.test.ts
git commit -m "Refine shell route boundary"
```

### Task 2: Pure Screen-Session State and Navigation Decisions

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/session-contracts.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-core.ts`
- Create: `apps/mobile/test/integration/shell-session-controller.test.ts`
- Delete:
  `apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts`

**Interfaces:**

- Consumes: `ShellRouteRequest`, connection/shell presence, auto-connect state,
  reconnect outcome, and resolved tmux configuration.
- Produces: `ShellSessionCore`, `ShellSessionSnapshot`, and typed navigation
  commands.

- [ ] **Step 1: Write failing session transition tests**

Build a harness around `createShellSessionCore()` and cover these exact rows:

```ts
const routeRequest: ShellRouteRequest = {
	connectionId: 'connection-1',
	channelId: 7,
	storedConnectionId: 'saved-1',
	agentRoute: {
		connectionId: null,
		session: null,
		windowId: null,
		eventId: null,
		tapToken: null,
	},
	tmuxAttach: { status: 'normal', sessionName: 'main' },
};

const failedAttachRouteRequest: ShellRouteRequest = {
	...routeRequest,
	tmuxAttach: {
		status: 'failed',
		sessionName: 'main',
		failureReason: 'session-missing',
	},
};

const readySource = {
	connectionPresent: true,
	shellPresent: true,
	isAutoConnecting: false,
	isReconnecting: false,
	lastReconnectOutcome: null,
	storedConnectionId: 'saved-1',
} as const;

function createHarness(request = routeRequest) {
	const events: Array<{ type: 'back' } | { type: 'edit-host'; id: string }> =
		[];
	const core = createShellSessionCore({
		request,
		navigate: {
			back: () => events.push({ type: 'back' }),
			editHost: (id) => events.push({ type: 'edit-host', id }),
		},
	});
	return { core, events };
}

void test('session becomes ready without taking SSH ownership', () => {
	const { core, events } = createHarness();
	core.reconcile(readySource);
	assert.deepEqual(core.getSnapshot(), {
		status: 'ready',
		generation: 1,
		storedConnectionId: 'saved-1',
	});
	core.dispose();
	assert.deepEqual(events, []);
});

void test('session waits while reconnect owns recovery', () => {
	const { core, events } = createHarness();
	core.reconcile({
		...readySource,
		shellPresent: false,
		isReconnecting: true,
	});
	assert.equal(core.getSnapshot().status, 'waiting');
	assert.deepEqual(events, []);
});

void test('failed reconnect routes to the stored host editor', () => {
	const { core, events } = createHarness();
	core.reconcile({
		...readySource,
		shellPresent: false,
		lastReconnectOutcome: { status: 'failed', destination: 'hostPage' },
	});
	assert.deepEqual(events, [{ type: 'edit-host', id: 'saved-1' }]);
});

void test('missing connection navigates back once', () => {
	const { core, events } = createHarness();
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});
	assert.deepEqual(events, [{ type: 'back' }]);
});

void test('tmux attach failure is a render state and never navigates', () => {
	const { core, events } = createHarness(failedAttachRouteRequest);
	core.reconcile({
		...readySource,
		connectionPresent: false,
		shellPresent: false,
	});
	assert.equal(core.getSnapshot().status, 'attach-error');
	assert.deepEqual(events, []);
});
```

- [ ] **Step 2: Run the session tests and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-controller.test.ts
```

Expected: FAIL because `session-core.ts` does not exist.

- [ ] **Step 3: Add exact session contracts**

Define these contracts in `session-contracts.ts`:

```ts
export type ShellSessionSnapshot =
	| {
			status: 'waiting';
			reason: 'auto-connect' | 'reconnect';
			generation: number;
	  }
	| {
			status: 'attach-error';
			failureReason?: string;
			sessionName: string;
			generation: number;
	  }
	| { status: 'ready'; storedConnectionId?: string; generation: number }
	| { status: 'leaving'; generation: number };

export type ShellSessionNavigation = {
	back(): void;
	editHost(storedConnectionId: string): void;
};

export type ShellSessionSource = {
	connectionPresent: boolean;
	shellPresent: boolean;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	lastReconnectOutcome: { status: string; destination: string } | null;
	storedConnectionId?: string;
};
```

Keep this task limited to route, snapshot, source, and navigation contracts.
Task 3 adds the capability ports after their Workmux and diagnostic behavior is
covered by failing tests.

- [ ] **Step 4: Implement the pure core**

Use `createControllerPublisher()` and these exact methods:

```ts
export type ShellSessionCore = ControllerCore<ShellSessionSnapshot> & {
	reconcile(source: ShellSessionSource): void;
};

type ShellSessionSnapshotWithoutGeneration =
	ShellSessionSnapshot extends infer Snapshot
		? Snapshot extends { generation: number }
			? Omit<Snapshot, 'generation'>
			: never
		: never;
```

Implement the core with one state signature and one navigation signature:

```ts
export function createShellSessionCore({
	request,
	navigate,
}: {
	request: ShellRouteRequest;
	navigate: ShellSessionNavigation;
}): ShellSessionCore {
	const initialBody: ShellSessionSnapshotWithoutGeneration =
		request.tmuxAttach.status === 'failed'
			? {
					status: 'attach-error',
					sessionName: request.tmuxAttach.sessionName,
					...(request.tmuxAttach.failureReason
						? { failureReason: request.tmuxAttach.failureReason }
						: {}),
				}
			: { status: 'waiting', reason: 'auto-connect' };
	const initial = { ...initialBody, generation: 0 } as ShellSessionSnapshot;
	const publisher = createControllerPublisher(initial);
	let generation = 0;
	let signature = JSON.stringify(initialBody);
	let navigationSignature: string | null = null;
	let disposed = false;

	const publish = (next: ShellSessionSnapshotWithoutGeneration) => {
		const nextSignature = JSON.stringify(next);
		if (nextSignature === signature) return;
		signature = nextSignature;
		generation += 1;
		publisher.publish({ ...next, generation } as ShellSessionSnapshot);
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		reconcile: (source) => {
			if (disposed || request.tmuxAttach.status === 'failed') return;
			if (source.connectionPresent && source.shellPresent) {
				navigationSignature = null;
				publish({
					status: 'ready',
					...(source.storedConnectionId
						? { storedConnectionId: source.storedConnectionId }
						: {}),
				});
				return;
			}
			if (source.isAutoConnecting || source.isReconnecting) {
				publish({
					status: 'waiting',
					reason: source.isAutoConnecting ? 'auto-connect' : 'reconnect',
				});
				return;
			}
			if (
				source.connectionPresent &&
				source.lastReconnectOutcome?.destination !== 'hostPage'
			) {
				publish({ status: 'waiting', reason: 'reconnect' });
				return;
			}
			const navigation = source.connectionPresent
				? `edit:${source.storedConnectionId ?? request.connectionId}`
				: 'back';
			publish({ status: 'leaving' });
			if (navigationSignature === navigation) return;
			navigationSignature = navigation;
			if (navigation === 'back') navigate.back();
			else navigate.editHost(navigation.slice('edit:'.length));
		},
		invalidate: () => {
			if (!disposed) publish({ status: 'leaving' });
		},
		dispose: () => {
			if (disposed) return;
			publish({ status: 'leaving' });
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
```

The core never imports an SSH resource and therefore cannot disconnect or remove
one.

- [ ] **Step 5: Run session tests and the old route regression replacement**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-controller.test.ts test/integration/shell-route.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the session state core**

```bash
git add apps/mobile/src/lib/shell-controllers/session-contracts.ts apps/mobile/src/lib/shell-controllers/session-core.ts apps/mobile/test/integration/shell-session-controller.test.ts apps/mobile/test/integration/shell-detail-host-page-reconnect-route.test.ts
git commit -m "Add shell session state owner"
```

### Task 3: Session-Scoped Diagnostics and Workmux Ownership

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/session-diagnostics.ts`
- Create: `apps/mobile/src/lib/shell-controllers/session-workmux.ts`
- Create: `apps/mobile/test/integration/shell-session-workmux.test.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/session-contracts.ts`

**Interfaces:**

- Consumes: current session generation, connection, target, Workmux factory,
  typed trace sink, logger, and timer functions.
- Produces: `createShellDiagnosticPort()` and
  `createShellSessionWorkmuxOwner()`.

- [ ] **Step 1: Write failing ownership and cleanup tests**

Test these behaviors with two fake channels and an event array:

```ts
void test('target replacement retires cleanup before disposing the old channel', async () => {
	const owner = createHarness('target-1');
	owner.port.registerBeforeDispose('scrollback', async (retiring) => {
		events.push('cleanup:start');
		await retiring.exitScroll({ sessionName: 'main' });
		events.push('cleanup:end');
	});
	owner.runtime.replace(createInput('target-2'));
	await owner.runtime.drain();
	assert.deepEqual(events, [
		'old:prepare',
		'cleanup:start',
		'old:exit:main',
		'cleanup:end',
		'old:dispose',
	]);
});

void test('retiring port rejects non-cleanup commands', async () => {
	const retiring = captureRetiringPort();
	assert.equal('command' in retiring, false);
	assert.equal('move' in retiring, false);
});

void test('cleanup timeout records diagnostics and still disposes once', async () => {
	const owner = createHarness('target-1', { cleanupTimeoutMs: 5 });
	owner.port.registerBeforeDispose('scrollback', () => new Promise(() => {}));
	owner.runtime.dispose('unmount');
	clock.advanceBy(5);
	await owner.runtime.drain();
	assert.equal(events.filter((event) => event === 'old:dispose').length, 1);
	assert.match(diagnostics.at(-1)?.message ?? '', /cleanup timed out/i);
});

void test('stale ports cannot command a replacement channel', async () => {
	const oldPort = owner.runtime.getPort();
	owner.runtime.replace(createInput('target-2'));
	assert.deepEqual(await oldPort.command(['tmux', 'app', 'nav', 'next']), {
		status: 'superseded',
	});
});
```

- [ ] **Step 2: Run the ownership test and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-workmux.test.ts
```

Expected: FAIL because `session-workmux.ts` does not exist.

- [ ] **Step 3: Implement the diagnostic port**

`createShellDiagnosticPort()` captures a generation getter and exposes:

```ts
export type ShellDiagnosticPort = {
	event(event: ConnectionDiagnosticEvent): void;
	warn(message: string, error?: unknown): void;
};
```

Both methods catch trace/logger failures. `event()` ignores a captured stale
generation and formats only typed event fields. It is the only session module
allowed to read the active auto-connect trace.

- [ ] **Step 4: Implement the Workmux owner and restricted retiring port**

Use this public shape:

```ts
export type RetiringWorkmuxCleanupPort = {
	exitScroll(input: { sessionName: string }): Promise<ControllerOutcome>;
};

export type ShellWorkmuxPort = {
	readonly key: ShellTargetKey;
	command(
		argv: string[],
		options?: { timeoutMs?: number },
	): Promise<ControllerOutcome<{ message: string }> & { output?: string }>;
	operation(
		request: MdevBridgeOperationRequest,
		options?: { timeoutMs?: number },
	): Promise<ControllerOutcome<{ message: string }> & { output?: string }>;
	scroll: {
		enter(input: WorkmuxScrollTarget): Promise<WorkmuxControlCommandResult>;
		move(input: WorkmuxScrollMove): Promise<WorkmuxControlCommandResult>;
		exit(input: WorkmuxScrollTarget): Promise<WorkmuxControlCommandResult>;
	};
	registerBeforeDispose(
		owner: string,
		cleanup: (port: RetiringWorkmuxCleanupPort) => Promise<void>,
	): () => void;
};
```

Add the other session ports beside it:

```ts
export type ShellTerminalSource = ShellListenerOwner & {
	readonly connectionId: string;
	readonly channelId: number;
	readBuffer(cursor: Cursor): BufferReadResult | Promise<BufferReadResult>;
	addListener(
		listener: (event: ListenerEvent) => void,
		options: { cursor: Cursor },
	): bigint | Promise<bigint>;
	sendData(bytes: Uint8Array<ArrayBufferLike>): Promise<void>;
	resizePty(cols: number, rows: number): Promise<void>;
};

export type ShellTerminalSourcePort = {
	readonly key: ShellTransportKey;
	readonly generation: number;
	getCurrent(): ShellTerminalSource | null;
};

export type ShellHostCommandPort = {
	readonly key: ShellTargetKey;
	run(command: string, timeoutMs: number): Promise<string>;
};

export type ShellActivityPort = {
	getSnapshot(): ShellActivitySnapshot;
	subscribe(listener: () => void): () => void;
};

export type ShellSessionPorts = {
	terminalSource: ShellTerminalSourcePort;
	hostCommands: ShellHostCommandPort;
	workmux: ShellWorkmuxPort;
	diagnostics: ShellDiagnosticPort;
	activity: ShellActivityPort;
};

export type ShellSessionWorkmuxInput = {
	key: ShellTargetKey;
	connection: WorkmuxControlConnection | null;
	diagnostics: ShellDiagnosticPort;
	createChannel(input: {
		connection: WorkmuxControlConnection | null;
		trace: { event(event: ConnectionDiagnosticEvent): void };
	}): WorkmuxControlChannel;
	cleanupTimeoutMs?: number;
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
};
```

The owner API is:

```ts
export type ShellSessionWorkmuxOwner = {
	getPort(): ShellWorkmuxPort;
	replace(input: ShellSessionWorkmuxInput): void;
	dispose(reason: 'reconnect' | 'unmount'): void;
	drain(): Promise<void>;
};
```

On replacement/disposal, synchronously call `prepareDispose`, invalidate the old
port, then run registered cleanup through an object containing only
`exitScroll`. Race cleanup against the injected timeout, record failure, and
call the captured old channel's `dispose()` once in `finally`. `drain()` returns
the current retirement chain for deterministic tests.

- [ ] **Step 5: Run Workmux owner and existing channel suites**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-workmux.test.ts test/integration/workmux-control-channel.test.ts test/integration/shell-scrollback-channel-teardown.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit Workmux and diagnostic ownership**

```bash
git add apps/mobile/src/lib/shell-controllers/session-contracts.ts apps/mobile/src/lib/shell-controllers/session-diagnostics.ts apps/mobile/src/lib/shell-controllers/session-workmux.ts apps/mobile/test/integration/shell-session-workmux.test.ts
git commit -m "Own Workmux in shell sessions"
```

### Task 4: React Session Hook and Store Adapter

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/session.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx:400-589`
- Modify: `apps/mobile/test/integration/shell-session-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

**Interfaces:**

- Consumes: a valid `ShellRouteRequest`, activity port, router, logger, SSH and
  auto-connect stores, secrets query, side-channel command, and Workmux factory.
- Produces: `useShellSessionController(): ShellSessionControllerHandle`.

- [ ] **Step 1: Add a failing hook-composition source contract**

Assert that `detail.tsx` calls
`useShellSessionController({ request, activity, router, logger })` exactly once
and no longer contains `useSshStore`, `useAutoConnectStore`, `queryClient`,
`secretsManager`, `createWorkmuxControlChannel`, `activeDiagnosticTraceRef`, the
tmux configuration effects, or missing-session navigation logic.

- [ ] **Step 2: Run the focused composition tests and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-session-controller.test.ts test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: FAIL because `detail.tsx` still owns the listed work.

- [ ] **Step 3: Implement the thin session hook**

Export this handle:

```ts
export type ShellSessionControllerHandle = {
	snapshot: ShellSessionSnapshot;
	ports: ShellSessionPorts;
	identity: {
		transportKey: ShellTransportKey;
		targetKey: ShellTargetKey;
		generation: number;
	};
	tmux: { enabled: boolean; target: string };
	storedConnectionId?: string;
	invalidateShellTransport(): void;
};
```

The hook owns all relevant store selectors. It creates one session core, one
diagnostic port, and one Workmux owner with `useState`. Layout effects reconcile
committed sources and ports; passive cleanup invalidates the core and retires
Workmux. The terminal-source adapter implements the listener/read/send/resize
capabilities from the current store shell without exposing that raw shell.

Resolve stored tmux configuration inside the hook with a generation token.
Ignore stale query completion. A target or connection replacement calls the
Workmux owner's `replace()`; do not force replacement with a `void target`
statement or an unrelated memo dependency.

- [ ] **Step 4: Replace inline session setup in `detail.tsx`**

Use the hook result for connection availability, tmux state, identities,
notification route context, and the terminal source. Replace attach-error,
waiting, and reconnect view decisions with `session.snapshot.status` switches.
Do not disconnect the store shell in any screen cleanup.

- [ ] **Step 5: Run focused session, route, Workmux, and type checks**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-route.test.ts test/integration/shell-session-controller.test.ts test/integration/shell-session-workmux.test.ts test/integration/shell-detail-workmux-control-channel.test.ts && pnpm run typecheck
```

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit the React session owner**

```bash
git add apps/mobile/src/lib/shell-controllers/session.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-session-controller.test.ts apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts
git commit -m "Compose shell screen sessions"
```

### Task 5: Replace Raw Connection and Workmux Dependencies with Session Ports

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/terminal.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal-hook-runtime.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/scrollback-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/scrollback.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-hook-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-remote-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/browser-actions-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/browser-actions.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/notifications.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/skill-selector-adapter.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/skill-selector.tsx`
- Modify: affected controller integration tests.

**Interfaces:**

- Consumes: `ShellSessionPorts` from Task 4.
- Produces: domain controller inputs that contain typed session ports and no raw
  Workmux channel or sibling-controller refs.

- [ ] **Step 1: Update controller tests first**

Change test harnesses to pass:

```ts
const ports = {
	terminalSource,
	hostCommands,
	workmux,
	diagnostics,
	activity,
};
```

Add assertions that a stale `workmux` port returns `superseded`, terminal
replacement detaches the recorded listener owner, and scrollback registers its
cleanup only while it owns remote copy mode. Add source guards that the domain
contracts do not import `WorkmuxControlChannel` or `SshShell`.

- [ ] **Step 2: Run affected suites and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-terminal-*.test.ts test/integration/shell-scrollback-*.test.ts test/integration/shell-keyboard-*.test.ts test/integration/shell-browser-actions-controller*.test.ts test/integration/shell-notifications-*.test.ts test/integration/shell-skill-selector-*.test.ts
```

Expected: the updated harnesses FAIL because controller inputs still require raw
resources.

- [ ] **Step 3: Migrate terminal and scrollback**

Replace terminal input `{ shell, transportKey }` with
`{ source: ShellTerminalSourcePort }`. Publish `runtimeInstanceId`,
`getLastSize()`, and `getSelectionModeEnabled()` from terminal-owned state.
Remove `onRuntimeChanged` from terminal hook dependencies.

Replace scrollback's `workmuxScroll` and `onTeardownCleanup` with
`workmux: ShellWorkmuxPort`. Its core registers a before-dispose callback after
remote copy mode is acknowledged and unregisters it after safe exit. The
callback calls only `retiring.exitScroll({ sessionName: ownedTarget })`.
Scrollback observes terminal runtime instance and applied selection mode through
terminal ports during `commit()`; it no longer needs screen refs.

- [ ] **Step 4: Migrate keyboard, browser, notifications, and skill selector**

Keyboard remote context receives `ShellWorkmuxPort` and the session command to
invalidate its transport. Browser actions and notifications receive
`ShellHostCommandPort`/`ShellWorkmuxPort` directly, eliminating the two
screen-level command adapters.

Change skill selector input from `sendTextRaw` on the keyboard handle to a
standalone input command built on
`scrollback.input.sendSegments([encoder.encode(value)])`. This preserves the
guarded input path while removing the skill-selector ↔ keyboard construction
cycle.

- [ ] **Step 5: Run every affected controller suite**

Run the command from Step 2 again.

Expected: all matching controller tests PASS with no unhandled rejections or
warnings.

- [ ] **Step 6: Commit the port migration**

```bash
git add apps/mobile/src/lib/shell-controllers apps/mobile/test/integration apps/mobile/src/app/shell/detail.tsx
git commit -m "Route shell controllers through session ports"
```

### Task 6: Dependency-Injected Wispr State Machine

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/wispr-core.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-tap-runner.ts`
- Create: `apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts`
- Create: `apps/mobile/test/integration/shell-wispr-controller.test.ts`
- Modify: `apps/mobile/src/lib/wispr-automation.ts`
- Modify: `apps/mobile/test/integration/wispr-automation.test.ts`

**Interfaces:**

- Consumes: existing pure Wispr reducer/policies, native automation port, text
  entry modal port, clock, pixel-ratio function, platform, and logger.
- Produces: `ShellWisprControllerCore` with one state snapshot and explicit
  commands.

- [ ] **Step 1: Write failing orchestration tests with fake time and native
      ports**

Cover this public API:

```ts
export type ShellWisprControllerCore = ControllerCore<ShellWisprSnapshot> & {
	openTextEditor(): Promise<ControllerOutcome<ShellWisprFailure>>;
	setAutoStart(enabled: boolean): void;
	onTextEntryFocused(value: string, bounds?: TextInputScreenBounds): void;
	onTextChanged(value: string): void;
	closeTextEntry(): void;
	openSettings(): Promise<ControllerOutcome<ShellWisprFailure>>;
};
```

Required tests:

- Android ready status opens text entry and auto-starts one tap.
- Unsupported platform opens text entry without a native call and publishes the
  existing disabled availability copy.
- Repeated open while `openingTextEntry`, `waitingForBubble`, or `recording` is
  ignored.
- A native tap timeout publishes the existing retryable failure and records a
  late-success close obligation.
- Closing while a start tap is in flight waits, then closes exactly the matching
  auto-start request.
- A new auto-start waits behind a prior close and resumes after that close.
- Text change after recording advances the request generation and returns idle.
- Session invalidation makes status/tap completions silent.
- `dispose()` clears every owned timer, invalidates requests, closes an
  auto-started control with bounded non-retrying cleanup, and is idempotent.

- [ ] **Step 2: Run the controller tests and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-wispr-controller.test.ts
```

Expected: FAIL because `wispr-core.ts` does not exist.

- [ ] **Step 3: Define the snapshot and dependency ports**

```ts
export type ShellWisprSnapshot = {
	autoStartEnabled: boolean;
	availability: WisprTextEditorAvailability;
	automation: WisprAutomationState;
	control: TextEntryWisprControl;
	busy: boolean;
};

export type ShellWisprNativePort = {
	getStatus(): Promise<{ serviceEnabled: boolean; serviceConnected: boolean }>;
	tapControl(): Promise<unknown>;
	tapScreen(x: number, y: number): Promise<unknown>;
	openSettings(): Promise<unknown>;
};

export type ShellWisprModalPort = {
	isOpen(): boolean;
	open(): void;
	close(): void;
};
```

Inject `now`, `setTimeout`, `clearTimeout`, `sleep`, `pixelRatio`, `platformOS`,
and logger. Keep all existing durations unchanged: retry window 2500 ms, retry
interval 200 ms, tap timeout 750 ms, pending close expiry 5000 ms, and opening
fallback 750 ms.

- [ ] **Step 4: Implement the focused tap and close units**

`wispr-tap-runner.ts` exports:

```ts
export type WisprTapResult =
	| { status: 'completed' }
	| { status: 'superseded' }
	| {
			status: 'failed';
			reason: WisprAutomationFailureReason;
			message: string;
			timedOut: boolean;
	  };

export type WisprTapRunner = {
	run(input: {
		retry: boolean;
		isCurrent(): boolean;
		onLateSuccess?(): void;
		onLateFailure?(): void;
	}): Promise<WisprTapResult>;
};
```

It composes `tapWisprControlWithTimeout`, stops retrying after a timeout because
the native tap may still finish, and checks `isCurrent()` before and after every
await.

`wispr-close-coordinator.ts` exports:

```ts
export type WisprCloseCoordinator = {
	requestAfterStart(request: WisprPendingAutoCloseRequest): void;
	consumeStartResult(requestId: number, started: boolean): boolean;
	blocksAutoStart(): boolean;
	deferAutoStart(requestId: number): void;
	takeDeferredAutoStart(): number | null;
	invalidate(): void;
	dispose(): void;
};
```

It owns the pending-request map and expiry timers. It invokes an injected
`close(retry)` command, releases a deferred start only after successful bounded
close, and clears every timer in `dispose()`.

- [ ] **Step 5: Move orchestration into the core**

Compose the existing pure functions instead of duplicating them. Store request
generation, current text, start markers, pending-close records, in-flight close
count, and timer handles as private core variables. Every async continuation
checks its captured generation before publishing or calling a follow-up native
operation. `publish()` derives `control` with `resolveTextEntryWisprControl()`
and `busy` with `isWisprAutomationBusy()`.

Use one `dispose()` path; do not preserve `cleanup...Ref`,
`flushDeferred...Ref`, or callbacks assigned during render.

- [ ] **Step 6: Run pure helper and controller suites**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/wispr-automation.test.ts test/integration/shell-wispr-controller.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the Wispr core**

```bash
git add apps/mobile/src/lib/shell-controllers/wispr-core.ts apps/mobile/src/lib/shell-controllers/wispr-tap-runner.ts apps/mobile/src/lib/shell-controllers/wispr-close-coordinator.ts apps/mobile/src/lib/wispr-automation.ts apps/mobile/test/integration/wispr-automation.test.ts apps/mobile/test/integration/shell-wispr-controller.test.ts
git commit -m "Own Wispr automation state"
```

### Task 7: Wispr Hook and Text-Entry Integration

**Files:**

- Create: `apps/mobile/src/lib/shell-controllers/wispr.tsx`
- Modify:
  `apps/mobile/src/app/shell/detail.tsx:596-1364,1466-1587,1750-1759,1897-1908`
- Modify: `apps/mobile/src/lib/shell-controllers/simple-modals.tsx`
- Modify: `apps/mobile/test/integration/shell-wispr-controller.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-modal-controller-composition.test.ts`

**Interfaces:**

- Consumes: `ShellWisprControllerCore`, `wisprAutomationNative`, activity,
  platform, PixelRatio, text-entry modal commands, and logger.
- Produces: `useShellWisprController(): ShellWisprControllerHandle`.

- [ ] **Step 1: Add failing composition guards**

Assert that `detail.tsx` calls `useShellWisprController()` once and contains
none of these names:

```text
wisprAutomationRequestIdRef
wisprTextEntryCloseAfterStartRequestsRef
wisprPendingAutoCloseTimeoutsRef
wisprAutoCloseInFlightTimeoutsRef
wisprDeferredAutoStartRequestIdRef
wisprOpeningTimeoutRef
cleanupWisprTextEntryOnUnmountRef
tapWisprControlWithinRetryWindow
consumeWisprAutoCloseDecision
```

Assert that native Wispr methods appear only in `wispr.tsx` and the injected
native adapter, never `detail.tsx`.

- [ ] **Step 2: Run Wispr composition tests and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-wispr-controller.test.ts test/integration/shell-modal-controller-composition.test.ts
```

Expected: FAIL because inline Wispr ownership remains.

- [ ] **Step 3: Implement the thin hook**

Expose:

```ts
export type ShellWisprControllerHandle = {
	snapshot: ShellWisprSnapshot;
	openTextEditor(): void;
	textEntryProps: {
		wisprMode: boolean;
		wisprControl: TextEntryWisprControl;
		onWisprSetup(): void;
		onWisprAutoStartChange(enabled: boolean): void;
		onWisprFocus(value: string, bounds?: TextInputScreenBounds): void;
		onValueChange(value: string): void;
		onClose(): void;
	};
	invalidate(reason: ControllerInvalidationReason): void;
};
```

Create the core once with `useState`, publish through `useSyncExternalStore`,
update activity/session generation in a layout effect, and call replay-safe
disposal in a passive effect. The hook contains native/platform adaptation but
no second request, retry, timer, or cleanup protocol.

- [ ] **Step 4: Remove text-entry `openRef`**

Delete `TextEntryModalHandle.openRef` and
`textEntryOpenRef.current = snapshot.textEntry`. Give the Wispr core a modal
port whose `isOpen()` reads `simpleModalsCore.getSnapshot().textEntry`; expose a
stable getter from the simple-modals handle rather than a React ref. All open
and close commands update the core before dependent Wispr decisions run.

- [ ] **Step 5: Replace inline Wispr code in `detail.tsx`**

Construct Wispr after simple modals and before keyboard modal commands. Pass
`wispr.openTextEditor` directly to keyboard modal commands and spread
`wispr.textEntryProps` into `TextEntryModal`. Delete the constants, helper
callbacks, refs, render assignments, native calls, and cleanup effect that moved
to the controller.

- [ ] **Step 6: Run Wispr, modal, formatting, and type checks**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/wispr-automation.test.ts test/integration/shell-wispr-controller.test.ts test/integration/shell-modal-controller-composition.test.ts && pnpm run fmt:check && pnpm run typecheck
```

Expected: tests PASS; formatting and typecheck exit 0.

- [ ] **Step 7: Commit the Wispr hook extraction**

```bash
git add apps/mobile/src/lib/shell-controllers/wispr.tsx apps/mobile/src/lib/shell-controllers/simple-modals.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-wispr-controller.test.ts apps/mobile/test/integration/shell-modal-controller-composition.test.ts
git commit -m "Extract shell Wispr controller"
```

### Task 8: Delete Fake Dependencies, Late Bindings, and Render Mutations

**Files:**

- Delete: `apps/mobile/src/app/shell/shell-keyboard-composition.ts`
- Delete:
  `apps/mobile/test/integration/shell-keyboard-controller-composition.test.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-hook-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Modify: `apps/mobile/src/lib/use-connection-debug-command.ts`
- Modify: `apps/mobile/test/integration/shell-keyboard-hook-composition.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-terminal-controller-composition.test.ts`
- Modify:
  `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`

**Interfaces:**

- Consumes: current controller handles and typed session ports.
- Produces: direct keyboard inputs, explicit modal commands, and discriminated
  diagnostic delivery with no publication shim.

- [ ] **Step 1: Write failing boundary assertions**

Assert that the app has no `shell-keyboard-composition.ts` and that `detail.tsx`
contains none of:

```text
createShellDetailKeyboardControllerInput
createShellDetailKeyboardLateBindings
createShellDetailKeyboardAuthorityRuntime
createShellDetailKeyboardCommitPublication
scrollbackRuntimeChangedRef.current =
terminalSizeSnapshotRef.current =
autoWisprEnabledRef.current =
configureScrollTraceEnabled(scrollTraceEnabled) // outside an effect
void normalizedTmuxTarget
ignoreDiagnosticTerminalPaste
```

- [ ] **Step 2: Run boundary tests and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-hook-composition.test.ts test/integration/shell-terminal-controller-composition.test.ts test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: FAIL on the old shim and render mutations.

- [ ] **Step 3: Break the construction cycles directly**

Construct controllers in this order:

```text
activity -> session -> modal arbiter/simple modals -> terminal -> scrollback
-> browser/feature/Wispr -> skill selector -> modal commands -> keyboard
```

Skill insertion uses the standalone guarded scrollback text port from Task 5.
Wispr and skill selector therefore exist before keyboard modal commands, so
those commands receive real `open`/`close` functions at construction. Pass the
keyboard hook its final typed input directly; its own committed-port adapter
already reads current ports and owns invalidation.

- [ ] **Step 4: Remove runtime and size refs**

Have scrollback reconcile `terminal.runtimeInstanceId` from its input and have
keyboard read runtime identity from `terminal.view`. Use
`terminal.getLastSize()` in the manual fit runner. Move scroll trace global
configuration into a passive effect keyed by `scrollTraceEnabled`.

- [ ] **Step 5: Replace the diagnostic no-op dependency**

Change `UseConnectionDebugCommandArgs` to:

```ts
type DiagnosticDelivery =
	| { type: 'clipboard-only' }
	| { type: 'terminal'; paste(value: string): void };

export type UseConnectionDebugCommandArgs = {
	appActive: boolean;
	closeMenu(): void;
	delivery: DiagnosticDelivery;
};
```

Map it internally to `allowTerminalPaste` and `pasteIntoTerminal` only at the
`runConnectionDebugCommand` boundary. `detail.tsx` passes
`delivery: { type: 'clipboard-only' }`; it does not create a no-op callback.

- [ ] **Step 6: Delete the shim and run affected tests**

Delete `shell-keyboard-composition.ts` and its shim-only test. Rewrite remaining
source contracts to assert direct typed inputs and current ports, then run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-keyboard-*.test.ts test/integration/shell-terminal-*.test.ts test/integration/shell-scrollback-*.test.ts test/integration/connection-diagnostic-*.test.ts test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: all matching tests PASS.

- [ ] **Step 7: Commit cycle and fake-dependency removal**

```bash
git add apps/mobile/src/app/shell apps/mobile/src/lib/shell-controllers apps/mobile/src/lib/use-connection-debug-command.ts apps/mobile/test/integration
git commit -m "Remove shell composition shims"
```

### Task 9: Real Rendering Boundary and Enforced Size Limits

**Files:**

- Create: `apps/mobile/src/app/shell/ShellScreenView.tsx`
- Create: `apps/mobile/test/integration/shell-detail-boundary.test.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: every existing integration test that reads `detail.tsx`

**Interfaces:**

- Consumes: grouped terminal, scrollback, keyboard, modal, session, and Wispr
  view models.
- Produces: `ShellScreenView` with the actual JSX tree and a small `ShellDetail`
  composition root.

- [ ] **Step 1: Write the failing final boundary test**

Read the route and view files and assert:

```ts
import ts from 'typescript';

function countNonblankLines(source: string): number {
	return source.split('\n').filter((line) => line.trim().length > 0).length;
}

function countFunctionLines(source: string, name: string): number {
	const file = ts.createSourceFile(
		'detail.tsx',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	let match: ts.FunctionDeclaration | null = null;
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === name)
			match = node;
		ts.forEachChild(node, visit);
	};
	visit(file);
	assert.ok(match, `missing function ${name}`);
	const start = file.getLineAndCharacterOfPosition(match.getStart(file)).line;
	const end = file.getLineAndCharacterOfPosition(match.getEnd()).line;
	return end - start + 1;
}

assert.ok(countFunctionLines(detailSource, 'ShellDetail') < 300);
assert.ok(countNonblankLines(detailSource) < 650);
assert.match(detailSource, /useShellSessionController/);
assert.match(detailSource, /useShellWisprController/);
assert.match(detailSource, /<ShellScreenView/);
assert.doesNotMatch(
	detailSource,
	/setTimeout|clearTimeout|\.current\s*=|createWorkmuxControlChannel|wisprAutomationNative|useSshStore|useAutoConnectStore/,
);
assert.match(viewSource, /<XtermJsWebView/);
assert.match(viewSource, /<TerminalKeyboard/);
assert.match(viewSource, /<TextEntryModal/);
assert.doesNotMatch(
	viewSource,
	/useShell\w+Controller|useSshStore|useAutoConnectStore/,
);
```

Also assert that `ShellScreenView` has real JSX and does not return one child
with an unchanged `{...props}` spread.

- [ ] **Step 2: Run the boundary test and verify RED**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-detail-boundary.test.ts
```

Expected: FAIL because the route file remains above the limits and the view does
not exist.

- [ ] **Step 3: Move view code without moving workflow ownership**

Move `RouteSkeleton`, tmux attach error rendering, terminal error boundary,
terminal/WebView JSX, scrollback jump button, reconnect overlay, keyboard flash,
and all modal JSX into focused view components. `ShellScreenView` receives
grouped view models and callbacks that already belong to controllers. It may use
theme, safe-area, dimensions, and platform rendering hooks, but no stores,
controller hooks, timers, or transport/native APIs.

- [ ] **Step 4: Reduce `ShellDetail` to composition**

Keep only route request input, theme-independent controller construction,
session-state selection, direct port wiring, and one `ShellScreenView` return.
Extract real policy or rendering units instead of creating functions that merely
rename props or forward one call.

- [ ] **Step 5: Rewrite brittle source-regex tests**

Move behavioral assertions into route/session/Workmux/Wispr/controller tests.
Keep one source-boundary suite for forbidden ownership and size only. Update:

```text
shell-activity-notifications-composition.test.ts
shell-detail-workmux-control-channel.test.ts
shell-modal-controller-composition.test.ts
shell-modals-detected-open-picker-props.test.ts
shell-scrollback-controller-composition.test.ts
shell-terminal-controller-composition.test.ts
tailscale-recovery-ui-placement.test.ts
```

Each retained test must inspect the new owner file, not search `detail.tsx` for
implementation internals.

- [ ] **Step 6: Run the complete shell-focused integration group**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-*.test.ts test/integration/wispr-automation.test.ts test/integration/workmux-*.test.ts test/integration/terminal-*.test.ts test/integration/tmux-scrollback-*.test.ts
```

Expected: all matching tests PASS.

- [ ] **Step 7: Measure and commit the rendering boundary**

Run:

```bash
cd apps/mobile && awk 'NF { count += 1 } END { print count }' src/app/shell/detail.tsx
```

Expected: a number below 650. The boundary test separately proves the
`ShellDetail` function is below 300 lines.

```bash
git add apps/mobile/src/app/shell apps/mobile/test/integration
git commit -m "Reduce shell detail to composition"
```

### Task 10: Full Verification, Preview Check, and Maintainability Gate

**Files:**

- Verify: every file changed by Tasks 1-9.

**Interfaces:**

- Consumes: completed implementation.
- Produces: fresh automated, source-boundary, preview, and maintainability
  evidence.

- [ ] **Step 1: Run forbidden-pattern and size gates**

Run:

```bash
cd apps/mobile && ! rg -n "createShellDetailKeyboard|ShellDetailKeyboardLateBindings|void normalizedTmuxTarget|ignoreDiagnosticTerminalPaste|wisprAutomationNative|useSshStore|useAutoConnectStore|\.current\s*=" src/app/shell/detail.tsx && test "$(awk 'NF { count += 1 } END { print count }' src/app/shell/detail.tsx)" -lt 650
```

Expected: no matches and exit 0.

- [ ] **Step 2: Run focused ownership tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-route.test.ts test/integration/shell-session-controller.test.ts test/integration/shell-session-workmux.test.ts test/integration/shell-wispr-controller.test.ts test/integration/shell-detail-boundary.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run the complete mobile static and integration gate**

Run:

```bash
cd apps/mobile && pnpm run fmt:check && pnpm run lint:check && pnpm run typecheck && pnpm run test:integration
```

Expected: every command exits 0 with no test failures or unhandled warnings.

- [ ] **Step 4: Run repository duplicate and cross-package checks**

Run:

```bash
pnpm exec turbo lint:check
```

Expected: Turbo, syncpack, and jscpd checks exit 0.

- [ ] **Step 5: Run the thermo-nuclear maintainability review**

Invoke `$thermo-nuclear-code-quality-review` on the complete diff. The review
must confirm:

- no giant replacement session or Wispr file;
- no pass-through facade or one-field adapter chain;
- no controller imports a sibling controller;
- no render-time mutation or fake dependency remains;
- all lifecycle resources have one creator and disposer;
- branching state is represented by discriminated unions rather than growing
  boolean combinations.

Fix every blocker through a new RED-GREEN cycle, then rerun Steps 1-4.

- [ ] **Step 6: Build and check an Android preview without clearing data**

Run:

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Install only through the existing signing lane for `com.finalapp.vibe2`. Verify
route error Back behavior, terminal attach/reload, reconnect overlay, Workmux
navigation and scrollback cleanup, keyboard input, skill insertion, Wispr
auto-start/close/failure/settings, and screen leave/re-entry without losing the
live SSH connection. Do not uninstall, clear data, or use the destructive e2e
command.

- [ ] **Step 7: Record final evidence and commit review fixes**

If the maintainability or preview gates required changes, commit them with their
new tests:

```bash
git add apps/mobile
git commit -m "Harden shell runtime ownership"
```

Record the exact test counts, final nonblank line count, preview artifact path,
manual observations, and thermo-nuclear review result in the pull request.
