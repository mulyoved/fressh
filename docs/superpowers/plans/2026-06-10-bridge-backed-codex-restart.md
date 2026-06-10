# Bridge-Backed Codex Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile `restart codex` execute through the existing persistent `mdev bridge` channel instead of pasting command text into the active terminal.

**Architecture:** Add a structured command-menu `bridge` entry type, add a focused Codex restart runner that resolves the active Workmux target and sends `codex.restart` through `WorkmuxControlChannel.operation`, and wire both mobile entry points to that same path. This repository does not contain the remote `mdev` CLI, so this plan implements the mobile client and tests old-remote failure behavior; remote `codex.restart` bridge support is an external prerequisite.

**Tech Stack:** Expo React Native, TypeScript, Zod, `node:test` via `tsx`, existing persistent `mdev bridge --jsonl` mobile client.

---

## Scope Check

The approved spec includes two subsystems:

- Fressh mobile client changes in this repository.
- Remote `mdev` CLI bridge support for `codex.restart`, which is not present in this repository.

This plan implements only the mobile client. The mobile implementation is still testable on its own because the bridge client is already abstracted and integration tests can simulate successful and unsupported `codex.restart` bridge responses. Remote `mdev` bridge support must be implemented in the `mdev` CLI repository before the feature succeeds against a real device.

## File Structure

- Modify `apps/mobile/src/lib/shell-config.ts`
  - Owns runtime shell config types and Zod validation.
  - Add `CommandBridgeEntry`, a bridge operation allowlist, and recursive bridge-entry validation.
- Modify `apps/mobile/test/integration/shell-config-schema.test.ts`
  - Adds red/green schema coverage for supported and unsupported bridge command entries.
- Modify `apps/mobile/src/lib/command-menu-selection.ts`
  - Dispatches bridge entries without treating them as terminal presets.
- Modify `apps/mobile/test/integration/command-menu-selection.test.ts`
  - Covers bridge dispatch order and proves terminal preset selection is not called.
- Modify `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`
  - Accepts and passes an `onBridge` handler to the pure selection helper.
- Modify `apps/mobile/src/lib/workmux-bridge-operations.ts`
  - Adds `CODEX_RESTART_BRIDGE_OPERATION` and `buildCodexRestartBridgeOperation`.
  - Keeps the baseline required bridge operation list unchanged so older remotes do not break unrelated Workmux navigation at startup.
- Modify `apps/mobile/test/integration/workmux-bridge-operations.test.ts`
  - Covers the new operation builder and confirms `codex.restart` is not globally required.
- Modify `apps/mobile/src/lib/workmux-control-channel.ts`
  - Adds `operation(request, options)` for direct structured bridge operations.
  - Keeps `command(argv, options)` for argv-mapped Workmux commands.
- Modify `apps/mobile/test/integration/workmux-control-channel.test.ts`
  - Covers direct structured operation routing, missing connection, and disposed-channel behavior.
- Create `apps/mobile/src/lib/codex-restart.ts`
  - Pure restart orchestration: preconditions, context lookup, target extraction, restart operation, and failure formatting.
- Create `apps/mobile/test/integration/codex-restart.test.ts`
  - Tests success, no-Workmux failure, bad context failure, unsupported remote bridge failure, and no terminal-write dependency.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Adds `RESTART_CODEX` action id and delegates it to `ActionContext.restartCodex`.
- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Covers `RESTART_CODEX` action dispatch and exported supported-action ids.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Wires `restartCodexWithBridge` into the action context.
  - Adds a bridge command-menu handler that runs the same restart function.
- Modify `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`
  - Already listed above; this file changes with command-menu dispatch.
- Modify `apps/mobile/config/shell-config.json`
  - Converts `mdev > restart codex` from `preset` to `bridge`.
  - Converts `tmux_keyboard` `Restart` from raw bytes to `RESTART_CODEX` action.
- Modify `apps/mobile/test/integration/command-menu.test.ts`
  - Updates command tree and restart assertions.
- Modify `apps/mobile/test/integration/keyboard-config.test.ts`
  - Asserts the bundled tmux keyboard restart key is an action, not raw bytes.
- Modify `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`
  - Adds source-level wiring checks for the restart runner and bridge handler.

## External Prerequisite

Before this feature succeeds against a real remote host, the remote `mdev bridge`
must accept:

```json
{
	"type": "operation",
	"operation": "codex.restart",
	"params": { "target": "main:@12" }
}
```

and run the same behavior as:

```sh
mdev codex restart main:@12
```

The mobile client must not send the shell command string through the bridge and
must not paste it into the active terminal as a fallback.

---

### Task 1: Add Bridge Entries To Command Menu Config

**Files:**
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`
- Modify: `apps/mobile/src/lib/shell-config.ts`

- [ ] **Step 1: Write failing schema tests**

Append these tests to `apps/mobile/test/integration/shell-config-schema.test.ts`:

```ts
void test('runtime shell config accepts command menu bridge entries', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'bridge',
			label: 'restart codex',
			operation: 'codex.restart',
			timeoutMs: 10_000,
		},
	];

	const parsed = parseShellConfigData(config);

	assert.deepEqual(parsed.commandMenus, [
		{
			type: 'bridge',
			label: 'restart codex',
			operation: 'codex.restart',
			timeoutMs: 10_000,
		},
	]);
});

void test('runtime shell config rejects unsupported command menu bridge operations', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'submenu',
			label: 'mdev',
			entries: [
				{
					type: 'bridge',
					label: 'Broken',
					operation: 'host.shell',
				},
			],
		},
	];

	assert.throws(() => parseShellConfigData(config), /Unsupported command menu bridge operation host\.shell/);
});
```

- [ ] **Step 2: Run the focused schema test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-config-schema.test.ts
```

Expected: FAIL because `commandMenuEntrySchema` does not accept `type: 'bridge'`.

- [ ] **Step 3: Add bridge entry types**

In `apps/mobile/src/lib/shell-config.ts`, after `export type CommandActionEntry`, add:

```ts
export const COMMAND_BRIDGE_OPERATION_IDS = ['codex.restart'] as const;

export type CommandBridgeOperationId =
	(typeof COMMAND_BRIDGE_OPERATION_IDS)[number];

export type CommandBridgeEntry = {
	type: 'bridge';
	label: string;
	operation: CommandBridgeOperationId;
	timeoutMs?: number;
};
```

Then replace:

```ts
export type CommandMenuEntry =
	| CommandPreset
	| CommandMenu
	| CommandActionEntry;
```

with:

```ts
export type CommandMenuEntry =
	| CommandPreset
	| CommandMenu
	| CommandActionEntry
	| CommandBridgeEntry;
```

- [ ] **Step 4: Add bridge entry schema**

In `apps/mobile/src/lib/shell-config.ts`, after `const commandActionEntrySchema = ...`, add:

```ts
const commandBridgeOperationSchema = z.custom<CommandBridgeOperationId>(
	(value) => typeof value === 'string' && value.length > 0,
	{ message: 'Bridge operation must be a non-empty string' },
);

const commandBridgeEntrySchema = z.object({
	type: z.literal('bridge'),
	label: z.string().min(1),
	operation: commandBridgeOperationSchema,
	timeoutMs: z.number().int().positive().optional(),
});
```

Then replace the command menu discriminated union with:

```ts
const commandMenuEntrySchema: z.ZodType<CommandMenuEntry> = z.lazy(() =>
	z.discriminatedUnion('type', [
		commandPresetSchema,
		commandActionEntrySchema,
		commandBridgeEntrySchema,
		z.object({
			type: z.literal('submenu'),
			label: z.string().min(1),
			entries: z.array(commandMenuEntrySchema),
		}),
	]),
);
```

- [ ] **Step 5: Add recursive bridge operation validation**

In `apps/mobile/src/lib/shell-config.ts`, after:

```ts
const supportedActionIds = new Set<string>(CONFIG_SUPPORTED_ACTION_IDS);
const keyboardTargetActionIds = new Set<string>(KEYBOARD_TARGET_ACTION_IDS);
```

add:

```ts
const commandBridgeOperationIds = new Set<string>(COMMAND_BRIDGE_OPERATION_IDS);
```

Then in `validateCommandMenuEntryReferences`, after the action validation block and before the submenu recursion, add:

```ts
	if (
		entry.type === 'bridge' &&
		!commandBridgeOperationIds.has(entry.operation)
	) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: [...path, 'operation'],
			message: `Unsupported command menu bridge operation ${entry.operation}`,
		});
		return;
	}
```

- [ ] **Step 6: Run the schema test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-config-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/shell-config.ts apps/mobile/test/integration/shell-config-schema.test.ts
git commit -m "Add bridge command menu schema"
```

---

### Task 2: Dispatch Bridge Command Menu Entries

**Files:**
- Modify: `apps/mobile/test/integration/command-menu-selection.test.ts`
- Modify: `apps/mobile/src/lib/command-menu-selection.ts`
- Modify: `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`

- [ ] **Step 1: Write failing command-menu selection test**

Append this test to `apps/mobile/test/integration/command-menu-selection.test.ts`:

```ts
void test('command menu selection dispatch closes before bridge entries', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'bridge',
		label: 'restart codex',
		operation: 'codex.restart',
		timeoutMs: 10_000,
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
		onBridge: (bridgeEntry) =>
			calls.push(
				`bridge:${bridgeEntry.label}:${bridgeEntry.operation}:${bridgeEntry.timeoutMs}`,
			),
	});

	assert.deepEqual(calls, ['close', 'bridge:restart codex:codex.restart:10000']);
});
```

- [ ] **Step 2: Run the selection test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu-selection.test.ts
```

Expected: FAIL because `onBridge` is not part of `CommandMenuSelectionDispatchHandlers` and `bridge` is not handled.

- [ ] **Step 3: Update the selection helper**

In `apps/mobile/src/lib/command-menu-selection.ts`, update the imports to include `CommandBridgeEntry`:

```ts
import { type ActionId } from '@/lib/keyboard-actions';
import {
	type CommandBridgeEntry,
	type CommandMenu,
	type CommandMenuEntry,
	type CommandPreset,
} from '@/lib/shell-config';
```

Update `CommandMenuSelectionDispatchHandlers` to:

```ts
export type CommandMenuSelectionDispatchHandlers = {
	onSubmenu: (menu: CommandMenu) => void;
	onPreset: (preset: CommandPreset) => void;
	onClose: () => void;
	onAction: (actionId: ActionId) => void;
	onBridge: (entry: CommandBridgeEntry) => void;
};
```

Add this switch case after the `action` case:

```ts
		case 'bridge':
			handlers.onClose();
			handlers.onBridge(entry);
			return;
```

- [ ] **Step 4: Update existing selection tests to pass `onBridge`**

In each existing `dispatchCommandMenuSelection` call in `apps/mobile/test/integration/command-menu-selection.test.ts`, add this handler:

```ts
onBridge: (entry) => calls.push(`bridge:${entry.label}`),
```

- [ ] **Step 5: Update `CommandMenuModal` props**

In `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`, update the imports from `shell-config` to include `CommandBridgeEntry`:

```ts
import {
	type CommandBridgeEntry,
	type CommandMenu,
	type CommandMenuEntry,
	type CommandPreset,
} from '@/lib/shell-config';
```

Update the function signature destructuring:

```ts
export function CommandMenuModal({
	open,
	entries,
	bottomOffset,
	onClose,
	onSelect,
	onAction,
	onBridge,
}: {
	open: boolean;
	entries: CommandMenuEntry[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
	onAction: (actionId: ActionId) => void;
	onBridge: (entry: CommandBridgeEntry) => void;
}) {
```

Then add `onBridge` to the `dispatchCommandMenuSelection` handlers:

```ts
			onBridge,
```

- [ ] **Step 6: Run the selection test and TypeScript**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu-selection.test.ts
cd apps/mobile && pnpm exec tsc --noEmit
```

Expected: the selection test passes; TypeScript may fail at `CommandMenuModal` call sites until Task 5 wires `onBridge`. If `tsc --noEmit` fails only for missing `onBridge` props, proceed to the next task and do not commit yet.

- [ ] **Step 7: Commit if TypeScript is clean**

If TypeScript is clean after this task:

```bash
git add apps/mobile/src/lib/command-menu-selection.ts apps/mobile/test/integration/command-menu-selection.test.ts apps/mobile/src/app/shell/components/CommandMenuModal.tsx
git commit -m "Dispatch bridge command menu entries"
```

If TypeScript fails because `CommandMenuModal` call sites need `onBridge`, defer this commit and include these files in the Task 5 commit.

---

### Task 3: Add Structured Codex Restart Bridge Operation

**Files:**
- Modify: `apps/mobile/test/integration/workmux-bridge-operations.test.ts`
- Modify: `apps/mobile/test/integration/workmux-control-channel.test.ts`
- Modify: `apps/mobile/src/lib/workmux-bridge-operations.ts`
- Modify: `apps/mobile/src/lib/workmux-control-channel.ts`

- [ ] **Step 1: Write failing bridge operation tests**

In `apps/mobile/test/integration/workmux-bridge-operations.test.ts`, update the first test so the expected required operations remain exactly:

```ts
	assert.deepEqual(WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS, [
		'tmux.app.context',
		'tmux.app.window',
		'tmux.app.focus',
		'tmux.app.nav',
		'tmux.app.notification.open',
		'tmux.nav',
	]);
	assert.equal(
		WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS.includes(
			'codex.restart' as (typeof WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS)[number],
		),
		false,
	);
```

Then add imports:

```ts
	buildCodexRestartBridgeOperation,
	CODEX_RESTART_BRIDGE_OPERATION,
```

Append these tests:

```ts
void test('builds Codex restart bridge operation', () => {
	assert.equal(CODEX_RESTART_BRIDGE_OPERATION, 'codex.restart');
	assert.deepEqual(buildCodexRestartBridgeOperation('main:@12'), {
		operation: 'codex.restart',
		params: { target: 'main:@12' },
	});
});

void test('rejects blank Codex restart target locally', () => {
	assert.throws(
		() => buildCodexRestartBridgeOperation('   '),
		/Invalid Codex restart target/,
	);
});
```

- [ ] **Step 2: Write failing Workmux control channel tests**

Append these tests to `apps/mobile/test/integration/workmux-control-channel.test.ts`:

```ts
void test('WorkmuxControlChannel.operation routes structured bridge operations, preserving timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: createFakeConnection(),
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.operation(
		{ operation: 'codex.restart', params: { target: 'main:@12' } },
		{ timeoutMs: 4321 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'codex.restart',
			params: { target: 'main:@12' },
			timeoutMs: 4321,
		},
	]);
});

void test('WorkmuxControlChannel.operation rejects missing connection locally', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => {
				throw new Error('DirectMux transport should not be used');
			},
			dispose: async () => {},
		},
	});

	assert.deepEqual(
		await channel.operation({
			operation: 'codex.restart',
			params: { target: 'main:@12' },
		}),
		{
			success: false,
			output: '',
			error: 'No SSH connection available.',
		},
	);
	assert.deepEqual(bridge.calls, []);
});
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/workmux-bridge-operations.test.ts test/integration/workmux-control-channel.test.ts
```

Expected: FAIL because the operation builder and `WorkmuxControlChannel.operation` do not exist.

- [ ] **Step 4: Add the Codex restart bridge builder**

In `apps/mobile/src/lib/workmux-bridge-operations.ts`, after `WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS`, add:

```ts
export const CODEX_RESTART_BRIDGE_OPERATION = 'codex.restart' as const;
```

After `parseSelectIndex`, add:

```ts
function requireNonEmptyText(value: string, message: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(message);
	return trimmed;
}

export function buildCodexRestartBridgeOperation(
	target: string,
): MdevBridgeOperationRequest {
	return {
		operation: CODEX_RESTART_BRIDGE_OPERATION,
		params: {
			target: requireNonEmptyText(target, 'Invalid Codex restart target.'),
		},
	};
}
```

- [ ] **Step 5: Add direct operation support to Workmux control channel**

In `apps/mobile/src/lib/workmux-control-channel.ts`, update the import from `workmux-bridge-operations`:

```ts
import {
	type MdevBridgeOperationRequest,
	WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
	buildMdevBridgeOperationFromWorkmuxArgv,
} from './workmux-bridge-operations';
```

Update `WorkmuxControlChannel`:

```ts
export type WorkmuxControlChannel = {
	command: (
		argv: string[],
		options?: WorkmuxControlCommandOptions,
	) => Promise<WorkmuxControlCommandResult>;
	operation: (
		request: MdevBridgeOperationRequest,
		options?: WorkmuxControlCommandOptions,
	) => Promise<WorkmuxControlCommandResult>;
	scroll: {
		enter: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
		move: (input: WorkmuxScrollMove) => Promise<WorkmuxControlCommandResult>;
		exit: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
	};
	dispose: () => Promise<void>;
};
```

Inside `createWorkmuxControlChannel`, before `return {`, add:

```ts
	const runBridgeOperation = (
		request: MdevBridgeOperationRequest,
		options?: WorkmuxControlCommandOptions,
	): Promise<WorkmuxControlCommandResult> => {
		if (disposed) {
			return Promise.resolve(
				failureResult('Workmux control channel disposed.'),
			);
		}
		if (!connection) {
			return Promise.resolve(failureResult('No SSH connection available.'));
		}
		if (!resolvedBridgeClient) {
			return Promise.resolve(failureResult('No SSH connection available.'));
		}
		return resolvedBridgeClient.runOperation({
			operation: request.operation,
			params: request.params,
			timeoutMs:
				options?.timeoutMs ?? DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
		});
	};
```

Then replace the `command` implementation with:

```ts
		command: (argv, options) => {
			if (disposed) {
				return Promise.resolve(
					failureResult('Workmux control channel disposed.'),
				);
			}
			if (!connection) {
				return Promise.resolve(failureResult('No SSH connection available.'));
			}
			try {
				return runBridgeOperation(
					buildMdevBridgeOperationFromWorkmuxArgv(argv),
					options,
				);
			} catch (error) {
				return Promise.resolve(
					failureResult(error instanceof Error ? error.message : String(error)),
				);
			}
		},
		operation: runBridgeOperation,
```

- [ ] **Step 6: Run focused tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/workmux-bridge-operations.test.ts test/integration/workmux-control-channel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/workmux-bridge-operations.ts apps/mobile/test/integration/workmux-bridge-operations.test.ts apps/mobile/src/lib/workmux-control-channel.ts apps/mobile/test/integration/workmux-control-channel.test.ts
git commit -m "Add structured Codex restart bridge operation"
```

---

### Task 4: Add Codex Restart Runner

**Files:**
- Create: `apps/mobile/src/lib/codex-restart.ts`
- Create: `apps/mobile/test/integration/codex-restart.test.ts`

- [ ] **Step 1: Write failing restart runner tests**

Create `apps/mobile/test/integration/codex-restart.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { MDEV_BRIDGE_UPDATE_MESSAGE } from '../../src/lib/mdev-bridge-client';
import {
	CODEX_RESTART_WORKMUX_DISABLED_MESSAGE,
	restartCodexWithBridge,
} from '../../src/lib/codex-restart';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

const contextOutput = JSON.stringify({
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 1,
	windowName: 'codex',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	paneId: '%34',
	paneTty: '/dev/pts/12',
	panePath: '/home/muly/fressh',
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
});

void test('restartCodexWithBridge resolves context and sends codex restart operation', async () => {
	const workmuxCalls: { argv: string[]; timeoutMs: number }[] = [];
	const operationCalls: {
		operation: string;
		params: Record<string, unknown>;
		timeoutMs: number;
	}[] = [];
	const failures: string[] = [];

	const result = await restartCodexWithBridge({
		tmuxEnabled: true,
		sessionName: ' main ',
		runWorkmuxCommand: async (argv, timeoutMs) => {
			workmuxCalls.push({ argv, timeoutMs });
			return { success: true, output: `${contextOutput}\n` };
		},
		runBridgeOperation: async (request, timeoutMs) => {
			operationCalls.push({
				operation: request.operation,
				params: request.params,
				timeoutMs,
			});
			return { success: true, output: '' };
		},
		showFailure: (message) => failures.push(message),
	});

	assert.deepEqual(result, { status: 'handled' });
	assert.deepEqual(workmuxCalls, [
		{
			argv: ['tmux', 'app', 'context', '--session', 'main'],
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(operationCalls, [
		{
			operation: 'codex.restart',
			params: { target: 'main:@12' },
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(failures, []);
});

void test('restartCodexWithBridge rejects disabled Workmux before bridge calls', async () => {
	const failures: string[] = [];

	const result = await restartCodexWithBridge({
		tmuxEnabled: false,
		sessionName: 'main',
		runWorkmuxCommand: async () => {
			throw new Error('context should not be requested');
		},
		runBridgeOperation: async () => {
			throw new Error('restart should not be requested');
		},
		showFailure: (message) => failures.push(message),
	});

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(failures, [CODEX_RESTART_WORKMUX_DISABLED_MESSAGE]);
});

void test('restartCodexWithBridge formats old context command failures', async () => {
	const failures: string[] = [];

	const result = await restartCodexWithBridge({
		tmuxEnabled: true,
		sessionName: 'main',
		runWorkmuxCommand: async () => ({
			success: false,
			output: '',
			error: 'Unknown tmux command: app',
		}),
		runBridgeOperation: async () => {
			throw new Error('restart should not be requested');
		},
		showFailure: (message) => failures.push(message),
	});

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(failures, [WORKMUX_APP_COMMAND_UPDATE_MESSAGE]);
});

void test('restartCodexWithBridge reports invalid context output', async () => {
	const failures: string[] = [];

	const result = await restartCodexWithBridge({
		tmuxEnabled: true,
		sessionName: 'main',
		runWorkmuxCommand: async () => ({
			success: true,
			output: '{"target":""}\n',
		}),
		runBridgeOperation: async () => {
			throw new Error('restart should not be requested');
		},
		showFailure: (message) => failures.push(message),
	});

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(failures, ['Invalid Workmux app context']);
});

void test('restartCodexWithBridge formats unsupported restart operation as update mdev', async () => {
	const failures: string[] = [];

	const result = await restartCodexWithBridge({
		tmuxEnabled: true,
		sessionName: 'main',
		runWorkmuxCommand: async () => ({
			success: true,
			output: `${contextOutput}\n`,
		}),
		runBridgeOperation: async () => ({
			success: false,
			output: '',
			error: 'Unsupported operation: codex.restart',
		}),
		showFailure: (message) => failures.push(message),
	});

	assert.deepEqual(result, { status: 'failed' });
	assert.deepEqual(failures, [MDEV_BRIDGE_UPDATE_MESSAGE]);
});
```

- [ ] **Step 2: Run the restart runner test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/codex-restart.test.ts
```

Expected: FAIL because `apps/mobile/src/lib/codex-restart.ts` does not exist.

- [ ] **Step 3: Implement the restart runner**

Create `apps/mobile/src/lib/codex-restart.ts`:

```ts
import { MDEV_BRIDGE_UPDATE_MESSAGE } from './mdev-bridge-client';
import {
	buildCodexRestartBridgeOperation,
	type MdevBridgeOperationRequest,
} from './workmux-bridge-operations';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	buildWorkmuxAppContextArgv,
	formatWorkmuxAppCommandFailureMessage,
	parseWorkmuxAppContextOutput,
} from './workmux-app-commands';
import { type WorkmuxControlCommandResult } from './workmux-control-channel';

export const CODEX_RESTART_WORKMUX_DISABLED_MESSAGE =
	'Codex restart requires a Workmux-enabled connection.';

export type CodexRestartResult = { status: 'handled' } | { status: 'failed' };

export type CodexRestartDeps = {
	tmuxEnabled: boolean;
	sessionName: string;
	runWorkmuxCommand: (
		argv: string[],
		timeoutMs: number,
	) => Promise<WorkmuxControlCommandResult>;
	runBridgeOperation: (
		request: MdevBridgeOperationRequest,
		timeoutMs: number,
	) => Promise<WorkmuxControlCommandResult>;
	showFailure: (message: string) => void;
	timeoutMs?: number;
};

const DEFAULT_CODEX_RESTART_TIMEOUT_MS = 10_000;

function commandError(result: WorkmuxControlCommandResult): string {
	return result.error || result.output || 'Codex restart failed.';
}

function formatRestartOperationFailure(message: string): string {
	const trimmed = message.trim();
	if (
		!trimmed ||
		/unsupported operation/i.test(trimmed) ||
		/unknown operation/i.test(trimmed) ||
		/codex\.restart/i.test(trimmed)
	) {
		return MDEV_BRIDGE_UPDATE_MESSAGE;
	}
	return trimmed;
}

function showFailed(
	showFailure: (message: string) => void,
	message: string,
): CodexRestartResult {
	showFailure(message);
	return { status: 'failed' };
}

export async function restartCodexWithBridge({
	tmuxEnabled,
	sessionName,
	runWorkmuxCommand,
	runBridgeOperation,
	showFailure,
	timeoutMs = DEFAULT_CODEX_RESTART_TIMEOUT_MS,
}: CodexRestartDeps): Promise<CodexRestartResult> {
	if (!tmuxEnabled) {
		return showFailed(showFailure, CODEX_RESTART_WORKMUX_DISABLED_MESSAGE);
	}

	const contextResult = await runWorkmuxCommand(
		buildWorkmuxAppContextArgv(sessionName),
		timeoutMs,
	);
	if (!contextResult.success) {
		return showFailed(
			showFailure,
			formatWorkmuxAppCommandFailureMessage(commandError(contextResult)) ||
				WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		);
	}

	let target: string;
	try {
		target = parseWorkmuxAppContextOutput(contextResult.output).target;
	} catch (error) {
		return showFailed(
			showFailure,
			error instanceof Error ? error.message : 'Invalid Workmux app context',
		);
	}

	const restartResult = await runBridgeOperation(
		buildCodexRestartBridgeOperation(target),
		timeoutMs,
	);
	if (!restartResult.success) {
		return showFailed(
			showFailure,
			formatRestartOperationFailure(commandError(restartResult)),
		);
	}

	return { status: 'handled' };
}
```

- [ ] **Step 4: Run the restart runner test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/codex-restart.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/codex-restart.ts apps/mobile/test/integration/codex-restart.test.ts
git commit -m "Add bridge-backed Codex restart runner"
```

---

### Task 5: Wire Restart Action And Command Menu Bridge Handler

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Modify: `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`
- Modify from Task 2 if uncommitted: `apps/mobile/src/lib/command-menu-selection.ts`, `apps/mobile/test/integration/command-menu-selection.test.ts`

- [ ] **Step 1: Write failing keyboard action test**

Append this test to `apps/mobile/test/integration/keyboard-actions.test.ts`:

```ts
void test('restart Codex action delegates to the action context', async () => {
	let restarted = 0;

	await runAction('RESTART_CODEX', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		restartCodex: async () => {
			restarted += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(restarted, 1);
	assert.equal(KNOWN_ACTION_IDS.includes('RESTART_CODEX'), true);
	assert.equal(CONFIG_SUPPORTED_ACTION_IDS.includes('RESTART_CODEX'), true);
});
```

- [ ] **Step 2: Write failing detail wiring tests**

Append these tests to `apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts`:

```ts
	void test('wires bridge-backed Codex restart through WorkmuxControlChannel operation', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(
			source,
			/import \{ restartCodexWithBridge \} from '@\/lib\/codex-restart'/,
		);
		assert.match(source, /const handleRestartCodex\s*=\s*useCallback/);
		assert.match(source, /restartCodexWithBridge\(\{/);
		assert.match(source, /workmuxControlChannelRef\.current\.operation/);
		assert.match(source, /workmuxControlChannelRef\.current\.command/);
		assert.doesNotMatch(source, /mdev codex restart/);
	});

	void test('passes bridge handler into CommandMenuModal', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(source, /const handleCommandBridgeEntry\s*=\s*useCallback/);
		assert.match(source, /onBridge=\{handleCommandBridgeEntry\}/);
	});
```

Place both tests inside the existing `describe('shell detail Workmux control channel wiring', () => { ... })` block.

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: FAIL because `RESTART_CODEX`, `ActionContext.restartCodex`, and detail wiring do not exist.

- [ ] **Step 4: Add `RESTART_CODEX` action support**

In `apps/mobile/src/lib/keyboard-actions.ts`, add `'RESTART_CODEX'` to `KNOWN_ACTION_IDS` after `'FIT_TERMINAL_TO_DEVICE'`:

```ts
	'FIT_TERMINAL_TO_DEVICE',
	'RESTART_CODEX',
```

Add to `ActionContext` after `fitTerminalToDevice`:

```ts
	restartCodex?: () => Promise<void> | void;
```

Add this case in `runAction` after the terminal fit/reflow case:

```ts
		case 'RESTART_CODEX': {
			await context.restartCodex?.();
			return;
		}
```

- [ ] **Step 5: Wire restart in `detail.tsx`**

In `apps/mobile/src/app/shell/detail.tsx`, add imports:

```ts
import { restartCodexWithBridge } from '@/lib/codex-restart';
import { type CommandBridgeEntry } from '@/lib/shell-config';
```

The existing `shell-config` import already imports several types. Add `CommandBridgeEntry` to that import instead of creating a second `shell-config` import.

After `handleFitTerminalToDevice`, add:

```ts
	const handleRestartCodex = useCallback(async () => {
		commandMenuModal.onClose();
		await restartCodexWithBridge({
			tmuxEnabled,
			sessionName: tmuxTarget,
			runWorkmuxCommand: (argv, timeoutMs) =>
				workmuxControlChannelRef.current.command(argv, { timeoutMs }),
			runBridgeOperation: (request, timeoutMs) =>
				workmuxControlChannelRef.current.operation(request, { timeoutMs }),
			showFailure: (message) => {
				if (
					!shouldShowFocusedActiveFeedback({
						isFocused: isFocusedRef.current,
						isAppActive: isAppActiveRef.current,
					})
				) {
					logger.warn('Codex restart failed', message);
					return;
				}
				Alert.alert('Codex restart failed', message);
			},
		});
	}, [commandMenuModal, tmuxEnabled, tmuxTarget]);
```

In `actionContext`, add:

```ts
			restartCodex: handleRestartCodex,
```

and add `handleRestartCodex` to that `useMemo` dependency list.

Before `handleAction`, add:

```ts
	const handleCommandBridgeEntry = useCallback(
		(entry: CommandBridgeEntry) => {
			switch (entry.operation) {
				case 'codex.restart':
					void handleRestartCodex();
					return;
				default:
					logger.warn('Unhandled command bridge operation', entry.operation);
					return;
			}
		},
		[handleRestartCodex],
	);
```

In the `CommandMenuModal` JSX, add:

```tsx
					onBridge={handleCommandBridgeEntry}
```

- [ ] **Step 6: Run focused tests and TypeScript**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts test/integration/shell-detail-workmux-control-channel.test.ts test/integration/command-menu-selection.test.ts
cd apps/mobile && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

If Task 2 files were not committed because TypeScript needed this wiring, include them now:

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts apps/mobile/src/app/shell/components/CommandMenuModal.tsx apps/mobile/src/lib/command-menu-selection.ts apps/mobile/test/integration/command-menu-selection.test.ts
git commit -m "Wire mobile Codex restart to bridge"
```

If Task 2 was already committed, commit only this task's files:

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/shell-detail-workmux-control-channel.test.ts
git commit -m "Wire mobile Codex restart to bridge"
```

---

### Task 6: Update Bundled Runtime Config

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/command-menu.test.ts`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Write failing bundled command menu test updates**

In `apps/mobile/test/integration/command-menu.test.ts`, update `CommandTreeNode`:

```ts
type CommandTreeNode = {
	label: string;
	type: CommandMenuEntry['type'];
	children?: CommandTreeNode[];
};
```

In the full-tree assertion, change the mdev restart child from:

```ts
				{ label: 'restart codex', type: 'preset' },
```

to:

```ts
				{ label: 'restart codex', type: 'bridge' },
```

Replace `findPreset` with these helpers:

```ts
function findEntry(
	entries: CommandMenuEntry[],
	path: readonly string[],
): CommandMenuEntry {
	const [head, ...tail] = path;
	assert.ok(head);
	const entry = entries.find((candidate) => candidate.label === head);
	assert.ok(entry, `Missing command menu entry ${path.join(' > ')}`);
	if (tail.length === 0) return entry;
	assert.equal(entry.type, 'submenu');
	return findEntry(entry.entries, tail);
}

function findPreset(
	entries: CommandMenuEntry[],
	path: readonly string[],
): CommandPreset {
	const entry = findEntry(entries, path);
	assert.equal(entry.type, 'preset');
	return entry;
}
```

Then replace the `restart codex` assertion in `mdev codex presets expose auth refresh and restart commands` with:

```ts
	assert.deepEqual(findEntry(commandMenus, ['mdev', 'restart codex']), {
		type: 'bridge',
		label: 'restart codex',
		operation: 'codex.restart',
		timeoutMs: 10_000,
	});
```

Rename that test to:

```ts
void test('mdev codex entries expose auth refresh preset and bridge-backed restart', () => {
```

- [ ] **Step 2: Write failing bundled keyboard config test**

Append this test to `apps/mobile/test/integration/keyboard-config.test.ts`:

```ts
void test('tmux keyboard restart key uses mobile restart action instead of raw Alt-Shift-X bytes', () => {
	const config = getBundledShellConfig();
	const tmuxKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'tmux_keyboard',
	);
	assert.ok(tmuxKeyboard);

	assert.deepEqual(tmuxKeyboard.grid[0]?.[1], {
		type: 'action',
		actionId: 'RESTART_CODEX',
		label: 'Restart',
		icon: null,
	});
});
```

- [ ] **Step 3: Run bundled config tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu.test.ts test/integration/keyboard-config.test.ts
```

Expected: FAIL because bundled `shell-config.json` still uses a terminal preset and raw bytes.

- [ ] **Step 4: Update `shell-config.json` version metadata**

In `apps/mobile/config/shell-config.json`, update:

```json
"version": "2026-06-10.2",
"updatedAt": "2026-06-10T00:00:00.000Z",
```

- [ ] **Step 5: Replace the tmux keyboard restart slot**

In `apps/mobile/config/shell-config.json`, find the `tmux_keyboard` first row entry:

```json
{
	"type": "bytes",
	"bytes": [27, 88],
	"label": "Restart",
	"icon": null
}
```

Replace it with:

```json
{
	"type": "action",
	"actionId": "RESTART_CODEX",
	"label": "Restart",
	"icon": null
}
```

- [ ] **Step 6: Replace the command menu restart preset**

In `apps/mobile/config/shell-config.json`, find:

```json
{
	"type": "preset",
	"label": "restart codex",
	"steps": [
		{
			"type": "text",
			"data": "mdev codex restart \"$(mdev tmux app context --session main | sed -n 's/.*\"target\":\"\\([^\"]*\\)\".*/\\1/p')\""
		},
		{
			"type": "enter"
		}
	]
}
```

Replace it with:

```json
{
	"type": "bridge",
	"label": "restart codex",
	"operation": "codex.restart",
	"timeoutMs": 10000
}
```

- [ ] **Step 7: Run bundled config tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu.test.ts test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/command-menu.test.ts apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "Update bundled Codex restart controls"
```

---

### Task 7: Integrated Verification

**Files:**
- No code changes expected.
- Verify all files changed by Tasks 1-6.

- [ ] **Step 1: Run all focused integration tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test \
	test/integration/shell-config-schema.test.ts \
	test/integration/command-menu-selection.test.ts \
	test/integration/command-menu.test.ts \
	test/integration/keyboard-config.test.ts \
	test/integration/keyboard-actions.test.ts \
	test/integration/workmux-bridge-operations.test.ts \
	test/integration/workmux-control-channel.test.ts \
	test/integration/codex-restart.test.ts \
	test/integration/shell-detail-workmux-control-channel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
cd apps/mobile && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run mobile lint check if available**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS. If the script does not exist, run:

```bash
pnpm --filter @fressh/mobile lint
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff for terminal writes**

Run:

```bash
git diff HEAD -- apps/mobile/src apps/mobile/config apps/mobile/test
```

Expected: The `restart codex` path uses `restartCodexWithBridge`, `WorkmuxControlChannel.operation`, and `RESTART_CODEX`. The diff must not add a new call that writes `mdev codex restart` through `sendTextRaw`, `sendBytesRaw`, `runCommandSteps`, or terminal preset steps.

- [ ] **Step 5: Commit verification-only fixes if any were required**

If verification required code or test fixes, commit them:

```bash
git add apps/mobile/src apps/mobile/config apps/mobile/test
git commit -m "Verify bridge-backed Codex restart"
```

If verification required no changes, do not create an empty commit.

## Self-Review Notes

- Spec coverage:
  - No terminal writes: Task 4 tests the runner directly; Task 5 source checks wiring; Task 6 removes preset/raw bytes from config; Task 7 inspects the diff.
  - Existing persistent bridge channel: Task 3 adds `WorkmuxControlChannel.operation`; Task 4 uses it via injected deps; Task 5 wires it through `workmuxControlChannelRef.current.operation`.
  - Both mobile entry points: Task 5 wires `RESTART_CODEX`; Task 6 updates command menu and tmux keyboard config.
  - Remote tmux binding unchanged: no task edits remote tmux config; Task 6 only changes bundled mobile config.
  - Old bridge failure: Task 4 asserts unsupported `codex.restart` maps to `MDEV_BRIDGE_UPDATE_MESSAGE`.
  - Remote `mdev` CLI support: documented as an external prerequisite because this repo does not contain the CLI.
- Placeholder scan: no open placeholders remain in this plan.
- Type consistency:
  - `CommandBridgeEntry`, `CommandBridgeOperationId`, `COMMAND_BRIDGE_OPERATION_IDS`, `RESTART_CODEX`, `restartCodexWithBridge`, `buildCodexRestartBridgeOperation`, and `WorkmuxControlChannel.operation` are named consistently across tasks.
