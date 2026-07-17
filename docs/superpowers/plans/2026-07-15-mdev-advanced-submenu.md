# mdev Advanced Submenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten `Cmds > mdev` by keeping five common actions at the top level
and moving six infrequently used actions into a final `Advanced` submenu in the
approved order.

**Architecture:** Use the command menu's existing recursive `submenu` schema and
navigation behavior; this is a declarative tree reorganization with no React or
runtime handler changes. Update the bundled configuration metadata so the new
tree supersedes stale cached configuration, and lock the hierarchy, paths,
payloads, and metadata with existing integration tests.

**Tech Stack:** Expo React Native, TypeScript, JSON shell configuration, Node
test runner through `tsx`, pnpm.

## Global Constraints

- The direct `mdev` order is exactly `Fit terminal to device`, `New Worktree
  Workspace`, `Close Worktree Workspace`, `restart codex`, `Advanced`.
- The `Advanced` order is exactly `codex auth refresh`, `Debug connection in
  Codex`, `Open Workspace`, `Rename Workspace`, `Close Workspace`, `Request a
  Feature`.
- `Advanced` is always the final direct entry in `mdev`.
- Preserve every existing label, action ID, command, Enter step, bridge
  operation, and timeout.
- Use bundled configuration version `2026-07-15.1` and timestamp
  `2026-07-15T08:02:09.000Z` so cached older configurations are superseded.
- Do not change command-menu React components, navigation, schemas, action
  handlers, bridge code, or remote commands.
- Do not publish an OTA update or create a mobile build.

---

## File Structure

- `apps/mobile/config/shell-config.json` owns the bundled command-menu tree and
  the version metadata used to invalidate stale cached configuration.
- `apps/mobile/test/integration/command-menu.test.ts` verifies the complete menu
  hierarchy, ordering, nested lookup paths, action payloads, preset steps, and
  bridge contract.
- `apps/mobile/test/integration/keyboard-config.test.ts` verifies the terminal
  fit and native worktree entries remain directly accessible in their approved
  positions and records the committed configuration metadata.
- `apps/mobile/test/integration/shell-config-schema.test.ts` verifies the bundled
  JSON parses with the committed configuration metadata.
- No source files change because `CommandMenuModal` and the recursive shell
  configuration schema already support nested submenus.

### Task 1: Reorganize the Bundled mdev Menu

**Files:**

- Modify: `apps/mobile/test/integration/command-menu.test.ts:52-240`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts:582-638`
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts:14-34`
- Modify: `apps/mobile/config/shell-config.json:2-3`
- Modify: `apps/mobile/config/shell-config.json:1070-1158`
- Reference:
  `docs/superpowers/specs/2026-07-15-mdev-advanced-submenu-design.md`

**Interfaces:**

- Consumes: the existing recursive `CommandMenu` shape
  `{ type: 'submenu'; label: string; entries: CommandMenuEntry[] }`,
  `getBundledShellConfig(): ShellConfig`, `findEntry(entries, path)`, and
  `findPreset(entries, path)`.
- Produces: the approved bundled `mdev` tree and configuration metadata only;
  no new functions, types, props, events, or runtime APIs.

- [ ] **Step 1: Change the hierarchy and path expectations first**

In `apps/mobile/test/integration/command-menu.test.ts`, replace only the `mdev`
node inside the expected tree in
`bundled command menu exposes the approved Issue 91 tree` with:

```ts
{
	label: 'mdev',
	type: 'submenu',
	children: [
		{ label: 'Fit terminal to device', type: 'action' },
		{ label: 'New Worktree Workspace', type: 'action' },
		{ label: 'Close Worktree Workspace', type: 'action' },
		{ label: 'restart codex', type: 'bridge' },
		{
			label: 'Advanced',
			type: 'submenu',
			children: [
				{ label: 'codex auth refresh', type: 'preset' },
				{ label: 'Debug connection in Codex', type: 'action' },
				{ label: 'Open Workspace', type: 'preset' },
				{ label: 'Rename Workspace', type: 'preset' },
				{ label: 'Close Workspace', type: 'preset' },
				{ label: 'Request a Feature', type: 'action' },
			],
		},
	],
},
```

Replace the feature-request test with:

```ts
void test('mdev Advanced submenu routes feature request through a native app action', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(
		findEntry(commandMenus, ['mdev', 'Advanced', 'Request a Feature']),
		{
			type: 'action',
			label: 'Request a Feature',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
		},
	);
});
```

Change the diagnostic lookup path to:

```ts
findEntry(commandMenus, [
	'mdev',
	'Advanced',
	'Debug connection in Codex',
]);
```

Keep the existing expected diagnostic object unchanged:

```ts
{
	type: 'action',
	label: 'Debug connection in Codex',
	actionId: 'DEBUG_CONNECTION_IN_CODEX',
}
```

Replace the three workspace preset lookup paths while leaving their expected
objects and steps unchanged:

```ts
findPreset(commandMenus, ['mdev', 'Advanced', 'Open Workspace']);
findPreset(commandMenus, ['mdev', 'Advanced', 'Close Workspace']);
findPreset(commandMenus, ['mdev', 'Advanced', 'Rename Workspace']);
```

Replace `mdev native worktree workspace actions follow the existing workspace
presets` with:

```ts
void test('mdev keeps terminal fit and native worktree workspace actions first', () => {
	const commandMenus = getBundledShellConfig().commandMenus;
	const mdev = findEntry(commandMenus, ['mdev']);
	assert.equal(mdev.type, 'submenu');
	if (mdev.type !== 'submenu') return;

	assert.deepEqual(mdev.entries.slice(0, 3), [
		{
			type: 'action',
			label: 'Fit terminal to device',
			actionId: 'FIT_TERMINAL_TO_DEVICE',
		},
		{
			type: 'action',
			label: 'New Worktree Workspace',
			actionId: 'OPEN_NEW_WORKTREE_WORKSPACE',
		},
		{
			type: 'action',
			label: 'Close Worktree Workspace',
			actionId: 'OPEN_CLOSE_WORKTREE_WORKSPACE',
		},
	]);
});
```

In `mdev codex entries expose auth refresh preset and bridge-backed restart`,
replace the direct auth-refresh assertion with these direct/nested assertions:

```ts
assert.equal(
	mdev.entries.some((entry) => entry.label === 'codex auth refresh'),
	false,
);
assert.deepEqual(
	findPreset(commandMenus, ['mdev', 'Advanced', 'codex auth refresh']),
	{
		type: 'preset',
		label: 'codex auth refresh',
		steps: [
			{ type: 'text', data: 'mdev codex auth refresh' },
			{ type: 'enter' },
		],
	},
);
assert.deepEqual(findEntry(commandMenus, ['mdev', 'restart codex']), {
	type: 'bridge',
	label: 'restart codex',
	operation: 'codex.restart',
	timeoutMs: 60_000,
});
```

Retain the existing assertion that `codex auth refresh new` is absent. This
preserves the prior regression contract while moving the supported preset.

- [ ] **Step 2: Change the focused configuration and metadata expectations**

In `apps/mobile/test/integration/keyboard-config.test.ts`, replace
`mdev command menu exposes terminal fit action` with:

```ts
void test('mdev command menu keeps terminal fit action first', () => {
	const config = getBundledShellConfig();
	const mdevMenu = config.commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);
	assert.ok(mdevMenu);
	assert.equal(mdevMenu.type, 'submenu');

	assert.deepEqual(mdevMenu.entries[0], {
		type: 'action',
		label: 'Fit terminal to device',
		actionId: 'FIT_TERMINAL_TO_DEVICE',
	});
});
```

Replace `bundled config exposes native worktree workspace actions with committed
metadata` with:

```ts
void test('bundled config exposes direct worktree actions with committed metadata', () => {
	const config = getBundledShellConfig();
	const mdevMenu = config.commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);
	assert.ok(mdevMenu);
	assert.equal(mdevMenu.type, 'submenu');
	assert.equal(config.version, '2026-07-15.1');
	assert.equal(config.updatedAt, '2026-07-15T08:02:09.000Z');

	assert.deepEqual(mdevMenu.entries.slice(1, 3), [
		{
			type: 'action',
			label: 'New Worktree Workspace',
			actionId: 'OPEN_NEW_WORKTREE_WORKSPACE',
		},
		{
			type: 'action',
			label: 'Close Worktree Workspace',
			actionId: 'OPEN_CLOSE_WORKTREE_WORKSPACE',
		},
	]);
	assert.equal(mdevMenu.entries.at(-1)?.type, 'submenu');
	assert.equal(mdevMenu.entries.at(-1)?.label, 'Advanced');
});
```

In `apps/mobile/test/integration/shell-config-schema.test.ts`, replace the two
committed metadata assertions with:

```ts
assert.equal(config.version, '2026-07-15.1');
assert.equal(config.updatedAt, '2026-07-15T08:02:09.000Z');
```

- [ ] **Step 3: Run the focused tests and verify they fail for the intended reasons**

Run from the repository root:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/command-menu.test.ts \
	test/integration/keyboard-config.test.ts \
	test/integration/shell-config-schema.test.ts
```

Expected: FAIL because the bundled `mdev` tree still begins with `Request a
Feature`, has no `Advanced` submenu, and still reports version `2026-07-14.2`.
The failures must be assertion failures caused by the old configuration, not
syntax, import, or test-runner errors.

- [ ] **Step 4: Reorganize the bundled configuration**

In `apps/mobile/config/shell-config.json`, replace the top-level metadata with:

```json
{
	"version": "2026-07-15.1",
	"updatedAt": "2026-07-15T08:02:09.000Z",
```

Replace the complete existing `mdev` submenu with:

```json
{
	"type": "submenu",
	"label": "mdev",
	"entries": [
		{
			"type": "action",
			"label": "Fit terminal to device",
			"actionId": "FIT_TERMINAL_TO_DEVICE"
		},
		{
			"type": "action",
			"label": "New Worktree Workspace",
			"actionId": "OPEN_NEW_WORKTREE_WORKSPACE"
		},
		{
			"type": "action",
			"label": "Close Worktree Workspace",
			"actionId": "OPEN_CLOSE_WORKTREE_WORKSPACE"
		},
		{
			"type": "bridge",
			"label": "restart codex",
			"operation": "codex.restart",
			"timeoutMs": 60000
		},
		{
			"type": "submenu",
			"label": "Advanced",
			"entries": [
				{
					"type": "preset",
					"label": "codex auth refresh",
					"steps": [
						{
							"type": "text",
							"data": "mdev codex auth refresh"
						},
						{
							"type": "enter"
						}
					]
				},
				{
					"type": "action",
					"label": "Debug connection in Codex",
					"actionId": "DEBUG_CONNECTION_IN_CODEX"
				},
				{
					"type": "preset",
					"label": "Open Workspace",
					"steps": [
						{
							"type": "text",
							"data": "mdev tmux open-workspace"
						},
						{
							"type": "enter"
						}
					]
				},
				{
					"type": "preset",
					"label": "Rename Workspace",
					"steps": [
						{
							"type": "text",
							"data": "mdev tmux workspace prompt-rename"
						},
						{
							"type": "enter"
						}
					]
				},
				{
					"type": "preset",
					"label": "Close Workspace",
					"steps": [
						{
							"type": "text",
							"data": "mdev tmux workspace close"
						},
						{
							"type": "enter"
						}
					]
				},
				{
					"type": "action",
					"label": "Request a Feature",
					"actionId": "OPEN_REPO_FEATURE_REQUEST"
				}
			]
		}
	]
}
```

Do not edit `apps/mobile/src/app/shell/components/CommandMenuModal.tsx`,
`apps/mobile/src/lib/shell-config.ts`, or any action/bridge handler. Their
existing recursive submenu support already supplies the required behavior.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/command-menu.test.ts \
	test/integration/keyboard-config.test.ts \
	test/integration/shell-config-schema.test.ts
```

Expected: all tests PASS, including the exact hierarchy, nested action/preset
payloads, direct worktree ordering, bridge timeout, and metadata assertions.

- [ ] **Step 6: Validate the shell configuration and typecheck mobile**

Run:

```bash
pnpm --filter @fressh/mobile validate:shell-config
pnpm --filter @fressh/mobile typecheck
```

Expected validator output includes:

```text
Valid shell config 2026-07-15.1 (2026-07-15T08:02:09.000Z)
```

Expected typecheck result: exit code 0 with no TypeScript errors.

- [ ] **Step 7: Run the complete non-destructive mobile integration suite**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: all mobile integration tests PASS. Do not run `test:e2e` or
`test:e2e:clear-state`; this configuration-only change does not require device
testing, and the latter intentionally destroys app state.

- [ ] **Step 8: Check formatting and the final diff**

Run:

```bash
pnpm --filter @fressh/mobile exec prettier --check \
	config/shell-config.json \
	test/integration/command-menu.test.ts \
	test/integration/keyboard-config.test.ts \
	test/integration/shell-config-schema.test.ts
git diff --check
git diff -- \
	apps/mobile/config/shell-config.json \
	apps/mobile/test/integration/command-menu.test.ts \
	apps/mobile/test/integration/keyboard-config.test.ts \
	apps/mobile/test/integration/shell-config-schema.test.ts
```

Expected: Prettier reports all four files use the expected style,
`git diff --check` prints nothing, and the diff contains only the approved menu
reorganization, metadata bump, and test expectation updates.

- [ ] **Step 9: Commit the implementation**

```bash
git add \
	apps/mobile/config/shell-config.json \
	apps/mobile/test/integration/command-menu.test.ts \
	apps/mobile/test/integration/keyboard-config.test.ts \
	apps/mobile/test/integration/shell-config-schema.test.ts \
	docs/superpowers/plans/2026-07-15-mdev-advanced-submenu.md
git commit -m "Reorganize mdev advanced commands"
```

Expected: one implementation commit containing the bundled configuration, its
three integration-test files, and this implementation plan. The already
committed design spec remains in commit `a41327d1`.
