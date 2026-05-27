# Fressh Skill Selector Mdev Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the new `mdev` tmux project metadata contract so cached `$` skill selector opens can render immediately without a blocking remote folder lookup.

**Architecture:** Add a focused tmux project metadata parser/cache on the mobile side. Update the skill selector loader to use trusted metadata before falling back to `mdev tmux pane project`, and update app-owned tmux window cycling to call `mdev tmux nav next` so the returned metadata can refresh the active pointer.

**Tech Stack:** Expo React Native, TypeScript, MMKV, Node `node:test` integration tests, existing SSH side-channel command runner.

---

## File Structure

- Create: `apps/mobile/src/lib/tmux-project-metadata.ts`
  - Owns the `mdev` JSON schema, parser, cache-key helpers, and command builders.
- Create: `apps/mobile/src/lib/tmux-project-metadata-cache.ts`
  - Owns storage-backed active metadata cache with parse/delete behavior matching the skill cache pattern.
- Create: `apps/mobile/src/lib/tmux-project-metadata-cache-native.ts`
  - Wires the cache to MMKV.
- Create: `apps/mobile/test/integration/tmux-project-metadata.test.ts`
  - Parser, command builder, and cache tests.
- Modify: `apps/mobile/src/lib/skill-selector-loader.ts`
  - Accepts trusted metadata and a metadata resolver.
  - Uses metadata + skill cache for zero-command cached opens.
  - Falls back to `mdev tmux pane project` when metadata is missing.
- Modify: `apps/mobile/test/integration/skill-selector-loader.test.ts`
  - Updates old current-folder tests to the new metadata path.
  - Adds zero-command cached open and fallback tests.
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
  - Lets `CYCLE_TMUX_WINDOW` delegate to an app-owned callback before falling back to raw bytes.
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Proves `CYCLE_TMUX_WINDOW` uses the callback.
- Modify: `apps/mobile/src/app/shell/detail.tsx`
  - Stores parsed metadata from `mdev`.
  - Supplies metadata to the skill selector loader.
  - Uses `mdev tmux nav next` for `CYCLE_TMUX_WINDOW`.
  - Optionally prefetches metadata in the background on shell focus/ready.

## Task 1: Tmux Project Metadata Parser And Cache

**Files:**
- Create: `apps/mobile/src/lib/tmux-project-metadata.ts`
- Create: `apps/mobile/src/lib/tmux-project-metadata-cache.ts`
- Create: `apps/mobile/test/integration/tmux-project-metadata.test.ts`

- [ ] **Step 1: Write failing parser and cache tests**

Add tests that assert:

```ts
parseTmuxProjectMetadataOutput(JSON.stringify({
	sessionName: 'main',
	windowId: '@3',
	windowIndex: 3,
	windowName: 'mobile',
	paneId: '%12',
	panePath: '/home/muly/fressh/apps/mobile',
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
}));
```

returns the same typed metadata, malformed JSON returns `null`, command builders emit:

```ts
buildTmuxPaneProjectCommand('main') === "mdev tmux pane project 'main:'"
buildTmuxNavProjectCommand('next') === 'mdev tmux nav next'
```

and the cache can write/read/delete active metadata keyed by stable connection and tmux session.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/tmux-project-metadata.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement the metadata parser, command builders, and cache**

Implementation requirements:

- `TmuxProjectMetadata` must match PR #65 exactly:
  `sessionName`, `windowId`, `windowIndex`, `windowName`, `paneId`, `panePath`,
  `projectRoot`, `projectName`.
- Parser trims side-channel output and accepts the last JSON object line.
- Cache records include `version`, key parts, metadata, and `updatedAt`.
- Malformed cache records are deleted and return `null`.

- [ ] **Step 4: Verify the tests pass**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/tmux-project-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/tmux-project-metadata.ts apps/mobile/src/lib/tmux-project-metadata-cache.ts apps/mobile/test/integration/tmux-project-metadata.test.ts
git commit -m "feat(mobile): add tmux project metadata cache"
```

## Task 2: Skill Selector Loader Uses Metadata

**Files:**
- Modify: `apps/mobile/src/lib/skill-selector-loader.ts`
- Modify: `apps/mobile/test/integration/skill-selector-loader.test.ts`

- [ ] **Step 1: Write failing loader tests**

Add tests for:

- cached metadata + cached skills returns with `commands === []`;
- missing metadata calls `mdev tmux pane project 'main:'`, then reads cache;
- metadata cache miss runs discovery using `metadata.panePath`;
- force refresh ignores cached skills and resolves fresh metadata.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/skill-selector-loader.test.ts
```

Expected: FAIL because the loader has no metadata input/resolver yet.

- [ ] **Step 3: Implement minimal loader support**

Update `loadSkillSelectorProject` to accept:

```ts
projectMetadata?: TmuxProjectMetadata | null;
resolveProjectMetadata?: () => Promise<TmuxProjectMetadata>;
```

Flow:

1. If `!forceRefresh && projectMetadata` and skill cache has `projectMetadata.projectRoot`, return cache immediately.
2. Otherwise resolve metadata via `resolveProjectMetadata`.
3. If `!forceRefresh`, read skill cache by resolved `projectRoot`.
4. Run discovery with `metadata.panePath` only when cache is missing or refresh is forced.
5. Write cache under `metadata.projectRoot` and `metadata.projectName`.

- [ ] **Step 4: Verify the tests pass**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/skill-selector-loader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/skill-selector-loader.ts apps/mobile/test/integration/skill-selector-loader.test.ts
git commit -m "feat(mobile): load skills from tmux project metadata"
```

## Task 3: Wire Metadata Into Shell Detail And Keyboard Action

**Files:**
- Create: `apps/mobile/src/lib/tmux-project-metadata-cache-native.ts`
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/test/integration/host-browser-actions.test.ts`
- Modify: `apps/mobile/src/lib/host-browser-actions.ts`

- [ ] **Step 1: Write failing action and command-builder tests**

Add tests that assert:

- `CYCLE_TMUX_WINDOW` calls `context.cycleTmuxWindow` when provided;
- it falls back to the existing raw byte sequence when no callback exists;
- `buildTmuxPaneProjectCommand('main')` emits `mdev tmux pane project 'main:'`;
- `buildTmuxNavProjectCommand('next')` emits `mdev tmux nav next`.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-actions.test.ts test/integration/host-browser-actions.test.ts
```

Expected: FAIL because the callback and builders do not exist.

- [ ] **Step 3: Implement shell wiring**

Implementation requirements:

- Add native MMKV metadata cache.
- In `ShellDetail`, maintain active metadata state for the visible source.
- Add `resolveTmuxProjectMetadata()` that runs `mdev tmux pane project '<session>:'`, parses JSON, writes cache, and updates active state.
- Pass `projectMetadata` and `resolveProjectMetadata` into `loadSkillSelectorProject`.
- Add `handleCycleTmuxWindow()` that runs `mdev tmux nav next`, parses metadata, writes cache, and updates active state.
- Keep existing raw-byte fallback in `keyboard-actions.ts` for contexts that do not provide `cycleTmuxWindow`.
- Keep status cycling on `mdev tmux nav cycle`; do not parse metadata there.

- [ ] **Step 4: Verify focused tests pass**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/tmux-project-metadata.test.ts test/integration/skill-selector-loader.test.ts test/integration/keyboard-actions.test.ts test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/tmux-project-metadata-cache-native.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/host-browser-actions.test.ts apps/mobile/src/lib/host-browser-actions.ts
git commit -m "feat(mobile): wire tmux metadata into skill selector"
```

## Task 4: Verification And Deployment

**Files:**
- Inspect: all modified mobile files

- [ ] **Step 1: Run focused tests**

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/tmux-project-metadata.test.ts test/integration/skill-selector-loader.test.ts test/integration/keyboard-actions.test.ts test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint and format checks on touched files**

```bash
pnpm --dir apps/mobile exec eslint src/lib/tmux-project-metadata.ts src/lib/tmux-project-metadata-cache.ts src/lib/tmux-project-metadata-cache-native.ts src/lib/skill-selector-loader.ts src/lib/keyboard-actions.ts src/lib/host-browser-actions.ts src/app/shell/detail.tsx test/integration/tmux-project-metadata.test.ts test/integration/skill-selector-loader.test.ts test/integration/keyboard-actions.test.ts test/integration/host-browser-actions.test.ts
pnpm --dir apps/mobile exec prettier --check src/lib/tmux-project-metadata.ts src/lib/tmux-project-metadata-cache.ts src/lib/tmux-project-metadata-cache-native.ts src/lib/skill-selector-loader.ts src/lib/keyboard-actions.ts src/lib/host-browser-actions.ts src/app/shell/detail.tsx test/integration/tmux-project-metadata.test.ts test/integration/skill-selector-loader.test.ts test/integration/keyboard-actions.test.ts test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 4: Publish preview OTA**

```bash
cd apps/mobile
pnpm exec eas update --channel preview --message "Use mdev project metadata for skill selector"
```

Expected: EAS publishes Android and iOS updates.
