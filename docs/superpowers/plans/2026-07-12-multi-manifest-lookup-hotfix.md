# Multi-Manifest Lookup Safety Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `makeBetterSecureStore().getEntry()` find entries in every
manifest chunk so existing private keys remain readable until secure storage v2
lands.

**Architecture:** Keep the version-1 root manifest, manifest chunks, entry
chunks, and public store interface unchanged. Build the lookup from the same
flattened manifest-entry view already used by `listEntries()`, then select the
requested ID. Add a storage-agnostic integration regression that deliberately
creates two manifest chunks and reads private-key-shaped entries from both.

**Tech Stack:** TypeScript 5.9, Zod 4, Node `tsx --test`, pnpm workspace
filters, ESLint, Prettier.

## Global Constraints

- Follow strict red-green-refactor TDD: add the regression first, run it, and
  observe the expected `Entry not found` failure before changing production
  code.
- Change only `apps/mobile/src/lib/chunked-storage.ts` and the new focused test
  file. Do not fold secure-storage-v2 design or migration work into this hotfix.
- Preserve all existing root-manifest, manifest-chunk, and entry-chunk keys and
  serialized formats. This hotfix must read existing device data in place and
  must not rewrite, migrate, clear, or re-encrypt it.
- Preserve `makeBetterSecureStore` parameters, return methods, error messages,
  and the `getEntry()` result shape. No public or internal API break is needed
  for this fix.
- Do not change upsert, delete, cleanup, corrupt-manifest pruning, or write
  ordering. Those safety concerns belong to the separately planned storage-v2
  work.
- Do not add compatibility branches, catch-and-ignore behavior, repository
  wrappers, or a new abstraction for this one-expression lookup correction.
- Use synthetic key values only. Do not read, log, clear, or alter private keys
  on a simulator, emulator, physical device, or user storage.
- A thermo-nuclear maintainability review of the final two-file diff is a merge
  gate, followed by fresh focused and mobile-suite verification.

---

## File Structure

**Create:**

- `apps/mobile/test/integration/chunked-storage.test.ts` — focused regression
  coverage for multi-manifest `getEntry()` lookup.

**Modify:**

- `apps/mobile/src/lib/chunked-storage.ts` — replace the accumulator-discarding
  lookup with a flattened manifest-entry search.

## Task 1: Reproduce the Multi-Manifest Read Failure

**Files:**

- Create: `apps/mobile/test/integration/chunked-storage.test.ts`
- Reference: `apps/mobile/src/lib/chunked-storage.ts`

- [ ] **Step 1: Add the focused storage regression**

Create `apps/mobile/test/integration/chunked-storage.test.ts` with this exact
content:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import * as z from 'zod';
import {
	makeBetterSecureStore,
	type AsyncStringStorage,
} from '../../src/lib/chunked-storage';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const testKeyMetadataSchema = z.object({
	priority: z.number(),
	createdAtMs: z.int(),
	label: z.string(),
	isDefault: z.boolean(),
	testPadding: z.string(),
});

function createMemoryStorage(): AsyncStringStorage {
	const entries = new Map<string, string>();
	return {
		getItem: async (key) => entries.get(key) ?? null,
		setItem: async (key, value) => {
			entries.set(key, value);
		},
		deleteItem: async (key) => {
			entries.delete(key);
		},
	};
}

void test('getEntry reads private-key values from every manifest chunk', async () => {
	let nextManifestId = 0;
	const storage = makeBetterSecureStore({
		storagePrefix: 'privateKey',
		extraManifestFieldsSchema: testKeyMetadataSchema,
		parseValue: (value) => value,
		storage: createMemoryStorage(),
		randomUUID: () => `manifest-${++nextManifestId}`,
		logger: noopLogger,
	});
	const privateKeys = [
		{ id: 'key_oldest', createdAtMs: 1, value: 'private-key-value-oldest' },
		{ id: 'key_middle', createdAtMs: 2, value: 'private-key-value-middle' },
		{ id: 'key_newest', createdAtMs: 3, value: 'private-key-value-newest' },
	] as const;

	for (const [priority, privateKey] of privateKeys.entries()) {
		await storage.upsertEntry({
			id: privateKey.id,
			metadata: {
				priority,
				createdAtMs: privateKey.createdAtMs,
				label: privateKey.id,
				isDefault: priority === 0,
				testPadding: 'x'.repeat(800),
			},
			value: privateKey.value,
		});
	}

	const manifest = await storage.getManifest();
	assert.equal(manifest.rootManifest.manifestChunksIds.length, 2);

	for (const privateKey of privateKeys) {
		const stored = await storage.getEntry(privateKey.id);
		assert.equal(stored.value, privateKey.value);
		assert.equal(
			stored.manifestEntry.metadata.createdAtMs,
			privateKey.createdAtMs,
		);
	}
});
```

The `testPadding` field keeps the fixture small while making each manifest entry
large enough that the third key creates a second manifest chunk. The production
key metadata and values remain represented; the storage utility does not
validate OpenSSH key material itself.

- [ ] **Step 2: Run the new test and confirm the red phase**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/chunked-storage.test.ts
```

Expected: FAIL after the explicit two-chunk assertion passes. The first lookup
for `key_oldest` rejects with `Error: Entry not found`. If the fixture fails
before that point, correct the test setup without changing production code and
rerun until it isolates this lookup defect.

## Task 2: Search Every Manifest Chunk

**Files:**

- Modify: `apps/mobile/src/lib/chunked-storage.ts`
- Test: `apps/mobile/test/integration/chunked-storage.test.ts`

- [ ] **Step 1: Replace the broken reduction with a flattened search**

In `getEntry`, replace:

```ts
const manifestEntry = manifest.manifestChunks.reduce<Entry | undefined>(
	(_, manifestChunk) =>
		manifestChunk.manifestChunk.entries.find((entry) => entry.id === id),
	undefined,
);
```

with:

```ts
const manifestEntry = manifest.manifestChunks
	.flatMap((manifestChunk) => manifestChunk.manifestChunk.entries)
	.find((entry) => entry.id === id);
```

This uses the same complete manifest-entry traversal shape as `listEntries()`
without fetching or parsing the manifest a second time.

- [ ] **Step 2: Run the focused test and confirm the green phase**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/chunked-storage.test.ts
```

Expected: PASS. The test must read `key_oldest` and `key_middle` from the first
manifest chunk and `key_newest` from the second.

- [ ] **Step 3: Refactor only if the two-file diff can be made smaller**

Inspect:

```sh
git diff -- apps/mobile/src/lib/chunked-storage.ts apps/mobile/test/integration/chunked-storage.test.ts
```

Expected: one focused test file plus the lookup-expression replacement. Do not
extract a shared helper or modify `listEntries()` for this hotfix; the direct
expression is the smaller, clearer change.

## Task 3: Review, Verify, and Commit the Hotfix

**Files:**

- Modify: `apps/mobile/src/lib/chunked-storage.ts`
- Test: `apps/mobile/test/integration/chunked-storage.test.ts`

- [ ] **Step 1: Check formatting for only the changed files**

Run:

```sh
pnpm exec cross-env SORT_IMPORTS=true prettier --check \
  apps/mobile/src/lib/chunked-storage.ts \
  apps/mobile/test/integration/chunked-storage.test.ts
```

Expected: PASS. If it fails, run the same command with `--write`, inspect the
result, and rerun `--check`.

- [ ] **Step 2: Run focused lint and mobile type checking**

Run:

```sh
pnpm --filter @fressh/mobile exec eslint \
  --max-warnings 0 \
  --report-unused-disable-directives \
  src/lib/chunked-storage.ts \
  test/integration/chunked-storage.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: both commands PASS.

- [ ] **Step 3: Run the full mobile integration suite**

Run:

```sh
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS, including the new multi-manifest regression and the existing
device-migration/private-key coverage.

- [ ] **Step 4: Run the required thermo-nuclear maintainability review**

Invoke `$thermo-nuclear-code-quality-review` with the final diff limited to:

```text
apps/mobile/src/lib/chunked-storage.ts
apps/mobile/test/integration/chunked-storage.test.ts
```

The review must confirm all of the following before merge:

```text
[ ] getEntry searches all manifest chunks and retains the existing not-found error.
[ ] The regression proves that two manifest chunks exist before exercising reads.
[ ] Values and metadata from first and last chunks are verified.
[ ] No storage format, key naming, write ordering, cleanup, or API changed.
[ ] No helper layer, fallback path, compatibility shim, or unrelated cleanup was added.
```

If the review finds a correctness or maintainability defect, add or adjust a
failing focused test first, make the minimum correction, and repeat Tasks 2
and 3. Do not expand into storage-v2 concerns.

- [ ] **Step 5: Capture fresh final verification evidence**

Run, in this order:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/chunked-storage.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile test:integration
git diff --check -- \
  apps/mobile/src/lib/chunked-storage.ts \
  apps/mobile/test/integration/chunked-storage.test.ts
```

Expected: every command exits zero. Treat this fresh output—not an earlier run
or the review—as the completion evidence.

- [ ] **Step 6: Commit only the hotfix files**

Run:

```sh
git add \
  apps/mobile/src/lib/chunked-storage.ts \
  apps/mobile/test/integration/chunked-storage.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "Fix multi-manifest secure-store lookup"
```

Expected: the staged-name check lists exactly the two paths above, the commit
succeeds, and unrelated Wayfinder, plan, or workspace changes remain unstaged.

## Self-Review Notes

- Coverage: the regression forces exactly two manifest chunks, then reads
  oldest, middle, and newest private-key-shaped records and checks both values
  and creation timestamps.
- Failure specificity: the pre-fix failure is `Entry not found` only after the
  two-chunk precondition succeeds, so it cannot be mistaken for a fixture-size
  or write-path failure.
- Scope: the production patch is a direct complete traversal; serialization,
  storage keys, mutation ordering, pruning, and APIs remain unchanged.
- Placeholder scan: no TODO markers, unresolved alternatives, or unspecified
  implementation choices remain.
- Type consistency: `makeBetterSecureStore`, `AsyncStringStorage`,
  `getManifest`, `getEntry`, `manifestChunksIds`, and the mobile verification
  scripts match the current repository at audit baseline `82d6f44`.
- Dependency boundary: transactional writes and automatic format migration
  remain assigned to the existing secure-storage-v2 Wayfinder tickets; this
  hotfix neither blocks nor pre-decides that architecture.
