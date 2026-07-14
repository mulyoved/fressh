# Mdev Codex Restart Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bridge-backed mobile `codex.restart` request 60 seconds to
complete before timing out.

**Architecture:** Keep the existing command-menu dispatch and Codex restart
bridge implementation unchanged. Update the bundled bridge entry's declarative
timeout and configuration metadata, then lock the new value with the existing
command-menu integration test.

**Tech Stack:** Expo React Native, TypeScript, JSON shell configuration, Node
test runner through `tsx`, pnpm.

## Global Constraints

- Set the bundled `Cmds > mdev > restart codex` entry to exactly
  `timeoutMs: 60000`.
- Keep the entry as `type: "bridge"` with `operation: "codex.restart"`.
- Keep existing per-request timeout semantics: context lookup and restart each
  receive the configured timeout independently.
- Do not change runtime timeout defaults or unrelated Workmux timeouts.
- Do not add progress UI, cancellation, retry, fallback behavior, or terminal
  command injection.
- Keep existing success and failure presentation unchanged.

---

## File Structure

- `apps/mobile/test/integration/command-menu.test.ts` verifies the exact bundled
  command-menu contract, including the Codex restart operation and timeout.
- `apps/mobile/config/shell-config.json` owns the bundled command entry and the
  version metadata used to supersede stale cached configuration.
- No runtime TypeScript files change because the current dispatcher and restart
  handler already propagate the entry's timeout correctly.

### Task 1: Increase the Bundled Codex Restart Timeout

**Files:**

- Modify: `apps/mobile/test/integration/command-menu.test.ts:186-212`
- Modify: `apps/mobile/config/shell-config.json:2-3`
- Modify: `apps/mobile/config/shell-config.json:1139-1144`
- Reference:
  `docs/superpowers/specs/2026-07-14-mdev-codex-restart-timeout-design.md`

**Interfaces:**

- Consumes: `getBundledShellConfig(): ShellConfig` and the existing
  `CommandBridgeEntry` shape
  `{ type: 'bridge'; label: string; operation: 'codex.restart'; timeoutMs?: number }`.
- Produces: a bundled `restart codex` entry with `timeoutMs: 60_000`; no new
  functions, types, or runtime APIs.

- [ ] **Step 1: Change the integration expectation first**

In `apps/mobile/test/integration/command-menu.test.ts`, replace the existing
`restart codex` assertion with:

```ts
assert.deepEqual(findEntry(commandMenus, ['mdev', 'restart codex']), {
	type: 'bridge',
	label: 'restart codex',
	operation: 'codex.restart',
	timeoutMs: 60_000,
});
```

- [ ] **Step 2: Run the focused test and verify the new expectation fails**

Run from the repository root:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/command-menu.test.ts
```

Expected: FAIL in
`mdev codex entries expose auth refresh preset and bridge-backed restart`; the
actual bundled value is `10000` while the expected value is `60000`.

- [ ] **Step 3: Make the minimal bundled configuration change**

In `apps/mobile/config/shell-config.json`, replace the top-level metadata with:

```json
{
	"version": "2026-07-14.1",
	"updatedAt": "2026-07-14T10:12:06.000Z",
```

Replace the existing `restart codex` entry with:

```json
{
	"type": "bridge",
	"label": "restart codex",
	"operation": "codex.restart",
	"timeoutMs": 60000
}
```

Do not change `apps/mobile/src/lib/codex-restart.ts` or the default timeout in
`apps/mobile/src/lib/workmux-control-channel.ts`; the entry-specific value
already flows through both existing requests.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/command-menu.test.ts
```

Expected: PASS, including
`mdev codex entries expose auth refresh preset and bridge-backed restart`.

- [ ] **Step 5: Validate the updated shell configuration**

Run:

```bash
pnpm --filter @fressh/mobile validate:shell-config
```

Expected output includes:

```text
Valid shell config 2026-07-14.1 (2026-07-14T10:12:06.000Z)
```

- [ ] **Step 6: Run the focused regression suite**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/command-menu.test.ts \
	test/integration/shell-config-schema.test.ts \
	test/integration/shell-config-store.test.ts \
	test/integration/codex-restart.test.ts
```

Expected: all tests PASS. The Codex restart tests continue to assert existing
default and explicit timeout propagation; they require no source changes.

- [ ] **Step 7: Check formatting and the final diff**

Run:

```bash
pnpm --filter @fressh/mobile exec prettier --check \
	config/shell-config.json \
	test/integration/command-menu.test.ts
git diff --check
git diff -- \
	apps/mobile/config/shell-config.json \
	apps/mobile/test/integration/command-menu.test.ts
```

Expected: Prettier reports both files use the expected style, `git diff --check`
prints nothing, and the diff contains only the metadata bump, `10000` to
`60000`, and `10_000` to `60_000`.

- [ ] **Step 8: Commit the implementation**

```bash
git add \
	apps/mobile/config/shell-config.json \
	apps/mobile/test/integration/command-menu.test.ts
git commit -m "Fix Codex restart timeout"
```

Expected: one commit containing only the two implementation files.
