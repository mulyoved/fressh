# Secure Storage V2 and Automatic Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace delete-first private-key and restore-journal storage with the
approved two-root transactional store and migrate every readable version-1
record without destructive reset or manual export/import.

**Architecture:** Build a storage-agnostic transactional core from focused
codec, record, read, and write modules. It writes immutable attempt records,
publishes through two fixed roots, falls back to the previous complete snapshot,
and keeps legacy records until a new app instance reopens version 2. A thin
mobile service injects Expo SecureStore and Expo Crypto for private keys and the
restore journal.

**Tech Stack:** TypeScript 5.9, Zod 4, Expo SDK 54, Expo SecureStore 15.0.8,
Expo Crypto, `base64-js` 1.5.1, Node `tsx --test`, pnpm, ESLint, Prettier.

## Global Constraints

- Start after the multi-manifest lookup hotfix is merged and passing.
- Follow strict red-green-refactor TDD. Every production behavior starts with a
  focused failing test whose failure is observed before implementation.
- Preserve all version-1 private-key and restore-journal keys until a fresh
  store instance has reopened a complete version-2 snapshot after simulated
  restart.
- Never clear app data, uninstall the app, touch a physical device, or read real
  private keys while implementing or verifying this plan.
- Use exactly two fixed root keys and two fixed transaction-intent keys per
  namespace.
- Keep normal-save current and fallback snapshots. A completed delete must make
  both roots omit the deleted entry before physical cleanup starts.
- Write new secret value chunks only for changed values. Reuse unchanged value
  records across snapshots.
- Set `MAX_SECURE_STORE_VALUE_BYTES` to exactly `1800`, measured from the UTF-8
  string passed to SecureStore. Set raw value chunks to `1350` bytes so base64
  output is at most 1800 bytes.
- Treat SecureStore writes and deletes as fallible requests, not durable
  acknowledgements. Validate staged records and tolerate acknowledged writes
  disappearing after restart.
- A valid snapshot without an ID is the only not-found case. Device lock,
  malformed data, native failures, and invalid roots must remain distinct.
- Recovery reads are side-effect free. Never prune, repair, overwrite, or delete
  while selecting a root.
- Serialize every mutation within a namespace. Do not use `Promise.all` as
  commit ordering.
- Replace-all is one storage transaction; do not reintroduce clear-then-upsert
  loops or concurrent per-key updates.
- Keep legacy connection migration on `makeBetterSecureStore`; this plan changes
  only private-key and restore-journal ownership.
- Keep each new production module below 500 lines. If a module approaches that
  boundary, split by codec, reading, mutation, or mobile integration ownership.
- Require a thermo-nuclear review of the complete diff before merge. Structural
  findings are blockers, not optional cleanup.
- Do not run mobile e2e, EAS builds, OTA updates, or destructive state-reset
  commands for this pure TypeScript storage change.

---

## File Structure

**Create production modules:**

- `apps/mobile/src/lib/transactional-secure-storage/contracts.ts` — public
  entry, adapter, status, dependency, and error contracts.
- `apps/mobile/src/lib/transactional-secure-storage/codec.ts` — canonical JSON,
  UTF-8 sizing, base64 value chunks, and SHA-256 input helpers.
- `apps/mobile/src/lib/transactional-secure-storage/records.ts` — strict Zod
  records and deterministic key construction.
- `apps/mobile/src/lib/transactional-secure-storage/legacy-reader.ts` —
  read-only version-1 snapshot and record inventory.
- `apps/mobile/src/lib/transactional-secure-storage/snapshot-reader.ts` — root,
  manifest, entry, and value validation with side-effect-free fallback.
- `apps/mobile/src/lib/transactional-secure-storage/transaction-writer.ts` —
  redundant intents, immutable staging, root publication, delete checkpoint, and
  cleanup inventory.
- `apps/mobile/src/lib/transactional-secure-storage/store.ts` — namespace mutex,
  public methods, migration state, and startup recovery.
- `apps/mobile/src/lib/transactional-secure-storage/index.ts` — canonical public
  exports only.
- `apps/mobile/src/lib/secure-storage-services.ts` — private-key and
  restore-journal stores plus their read-only legacy sources.
- `apps/mobile/src/lib/secrets-manager-initialization.ts` — testable ordering
  for secure storage, connection migration, and pending-restore recovery.

**Create test support and focused tests:**

- `apps/mobile/test/integration/helpers/fault-injecting-string-storage.ts`
- `apps/mobile/test/integration/helpers/transactional-storage-fixtures.ts`
- `apps/mobile/test/integration/transactional-storage-codec.test.ts`
- `apps/mobile/test/integration/transactional-storage-legacy-reader.test.ts`
- `apps/mobile/test/integration/transactional-storage-recovery.test.ts`
- `apps/mobile/test/integration/transactional-storage-mutations.test.ts`
- `apps/mobile/test/integration/transactional-storage-migration.test.ts`
- `apps/mobile/test/integration/secure-storage-services.test.ts`
- `apps/mobile/test/integration/secrets-manager-initialization.test.ts`

**Modify:**

- `apps/mobile/package.json` and `pnpm-lock.yaml` — declare `base64-js`
  directly.
- `apps/mobile/src/lib/device-migration.ts` — replace all private keys with one
  atomic storage call.
- `apps/mobile/src/lib/secrets-manager.ts` — construct and initialize the new
  services and expose the direct `{ id, metadata, value }` entry shape.
- `apps/mobile/src/components/key-manager/KeyList.tsx` — consume the direct
  entry shape and update all default flags in one replace-all transaction.
- `apps/mobile/test/integration/device-migration.test.ts` — cover atomic
  replacement without the legacy clear/upsert adapter.
- `apps/mobile/test/integration/security-center-flow.test.ts` — remove the
  source-regex wiring test; service behavior moves to the focused service test.

**Reference without modifying:**

- `apps/mobile/src/lib/chunked-storage.ts` — version-1 format and legacy
  connection migration remain available.
- `docs/superpowers/specs/2026-07-12-transactional-secure-storage-model-design.md`
- `docs/wayfinder/source-quality-recovery/research/2026-07-12-securestore-failure-semantics.md`

## Published Interfaces

Define these contracts once in `contracts.ts`; every later task uses these exact
names and shapes:

```ts
export type AsyncStringStorage = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
};

export type LoggerLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export type SecureEntry<Metadata extends object, Value> = {
	id: string;
	metadata: Metadata;
	value: Value;
};

export type StorageOpenStatus =
	| 'initialized'
	| 'migrated'
	| 'current'
	| 'recovered';

export type StorageOpenResult = {
	status: StorageOpenStatus;
	cleanupPending: boolean;
};

export type LegacySnapshot<Metadata extends object, Value> = {
	status: 'absent' | 'present';
	entries: SecureEntry<Metadata, Value>[];
	recordKeys: string[];
};

export type LegacySnapshotReader<Metadata extends object, Value> = {
	read(): Promise<LegacySnapshot<Metadata, Value>>;
};

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export type TransactionalSecureStore<Metadata extends object, Value> = {
	ensureReady(): Promise<StorageOpenResult>;
	getEntry(id: string): Promise<SecureEntry<Metadata, Value> | null>;
	listEntries(): Promise<SecureEntry<Metadata, Value>[]>;
	upsertEntry(entry: SecureEntry<Metadata, Value>): Promise<void>;
	replaceAllEntries(entries: SecureEntry<Metadata, Value>[]): Promise<void>;
	deleteEntry(id: string): Promise<void>;
	retryCleanup(): Promise<void>;
};

export class SecureStorageUnavailableError extends Error {}
export class SecureStorageCorruptionError extends Error {}
export class SecureStorageWriteNotCommittedError extends Error {}
```

`createTransactionalSecureStore()` accepts this exact dependency object:

```ts
export type TransactionalSecureStoreOptions<Metadata extends object, Value> = {
	namespace: string;
	metadataSchema: z.ZodType<Metadata>;
	serializeValue(value: Value): string;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
	legacy: LegacySnapshotReader<Metadata, Value>;
	randomUUID(): string;
	sha256: Sha256;
	logger?: LoggerLike;
};
```

### Task 1: Add the Byte-Safe Codec and Real Storage Test Double

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/mobile/src/lib/transactional-secure-storage/contracts.ts`
- Create: `apps/mobile/src/lib/transactional-secure-storage/codec.ts`
- Create:
  `apps/mobile/test/integration/helpers/fault-injecting-string-storage.ts`
- Create: `apps/mobile/test/integration/transactional-storage-codec.test.ts`

**Interfaces:**

- Produces: `MAX_SECURE_STORE_VALUE_BYTES`, `MAX_RAW_VALUE_CHUNK_BYTES`,
  `canonicalJson`, `utf8ByteLength`, `encodeValueChunks`, `decodeValueChunks`,
  `assertPayloadFits`, all published contracts, and
  `FaultInjectingStringStorage`.

- [ ] **Step 1: Declare the existing transitive base64 library directly**

Run:

```sh
pnpm --filter @fressh/mobile add base64-js@1.5.1
```

Expected: `apps/mobile/package.json` lists `base64-js` under dependencies and
the lockfile remains on version 1.5.1.

- [ ] **Step 2: Write failing codec tests**

Create `transactional-storage-codec.test.ts` with tests that assert this exact
behavior:

```ts
void test('value chunks stay under 1800 UTF-8 bytes and preserve Unicode', () => {
	const value = `${'a'.repeat(1349)}🙂${'界'.repeat(900)}`;
	const chunks = encodeValueChunks(value);
	assert.ok(chunks.length > 1);
	assert.ok(
		chunks.every(
			(chunk) => utf8ByteLength(chunk) <= MAX_SECURE_STORE_VALUE_BYTES,
		),
	);
	assert.equal(decodeValueChunks(chunks), value);
});

void test('canonicalJson ignores object insertion order', () => {
	assert.equal(
		canonicalJson({ z: 1, nested: { b: true, a: 'x' } }),
		canonicalJson({ nested: { a: 'x', b: true }, z: 1 }),
	);
});

void test('assertPayloadFits rejects 1801 UTF-8 bytes', () => {
	assert.throws(() => assertPayloadFits('x'.repeat(1801)), /1800 UTF-8 bytes/);
});
```

- [ ] **Step 3: Run the codec test and observe RED**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/transactional-storage-codec.test.ts
```

Expected: FAIL because `codec.ts` and its exports do not exist.

- [ ] **Step 4: Implement the codec directly**

Use `TextEncoder`, `TextDecoder`, `base64-js.fromByteArray`, and
`base64-js.toByteArray`. Export these exact constants:

```ts
export const MAX_SECURE_STORE_VALUE_BYTES = 1800;
export const MAX_RAW_VALUE_CHUNK_BYTES = 1350;
```

`encodeValueChunks` must encode the full string to UTF-8 first, slice the byte
array in 1350-byte pieces, then base64 each piece. `decodeValueChunks` must
base64-decode, concatenate bytes, and call
`new TextDecoder('utf-8', { fatal: true })`. `canonicalJson` recursively sorts
object keys, preserves array order, and omits undefined object fields exactly as
`JSON.stringify` does.

- [ ] **Step 5: Add the restartable storage test double**

Implement a test-only class with this public surface:

```ts
export type StorageFault =
	| 'throw-before'
	| 'throw-after-visible'
	| 'volatile-success'
	| 'delete-noop';

export class FaultInjectingStringStorage implements AsyncStringStorage {
	readonly operationLog: { type: 'get' | 'set' | 'delete'; key: string }[];
	constructor(initial?: Record<string, string>);
	failOperation(operationNumber: number, fault: StorageFault): void;
	restart(): void;
	snapshotDurable(): Record<string, string>;
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
}
```

Copy the published interfaces into `contracts.ts` before implementing the test
double. Maintain separate visible and durable maps. `throw-before` changes
neither map; `throw-after-visible` changes visible state then throws;
`volatile-success` changes visible state and resolves; `delete-noop` resolves
without deleting. `restart()` replaces visible state with durable state. Faults
are one-shot and operation numbers count set/delete operations only. Tests will
assert real reopened store behavior, never the test double itself.

- [ ] **Step 6: Run the focused test and commit**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/transactional-storage-codec.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

Commit:

```sh
git add apps/mobile/package.json pnpm-lock.yaml \
  apps/mobile/src/lib/transactional-secure-storage/codec.ts \
  apps/mobile/src/lib/transactional-secure-storage/contracts.ts \
  apps/mobile/test/integration/helpers/fault-injecting-string-storage.ts \
  apps/mobile/test/integration/transactional-storage-codec.test.ts
git commit -m "Add byte-safe secure storage codec"
```

### Task 2: Define Strict V2 Records and Deterministic Keys

**Files:**

- Modify: `apps/mobile/src/lib/transactional-secure-storage/contracts.ts`
- Create: `apps/mobile/src/lib/transactional-secure-storage/records.ts`
- Create: `apps/mobile/src/lib/transactional-secure-storage/index.ts`
- Modify: `apps/mobile/test/integration/transactional-storage-codec.test.ts`

**Interfaces:**

- Produces: `buildV2Keys`, `createRecordSchemas`, `hashCanonicalRecord`, and
  strict record types from the approved design.

- [ ] **Step 1: Add failing key and schema tests**

Add individual equality tests for these exact keys; do not compare objects that
contain newly created function values:

```ts
const keys = buildV2Keys('privateKey');
assert.equal(keys.root.a, 'privateKey-v2-root-a');
assert.equal(keys.root.b, 'privateKey-v2-root-b');
assert.equal(keys.intent.a, 'privateKey-v2-intent-a');
assert.equal(keys.intent.b, 'privateKey-v2-intent-b');
assert.equal(
	keys.intentPlan('attempt', 2),
	'privateKey-v2-intent-plan-attempt-2',
);
assert.equal(keys.manifest('attempt', 3), 'privateKey-v2-manifest-attempt-3');
assert.equal(keys.entry('attempt', 4), 'privateKey-v2-entry-attempt-4');
assert.equal(keys.value('attempt-4', 5), 'privateKey-v2-value-attempt-4-5');
assert.equal(keys.cleanup('attempt', 6), 'privateKey-v2-cleanup-attempt-6');
```

Also assert that every schema rejects the wrong namespace, unknown fields,
negative counts, unsafe keys, duplicate root slots, and payloads above 1800
bytes.

- [ ] **Step 2: Run RED**

Run the codec test. Expected: FAIL because `contracts.ts` and `records.ts` do
not exist.

- [ ] **Step 3: Implement the exact contracts and schemas**

Keep the published interfaces in `contracts.ts`. In `records.ts`, use
`z.strictObject` and define these records exactly:

```ts
TransactionIntentV2;
IntentPlanPageV2; // one planned storage key plus optional next page key
RootCommitV2;
ManifestEntryRefV2;
ManifestPageV2; // zero or one entry ref plus optional next page key
EntryRevisionV2<Metadata>; // valueRecordId + valueChunkCount, never a key array
CleanupPageV2; // one garbage key plus optional next page key
```

Use one manifest entry and one cleanup key per page. This removes page-packing
branches and guarantees bounded metadata. An empty snapshot has one manifest
page with no entry. Hash JSON records with their own hash field omitted;
`manifestSha256` hashes canonical `{ snapshotId, pageHashes }` and `planSha256`
hashes canonical `{ pageHashes }`.

- [ ] **Step 4: Export only the canonical API and verify GREEN**

At this stage, `index.ts` exports contracts and errors only. Task 5 adds
`createTransactionalSecureStore` after that function exists. It must never
expose internal page-writing helpers.

Run the focused test and typecheck. Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/mobile/src/lib/transactional-secure-storage \
  apps/mobile/test/integration/transactional-storage-codec.test.ts
git commit -m "Define transactional secure storage records"
```

### Task 3: Read Version-1 Data Without Mutating It

**Files:**

- Create: `apps/mobile/src/lib/transactional-secure-storage/legacy-reader.ts`
- Create:
  `apps/mobile/test/integration/transactional-storage-legacy-reader.test.ts`

**Interfaces:**

- Consumes: `AsyncStringStorage`, `LegacySnapshotReader`, Zod metadata schema,
  `buildChunkedStoreKeys`.
- Produces: `createLegacyChunkedStorageReader<Metadata, Value>()`.

- [ ] **Step 1: Write failing version-1 reader tests**

Seed version-1 storage with `makeBetterSecureStore`, then use a wrapper whose
`setItem` and `deleteItem` throw. Assert the reader returns all entries across
multiple manifest chunks and an inventory containing root, manifest, and value
chunk keys. Add separate tests where a manifest chunk or value chunk is missing;
both must reject with `SecureStorageCorruptionError` and perform no writes.

- [ ] **Step 2: Run RED**

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/transactional-storage-legacy-reader.test.ts
```

Expected: FAIL because the read-only reader does not exist.

- [ ] **Step 3: Implement the read-only reader**

Use this exact factory signature:

```ts
export function createLegacyChunkedStorageReader<
	Metadata extends object,
	Value,
>(options: {
	storagePrefix: string;
	metadataSchema: z.ZodType<Metadata>;
	parseValue(raw: string): Value;
	storage: AsyncStringStorage;
}): LegacySnapshotReader<Metadata, Value>;
```

Read the root once. `null` returns `status: 'absent'`; any present but malformed
root is corruption. Require every referenced manifest and value chunk, reject
duplicate entry IDs, preserve manifest order, and return every key read in
`recordKeys`. Never call `setItem` or `deleteItem`.

- [ ] **Step 4: Run GREEN and commit**

Run the focused test and typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/transactional-secure-storage/legacy-reader.ts \
  apps/mobile/test/integration/transactional-storage-legacy-reader.test.ts
git commit -m "Add read-only legacy secure storage reader"
```

### Task 4: Validate Complete Snapshots and Fall Back Without Writes

**Files:**

- Create: `apps/mobile/src/lib/transactional-secure-storage/snapshot-reader.ts`
- Create:
  `apps/mobile/test/integration/helpers/transactional-storage-fixtures.ts`
- Create: `apps/mobile/test/integration/transactional-storage-recovery.test.ts`

**Interfaces:**

- Produces: internal `ValidatedSnapshot`, `readRootCandidate`, `selectSnapshot`,
  and `collectReachableKeys`.

- [ ] **Step 1: Create a real-record fixture writer**

The test helper writes schema-valid root, manifest, revision, and value records
through `AsyncStringStorage`. It accepts `{ slot, commitGeneration, entries }`
and uses the production codec, schemas, key builder, and injected SHA-256. It
must not bypass production serialization.

- [ ] **Step 2: Write failing recovery tests**

Cover these separate behaviors:

```text
selects the higher complete root
falls back when the higher root references a missing manifest page
falls back when a value disappears after restart
rejects duplicate entry IDs, manifest loops, wrong hashes, and byte mismatches
returns no-valid-state when both present roots are invalid
returns absent when both root keys are missing
does not call setItem or deleteItem while opening
propagates SecureStorageUnavailableError without marking a root corrupt
```

Each corruption test changes one stored record after the valid fixture is
written and asserts the selected entry values, not internal helper calls.

- [ ] **Step 3: Run RED**

Run the recovery test. Expected: FAIL because `snapshot-reader.ts` is missing.

- [ ] **Step 4: Implement side-effect-free validation**

`ValidatedSnapshot<Metadata, Value>` contains:

```ts
{
	slot: 'a' | 'b';
	root: RootCommitV2;
	entries: ReadonlyMap<string, SecureEntry<Metadata, Value>>;
	revisions: ReadonlyMap<string, EntryRevisionV2<Metadata>>;
	reachableKeys: ReadonlySet<string>;
}
```

Validate exact page counts, a visited-key set, zero-or-one entry per page,
ordered unique IDs, revision hashes, derived value keys, base64 decoding, byte
length, and final SHA-256. Parse errors and missing referenced records
invalidate only that candidate. Adapter errors become
`SecureStorageUnavailableError` and abort selection; they are not corruption.

- [ ] **Step 5: Run GREEN and commit**

Run recovery tests and typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/transactional-secure-storage/snapshot-reader.ts \
  apps/mobile/test/integration/helpers/transactional-storage-fixtures.ts \
  apps/mobile/test/integration/transactional-storage-recovery.test.ts
git commit -m "Add complete snapshot recovery"
```

### Task 5: Publish Atomic Upsert and Replace-All Transactions

**Files:**

- Create:
  `apps/mobile/src/lib/transactional-secure-storage/transaction-writer.ts`
- Create: `apps/mobile/src/lib/transactional-secure-storage/store.ts`
- Create: `apps/mobile/test/integration/transactional-storage-mutations.test.ts`

**Interfaces:**

- Produces: `createTransactionalSecureStore`, serialized `upsertEntry` and
  `replaceAllEntries`, redundant intent recovery, and immutable value reuse.

- [ ] **Step 1: Write the failing happy-path and reuse tests**

Use the Task 4 fixture writer to seed a valid empty snapshot in both roots, then
create a store with a missing legacy source and real fault-injecting storage.
This keeps fresh/legacy initialization in Task 7. Assert:

```ts
await store.replaceAllEntries([first, second]);
await store.upsertEntry({
	...first,
	metadata: { ...first.metadata, label: 'Renamed' },
});

assert.deepEqual(await store.listEntries(), [
	{ ...first, metadata: { ...first.metadata, label: 'Renamed' } },
	second,
]);
```

Inspect durable key/value records to prove the rename creates a new entry
revision but no new `-v2-value-` keys. Add a concurrent test that starts two
upserts together and asserts both changes are present in the final snapshot.

- [ ] **Step 2: Write the failing write-boundary matrix**

First run one successful upsert and record its set/delete operation count. For
each operation number, start from the same durable old snapshot, inject
`throw-before`, restart, construct a fresh store, and assert reopened entries
equal either the entire old state or the entire new state—never a mixture.
Repeat with `throw-after-visible` and `volatile-success`.

- [ ] **Step 3: Run RED**

Run the mutation test. Expected: FAIL because the store and writer do not exist.

- [ ] **Step 4: Implement one direct serialized transaction flow**

Inside `createTransactionalSecureStore`, use one promise tail:

```ts
let mutationTail: Promise<void> = Promise.resolve();
const serializeMutation = <Result>(run: () => Promise<Result>) => {
	const result = mutationTail.then(run, run);
	mutationTail = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
};
```

Do not create a generic mutex class. `transaction-writer.ts` implements one
`commitSnapshot` path used by upsert and replace-all:

```ts
commitSnapshot({
	base,
	nextEntries,
	targetSlots: [olderSlot],
	cleanupKeys,
});
```

It must: derive every key; write both intent headers; write one planned key per
intent page; validate all intent pages; write changed value chunks; reuse value
records when hash and byte length match; write revisions; write manifest pages
tail-first; validate the staged snapshot; write the target root last; reopen;
then clear stale intents best-effort. If any pre-root step fails, throw
`SecureStorageWriteNotCommittedError` and leave both roots unchanged.

`replaceAllEntries` rejects duplicate IDs before storage writes and commits the
complete array once. Sort manifest entry IDs lexically for canonical snapshots;
preserve `priority` only as metadata.

Update `index.ts` to export `createTransactionalSecureStore` from `store.ts`.

- [ ] **Step 5: Run GREEN, refactor only after green, and commit**

Run codec, recovery, mutation tests, then typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/transactional-secure-storage \
  apps/mobile/test/integration/transactional-storage-mutations.test.ts
git commit -m "Add transactional secure storage mutations"
```

### Task 6: Make Delete Durable Before Best-Effort Cleanup

**Files:**

- Modify:
  `apps/mobile/src/lib/transactional-secure-storage/transaction-writer.ts`
- Modify: `apps/mobile/src/lib/transactional-secure-storage/store.ts`
- Modify: `apps/mobile/test/integration/transactional-storage-mutations.test.ts`

**Interfaces:**

- Produces: `deleteEntry` and `retryCleanup` using the same transaction path.

- [ ] **Step 1: Add failing delete tests**

Assert a successful delete leaves both root values referencing the same snapshot
without the entry before any old value key is deleted. Inject failure at the
first and second root writes; after restart, assert either the complete
pre-delete or complete post-delete state. Inject `delete-noop`; the key remains
logically absent, cleanup is pending, and a later `retryCleanup()` retries it.

- [ ] **Step 2: Run RED**

Expected: delete tests fail because current delete support is absent.

- [ ] **Step 3: Implement delete as a two-root commit**

Call `commitSnapshot` with `targetSlots: [olderSlot, remainingSlot]`. Both root
commits reference the same staged manifest; the second uses the next commit
generation. Build cleanup pages before either root write and list the removed
revision, its derived value chunks, old manifest pages that become unreachable,
and carried cleanup failures.

Only records outside the union of both newly validated roots are eligible for
delete. Cleanup page loss never invalidates entry reads. Never delete either
root or intent key. `deleteEntry` returns only after both roots validate, then
runs a bounded cleanup pass without turning cleanup failure into logical
failure.

- [ ] **Step 4: Run GREEN and commit**

Run mutation and recovery tests plus typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/transactional-secure-storage \
  apps/mobile/test/integration/transactional-storage-mutations.test.ts
git commit -m "Add recoverable secure storage deletion"
```

### Task 7: Migrate Legacy Records Only After a Fresh Reopen

**Files:**

- Modify: `apps/mobile/src/lib/transactional-secure-storage/store.ts`
- Create: `apps/mobile/test/integration/transactional-storage-migration.test.ts`

**Interfaces:**

- Produces: `ensureReady()` initialization, idempotent v1 migration, redundant
  intent recovery, and delayed legacy cleanup.

- [ ] **Step 1: Write failing migration tests**

Use the version-1 writer to seed multiple private-key entries. Assert the first
store instance migrates and reads them but leaves every v1 key durable. Restart
the storage, create a second store, reopen v2, and only then assert cleanup
attempts remove v1 keys. Add tests for:

```text
empty fresh storage initializes both roots
empty but present v1 manifest migrates
interruption at every migration write boundary preserves readable v1 data
volatile v2 roots disappear on restart and migration retries from v1
one surviving v2 root is mirrored before legacy cleanup
legacy cleanup failure leaves v2 readable and retries next launch
malformed present v1 data never initializes an empty v2 store
stale or disagreeing intent headers are recovered before a new attempt
```

- [ ] **Step 2: Run RED**

Run the migration test. Expected: FAIL because `ensureReady` does not implement
these transitions.

- [ ] **Step 3: Implement the explicit startup state machine**

Use these states, without boolean combinations:

```ts
type StartupState =
	| { type: 'fresh' }
	| { type: 'legacy'; snapshot: LegacySnapshot<Metadata, Value> }
	| { type: 'v2'; snapshot: ValidatedSnapshot<Metadata, Value> }
	| { type: 'recovered'; snapshot: ValidatedSnapshot<Metadata, Value> }
	| { type: 'unavailable'; error: SecureStorageUnavailableError }
	| { type: 'corrupt'; error: SecureStorageCorruptionError };
```

If both v2 roots are absent, read legacy. A present legacy snapshot initializes
both roots but sets an in-memory `createdV2ThisInstance` flag and does not
delete v1 records. A fresh store instance that opens existing v2 may retry
intent and cleanup work. Before v1 cleanup, ensure two valid roots exist; mirror
the selected snapshot if one root is absent. Carry every v1 record key in
cleanup pages until deletion is observed or retried.

If any v2 root is present but neither is valid, use a readable legacy snapshot;
otherwise throw corruption. Never interpret malformed present data as fresh.

- [ ] **Step 4: Run GREEN and commit**

Run all transactional-storage tests and typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/transactional-secure-storage/store.ts \
  apps/mobile/test/integration/transactional-storage-migration.test.ts
git commit -m "Add automatic secure storage migration"
```

### Task 8: Integrate Private Keys and Make Replacement Atomic

**Files:**

- Create: `apps/mobile/src/lib/secure-storage-services.ts`
- Create: `apps/mobile/test/integration/secure-storage-services.test.ts`
- Modify: `apps/mobile/src/lib/device-migration.ts`
- Modify: `apps/mobile/test/integration/device-migration.test.ts`
- Modify: `apps/mobile/src/lib/secrets-manager.ts`
- Modify: `apps/mobile/src/components/key-manager/KeyList.tsx`

**Interfaces:**

- Produces: `createSecureStorageServices`, `KeyMetadata`, atomic private-key
  replacement, and direct private-key entries.

- [ ] **Step 1: Write failing service and atomic replacement tests**

The service test injects memory storage, SHA-256 from `node:crypto`, UUIDs, and
real legacy readers. Seed a v1 private key and assert initialization migrates it
with unchanged ID, metadata, value, and `createdAtMs`.

Change `PrivateKeyReplacementStorage` to:

```ts
export type PrivateKeyReplacementStorage = {
	replaceAllEntries(entries: BackupKeyEntry[]): Promise<void>;
};
```

Update the device-migration test to assert invalid keys cause zero replacement
calls and valid keys cause exactly one call with the full array.

- [ ] **Step 2: Run RED**

Run service and device-migration tests. Expected: FAIL because the service and
new atomic interface do not exist.

- [ ] **Step 3: Build the injected services**

Move `keyMetadataSchema` and `KeyMetadata` from `secrets-manager.ts` into
`secure-storage-services.ts`. The factory accepts the same adapter, hash, UUID,
and logger dependencies as the core and returns:

```ts
{
	initialize(): Promise<void>;
	privateKeys: TransactionalSecureStore<KeyMetadata, string>;
	restoreJournal: RestoreJournalStorage;
}
```

Create separate namespaces and legacy readers for `privateKey` and
`securityCenterRestoreJournal`. `restoreJournal` maps the `pending` entry to
JSON, returns null only when `getEntry` returns null, and deletes malformed JSON
through the v2 logical delete path.

- [ ] **Step 4: Replace clear-then-upsert with one transaction**

After validating every private key, `replaceAllPrivateKeys` must contain
exactly:

```ts
await params.storage.replaceAllEntries(params.entries);
```

No clear or per-entry loop remains.

- [ ] **Step 5: Rewire secrets manager and direct entry consumers**

Construct services with:

```ts
sha256: async (bytes) => {
	const digest = await Crypto.digest(
		Crypto.CryptoDigestAlgorithm.SHA256,
		bytes,
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
},
```

Initialize secure storage before `recoverPendingRestore`. Adapt the public
`getPrivateKey` wrapper to throw `Error('Entry not found')` only when the core
returns null. Change `KeyList.tsx` from `entry.manifestEntry.id/metadata` to
`entry.id/metadata`.

Replace the default-key `Promise.all(upsert...)` block with one call:

```ts
await secretsManager.keys.utils.replaceAllEntries(
	entries.map((entry) => ({
		...entry,
		metadata: {
			...entry.metadata,
			isDefault: entry.id === props.entryId,
		},
	})),
);
```

- [ ] **Step 6: Run GREEN and commit**

Run service, device-migration, key-usage, and transactional tests; then run
typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/secure-storage-services.ts \
  apps/mobile/src/lib/device-migration.ts \
  apps/mobile/src/lib/secrets-manager.ts \
  apps/mobile/src/components/key-manager/KeyList.tsx \
  apps/mobile/test/integration/secure-storage-services.test.ts \
  apps/mobile/test/integration/device-migration.test.ts
git commit -m "Migrate private keys to transactional storage"
```

### Task 9: Migrate the Restore Journal Before Recovery Runs

**Files:**

- Modify: `apps/mobile/test/integration/secure-storage-services.test.ts`
- Modify: `apps/mobile/test/integration/security-center-flow.test.ts`
- Modify: `apps/mobile/src/lib/secrets-manager.ts`
- Create: `apps/mobile/src/lib/secrets-manager-initialization.ts`
- Create: `apps/mobile/test/integration/secrets-manager-initialization.test.ts`

**Interfaces:**

- Consumes: `createSecureStorageServices`, `recoverPendingRestore`.
- Produces: startup ordering that migrates the pending journal before restore
  recovery reads it.

- [ ] **Step 1: Add failing restore-journal migration tests**

Seed a version-1 `securityCenterRestoreJournal` entry named `pending` with a
real pending restore state. Assert first-instance initialization reads it
through v2, keeps v1 durable, and a second instance after restart still loads
the identical state before cleanup. Interrupt every migration write boundary and
assert either the v1 or v2 journal remains loadable.

Add an integration test around `initializeSecretsManagerServices()` that records
events and proves both initialization promises settle before journal loading:

```text
secureStorage.initialize settled
connectionStorage.ensureReady settled
restoreJournal.load
recoverPendingRestore replacements, when needed
```

Remove the final source-regex test and its now-unused `node:fs`, `node:path`,
and `node:url` imports from `security-center-flow.test.ts`.

- [ ] **Step 2: Run RED**

Run service and security-center-flow tests. Expected: the migration/order test
fails before secrets-manager wiring is updated.

- [ ] **Step 3: Make startup ordering explicit**

Create `secrets-manager-initialization.ts` with this exact injected boundary:

```ts
export async function initializeSecretsManagerServices<Result>(params: {
	initializeSecureStorage: () => Promise<void>;
	ensureConnectionsReady: () => Promise<void>;
	recoverPendingRestore: () => Promise<Result>;
}): Promise<Result> {
	await Promise.all([
		params.initializeSecureStorage(),
		params.ensureConnectionsReady(),
	]);
	return params.recoverPendingRestore();
}
```

Call it from `secrets-manager.ts` with:

```ts
const recovery = await initializeSecretsManagerServices({
	initializeSecureStorage: secureStorageServices.initialize,
	ensureConnectionsReady: connectionStorage.ensureReady,
	recoverPendingRestore: () =>
		recoverPendingRestore({
			restoreJournal: secureStorageServices.restoreJournal,
			listCurrentKeys: secureStorageServices.privateKeys.listEntries,
			listCurrentConnections: connectionStorage.listEntriesWithValues,
			replaceAllKeys: replaceAllPrivateKeyEntries,
			replaceAllConnections,
		}),
});
```

The two migrations are independent and may run together; restore recovery must
start only after both finish.

- [ ] **Step 4: Run GREEN and commit**

Run service, security-center-flow, device-migration, and all transactional
tests; then typecheck. Expected: PASS.

```sh
git add apps/mobile/src/lib/secrets-manager.ts \
  apps/mobile/src/lib/secrets-manager-initialization.ts \
  apps/mobile/test/integration/secure-storage-services.test.ts \
  apps/mobile/test/integration/secrets-manager-initialization.test.ts \
  apps/mobile/test/integration/security-center-flow.test.ts
git commit -m "Migrate restore journal before startup recovery"
```

### Task 10: Complete the Fault Matrix and Pass the Merge Gates

**Files:**

- Test: all `transactional-storage-*.test.ts`
- Test: `apps/mobile/test/integration/secure-storage-services.test.ts`
- Review: every file listed in this plan's create/modify sections.

**Interfaces:**

- Produces: fresh evidence for rollback, migration, cleanup, type, lint, and
  maintainability acceptance.

- [ ] **Step 1: Audit every spec obligation against a named test**

Use this checklist; add a focused failing test before fixing any gap:

```text
[ ] every staged write boundary: throw before, throw after visible, volatile success
[ ] both intent headers: missing, stale, corrupt, and disagreeing
[ ] manifest: missing, malformed, looped, duplicate, reordered, wrong hash
[ ] entry/value: missing chunk, invalid base64, wrong byte count, wrong hash
[ ] newest invalid root falls back without writes
[ ] both invalid roots use readable v1; no legacy means explicit corruption
[ ] concurrent mutations preserve both updates
[ ] unchanged secret chunks are reused
[ ] delete interruption at both root writes
[ ] delete-noop keeps logical absence and retries cleanup
[ ] cleanup never removes either-root reachable records
[ ] fresh instance gate precedes legacy cleanup
[ ] private-key and restore-journal migration are independently idempotent
[ ] ASCII, multibyte Unicode, and surrogate pairs honor 1800 bytes
[ ] unavailable errors never become not-found or corruption
```

- [ ] **Step 2: Run targeted formatting**

Run:

```sh
pnpm exec cross-env SORT_IMPORTS=true prettier --check \
  apps/mobile/src/lib/transactional-secure-storage \
  apps/mobile/src/lib/secure-storage-services.ts \
  apps/mobile/src/lib/secrets-manager-initialization.ts \
  apps/mobile/src/lib/device-migration.ts \
  apps/mobile/src/lib/secrets-manager.ts \
  apps/mobile/src/components/key-manager/KeyList.tsx \
  apps/mobile/test/integration/transactional-storage-*.test.ts \
  apps/mobile/test/integration/secure-storage-services.test.ts \
  apps/mobile/test/integration/secrets-manager-initialization.test.ts \
  apps/mobile/test/integration/device-migration.test.ts \
  apps/mobile/test/integration/security-center-flow.test.ts
```

Expected: PASS. If it fails, run the identical path list with `--write`, inspect
the diff, and rerun `--check`.

- [ ] **Step 3: Run focused and full mobile verification**

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/transactional-storage-*.test.ts \
  test/integration/secure-storage-services.test.ts \
  test/integration/secrets-manager-initialization.test.ts \
  test/integration/device-migration.test.ts \
  test/integration/security-center-flow.test.ts \
  test/integration/key-usage.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
```

Expected: every command exits zero with no failed tests or lint warnings. Do not
substitute e2e or device testing.

- [ ] **Step 4: Run the required thermo-nuclear review**

Invoke `$thermo-nuclear-code-quality-review` on the complete storage-v2 diff.
The review must explicitly confirm:

```text
[ ] no production file exceeds 500 lines because of this change
[ ] codec, schemas, reading, writing, and mobile wiring have separate ownership
[ ] legacy behavior is isolated in legacy-reader.ts, not branched through the core
[ ] upsert, replace-all, delete, and migration share one commit path
[ ] no catch-all converts unavailable/corrupt state into empty or missing state
[ ] no clear-then-upsert, delete-before-write, or Promise.all commit protocol remains
[ ] no thin wrappers, cast-heavy records, test-only production APIs, or source-regex tests remain
[ ] cleanup is outside logical correctness and cannot delete either-root live data
[ ] the implementation matches the approved two-root model without extra modes
```

Treat every structural finding as blocking. For a behavior change, write and
observe a failing test first. Repeat formatting and all verification after the
last review-driven edit.

- [ ] **Step 5: Capture fresh final evidence**

After the review is clean, rerun in this order:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/transactional-storage-*.test.ts test/integration/secure-storage-services.test.ts test/integration/secrets-manager-initialization.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
git diff --check
git status --short
```

Expected: tests, typecheck, lint, integration suite, and diff check exit zero.
`git status --short` may show unrelated pre-existing files, but every file from
this plan must be accounted for and no generated or device-state artifact may
appear.

- [ ] **Step 6: Commit only final review corrections**

If the review required changes, stage only their exact storage-v2 files and
commit:

```sh
git diff --cached --check
git commit -m "Harden transactional secure storage recovery"
```

If no correction remains, do not create an empty commit.

## Self-Review Notes

- Spec coverage: tasks cover byte-safe encoding, strict records, redundant
  intents, side-effect-free fallback, serialized upsert/replace, two-root
  delete, retryable cleanup, fresh-instance migration, private keys, restore
  journal, every write boundary, and delayed legacy deletion.
- Data preservation: version-1 records remain untouched through the first v2
  commit and are eligible for cleanup only from a fresh store instance with
  validated v2 roots.
- API cleanup: new callers use `{ id, metadata, value }`; the old
  `manifestEntry` storage detail stays only in legacy connection code.
- Atomic replacement: backup restore and default-key updates use one
  `replaceAllEntries` transaction.
- Placeholder scan: no reserved markers, unspecified handlers, or unnamed tests
  remain.
- Type consistency: `SecureEntry`, `TransactionalSecureStore`,
  `LegacySnapshotReader`, `StorageOpenResult`, error classes, method names, and
  service names are consistent across all tasks.
- Maintainability: the plan avoids a replacement giant storage file by giving
  codec, schema, reader, writer, orchestration, and mobile wiring one owner
  each.
- Scope: connection migration, backup file format, authentication policy,
  physical-device rollout, and uninstall recovery remain unchanged.
