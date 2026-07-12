# Transactional Secure Storage V2 Model Design

## Context

Fressh currently stores private keys and the restore journal through
`makeBetterSecureStore()`. Its version-1 format deletes an existing entry before
writing its replacement, publishes some references before their data, mutates a
live manifest during recovery, and sizes chunks by JavaScript string length.
Those choices can expose partial state or lose the last readable copy after a
write, delete, or crash failure.

The completed
[SecureStore Failure and Commit Semantics](../../wayfinder/source-quality-recovery/research/2026-07-12-securestore-failure-semantics.md)
research establishes a narrow platform contract. Expo SecureStore provides
fallible per-key string operations, not cross-key transactions. Android write
completion and iOS delete completion are not durable acknowledgements. Reads can
return ambiguous `null`, and records must stay under an application-owned UTF-8
byte ceiling.

## User Decisions

The human-in-the-loop design session fixed four product choices:

1. If a new save is incomplete, Fressh automatically uses the last complete
   state.
2. Normal saves retain two complete logical states: the current state and one
   fallback state. A completed delete deliberately makes both roots point to the
   same state without the deleted key so cleanup cannot resurrect it.
3. Updating one key writes new secret data only for that key. Unchanged key
   revisions are shared between the two logical states.
4. Deleting a key first removes it from the safely committed state, then erases
   unreachable encrypted records afterward.

The third choice means the two logical states are not full physical duplicates.
They protect against interrupted mutations, but they do not protect against the
platform independently losing a shared unchanged value record. Backup and
restore remain the protection for device loss or underlying SecureStore loss.

## Decision

Storage v2 will use two fixed root slots and immutable, generation-specific
records.

Each root slot points to one complete manifest snapshot. A mutation writes new
or changed records first, validates them, writes a complete immutable manifest,
and replaces the older root slot last. Startup validates both roots and selects
the highest complete generation. If that generation is incomplete, it uses the
other complete root without modifying either one.

Unchanged entry revisions and value chunks are reused by the new manifest.
Delete uses a second root publication so both root slots omit the deleted entry
before its old encrypted records become eligible for cleanup.

## Considered Models

### Chosen: two root slots with shared immutable records

This model writes only changed secret data, has a fixed recovery entry point,
and preserves one previous complete state. Its main cost is manifest metadata
rewriting and explicit garbage tracking.

### Rejected: two full physical snapshots

This model would duplicate every key on every mutation. Recovery would be
straightforward and unchanged records would have physical redundancy, but each
small metadata edit would rewrite every private key. The extra native writes
increase latency and failure exposure and conflict with the chosen
changed-key-only behavior.

### Rejected: fixed-ring or append-style commit journal

A longer journal would retain more history and could aid diagnostics. It also
requires more root slots, more recovery rules, and more garbage bookkeeping. The
product requires one fallback state, so the additional history does not justify
the complexity.

## Storage Namespaces

Every logical store has its own namespace. Private keys and the restore journal
must never share roots or generations.

Each namespace has exactly two fixed root keys:

```text
<namespace>-v2-root-a
<namespace>-v2-root-b
```

Each namespace also has two fixed transaction-intent keys:

```text
<namespace>-v2-intent-a
<namespace>-v2-intent-b
```

An attempt creates one random, key-safe attempt ID. Every immutable key created
by that attempt is deterministic from the attempt ID and an index recorded in
the intent plan:

```text
<namespace>-v2-intent-plan-<attempt-id>-<page-index>
<namespace>-v2-manifest-<attempt-id>-<page-index>
<namespace>-v2-entry-<attempt-id>-<entry-index>
<namespace>-v2-value-<attempt-id>-<entry-index>-<chunk-index>
<namespace>-v2-cleanup-<attempt-id>-<page-index>
```

Attempt IDs prevent a failed mutation from overwriting records used by either
root. Deterministic suffixes let recovery reconstruct every possible staged key
without SecureStore enumeration. Entry IDs remain inside schema-validated
records; revision IDs identify immutable stored revisions.

## Record Model

All JSON records use strict schemas and deterministic field order. Every record
contains `formatVersion: 2` and its namespace. Unknown versions fail validation
without being rewritten or deleted.

Hashes use SHA-256 with these exact inputs:

- a JSON record hash covers its canonical UTF-8 encoding with its own hash field
  omitted;
- `manifestSha256` covers the canonical encoding of `snapshotId` plus the
  ordered list of validated page hashes;
- `planSha256` covers the canonical encoding of the ordered intent plan pages;
  and
- `valueSha256` covers the reconstructed raw value bytes before base64 encoding.

These hashes detect incomplete or mismatched records. SecureStore provides the
confidentiality and platform-level integrity boundary; the hashes are not a
separate authenticity scheme.

### Transaction intent

Before writing any attempt-specific record, a mutation writes the same compact
intent header to both fixed intent keys:

```ts
type TransactionIntentV2 = {
	formatVersion: 2;
	namespace: string;
	attemptId: string;
	targetRootSlots: ('a' | 'b')[];
	firstCommitGeneration: number;
	snapshotId: string;
	planPageCount: number;
	planSha256: string;
};
```

The plan pages describe each entry index and value-chunk count plus the exact
manifest and cleanup page counts. Their keys are derived from `attemptId` and
`pageIndex`.

The mutation writes and reads back both intent headers before writing plan
pages, then writes and validates all plan pages before any secret or manifest
record. On startup, either surviving intent header is enough to reconstruct
every possible staged key. If the two headers describe different attempts,
recovery processes both independently before accepting a new mutation. Recovery
keeps records reachable from a valid root and moves all other planned keys into
cleanup.

Intent headers are cleared only after root publication and cleanup handoff. A
stale intent whose snapshot is already committed is harmless; recovery validates
reachability before deleting anything. Losing both acknowledged intent headers
while later staged records survive is an underlying multi-key platform-loss case
that SecureStore cannot make impossible, but the protocol does not create
undiscoverable keys during ordinary rejected writes or process crashes.

### Root commit

A root is deliberately small and contains:

```ts
type RootCommitV2 = {
	formatVersion: 2;
	namespace: string;
	commitGeneration: number;
	snapshotId: string;
	manifestHeadKey: string;
	manifestPageCount: number;
	entryCount: number;
	manifestSha256: string;
	cleanupHeadKey?: string;
};
```

`commitGeneration` orders the two candidates. `snapshotId` identifies the
logical state. Two root commits may intentionally reference the same snapshot,
as happens when deletion makes both roots forget the deleted entry.

The optional cleanup chain is maintenance metadata. Missing or corrupt cleanup
records never invalidate an otherwise complete data snapshot.

### Manifest pages

A manifest is an immutable linked chain of bounded pages. Each page contains an
ordered set of entry revision references plus the next page key. The last page
has no next key.

```ts
type ManifestEntryRefV2 = {
	entryId: string;
	revisionKey: string;
	revisionSha256: string;
};

type ManifestPageV2 = {
	formatVersion: 2;
	namespace: string;
	snapshotId: string;
	pageIndex: number;
	entries: ManifestEntryRefV2[];
	nextPageKey?: string;
	pageSha256: string;
};
```

Pages are written tail-first so every published page refers only to an already
written next page. The root's page count, entry count, and manifest hash prevent
truncation, loops, duplicated entry IDs, or page substitution from being
accepted as a complete snapshot.

A mutation builds a fresh manifest snapshot, but unchanged entries keep their
existing revision references. Only manifest metadata is rewritten for those
entries; their secret value chunks are not.

### Entry revisions

An entry revision contains metadata and the ordered value-chunk references:

```ts
type EntryRevisionV2<Metadata> = {
	formatVersion: 2;
	namespace: string;
	entryId: string;
	revisionId: string;
	metadata: Metadata;
	valueRecordId: string;
	valueChunkCount: number;
	valueByteLength: number;
	valueSha256: string;
};
```

The revision hash stored in its manifest reference covers the deterministic
entry-revision encoding. Value chunk keys are derived from `valueRecordId` and
the zero-based chunk index, so an arbitrarily chunked value cannot make its
entry-revision JSON exceed the SecureStore limit. A reader rejects a revision if
its entry ID, hash, chunk count, byte length, or final value hash does not
match.

### Value chunks

Values are converted to UTF-8 bytes, split on byte boundaries, and encoded as
base64 strings. Splitting bytes before base64 encoding avoids broken Unicode and
makes payload size predictable.

Storage v2 sets `MAX_SECURE_STORE_VALUE_BYTES` to `1800` for the exact string
passed to SecureStore. Every JSON record and base64 value chunk must pass that
UTF-8 byte-count check before a native write. Native rejection remains a handled
failure at any size, because 1800 bytes is a conservative Fressh policy rather
than a platform guarantee.

### Cleanup pages

Cleanup pages form a bounded linked list of known immutable keys that are no
longer reachable from either valid root. They are advisory and excluded from
snapshot validity.

Failed or unverified deletes stay on the next cleanup list. Because Expo cannot
enumerate keys, every created immutable key must appear in a manifest inventory
until it either remains reachable or is carried into cleanup bookkeeping.

## Opening and Recovery

Opening a namespace performs these steps without writing:

1. Read both fixed root keys.
2. Parse each root independently. A missing, unknown, or malformed root is an
   invalid candidate, not an empty store.
3. For each parsed root, walk its manifest pages with loop and count limits.
4. Validate page hashes, entry-reference uniqueness, entry revisions, all value
   chunks, byte lengths, and final value hashes.
5. Select the valid candidate with the highest `commitGeneration`.
6. If the higher candidate is invalid, use the lower valid candidate and report
   that recovery occurred.
7. If neither candidate is valid, try the read-only version-1 migration source.
   If no readable legacy state exists, return a recovery error rather than an
   empty key list.

Device-locked and authentication errors are operational failures. They do not
make a candidate corrupt and must not trigger pruning, fallback writes, or
migration.

Readers never repair roots or delete records while opening. Repair is an
explicit serialized mutation after a complete state has been returned.

## Normal Upsert

All mutations run through one namespace-local asynchronous mutex.

An upsert performs these steps in order:

1. Open and validate the current and fallback candidates.
2. Build the next logical snapshot in memory.
3. Allocate an attempt ID and derive every planned record key.
4. Write and read back both fixed intent headers.
5. Write and validate the deterministic intent plan pages.
6. For a changed entry, write new value chunks under the attempt ID.
7. Read back and compare every new value chunk.
8. Write and read back the new entry revision.
9. Reuse unchanged entry revision references.
10. Build, write tail-first, and read back a new manifest chain.
11. Reopen the complete staged snapshot through the same validator used at
    startup.
12. Write the new root commit to the older or invalid root slot.
13. Read both roots again and validate the newly selected state.
14. Hand unused planned keys to cleanup, then clear the intent headers.
15. Return success only when the new root is selected and complete.

The untouched root remains the fallback throughout preparation and commit. Any
rejection, mismatch, crash, or incomplete staged record leaves it readable.
Staged immutable records that never become reachable are garbage and may be
added to cleanup bookkeeping by a later successful mutation.

Metadata-only changes still create a new entry revision but reuse the existing
`valueRecordId`, chunk count, and value chunks when the value hash and length
are unchanged.

## Delete

Delete is a logical commit followed by physical cleanup:

1. Build and validate a snapshot that omits the entry.
2. Build cleanup pages that list the entry's old revision and value chunks.
3. Make the deletion snapshot's root commit reference those cleanup pages.
4. Publish it to the older root slot using the normal commit protocol.
5. Publish a second root commit, with a higher commit generation, to the
   remaining slot. It references the same deletion snapshot.
6. Validate that both root slots now resolve to the state without the entry and
   retain the cleanup inventory.
7. Return logical delete success.
8. Attempt physical deletion afterward.

If the app stops before both roots validate, the delete is unfinished and the
old complete state may return. Once delete reports success, both recovery roots
omit the entry before its old encrypted records are touched.

Physical delete failures do not resurrect the entry and do not invalidate the
logical operation. Fressh retries known garbage on startup and after later
successful commits. A resolved delete promise is followed by a read when useful,
but cleanup correctness never depends on that result.

## Garbage Collection

Garbage collection uses the union of records reachable from both valid roots. It
may delete only keys outside that union.

Cleanup follows these rules:

- Never delete through a root or manifest that has not passed full validation.
- Never delete the two fixed roots as routine cleanup.
- Retry failures and values that remain readable after deletion.
- Carry unverified keys into the next cleanup chain.
- Do not block reads or logically committed mutations on cleanup.
- Bound each cleanup pass so startup and UI work are not delayed indefinitely.
- Log record identifiers and error categories, never private-key values.

The redundant fixed transaction intent and deterministic attempt keys make
records from an interrupted mutation discoverable without enumeration. Recovery
must process a surviving intent before starting another mutation. It preserves
anything reachable from either valid root and queues all other planned keys for
cleanup.

## Concurrency

One namespace-local mutex covers opening for mutation, generation allocation,
record writes, root publication, and logical deletion. Public mutating methods
must not perform their own independent read-modify-write cycles.

The two-root protocol is process-local. Expo SecureStore and SharedPreferences
do not provide multi-process isolation. Fressh must keep private-key mutations
inside the main app process and document that app extensions or a second process
cannot write the same namespace.

Reads may run concurrently from an already validated immutable snapshot. A
consumer receives a snapshot or entry value, not mutable manifest objects.

## Error Contract

Storage v2 distinguishes these outcomes:

- **not found:** a valid selected snapshot has no such entry;
- **temporarily unavailable:** device lock, authentication, or transient native
  failure prevents a trustworthy read;
- **recovered:** the newest candidate is invalid and the previous complete
  candidate was selected;
- **no valid state:** neither root nor the legacy source is readable;
- **write not committed:** staging or root publication failed and the previous
  selected state remains authoritative; and
- **cleanup pending:** logical state is committed, but unreachable encrypted
  records still need deletion.

Callers must not turn every error into “entry not found.” Recovery and cleanup
status should be observable to diagnostics without exposing secret material.

## Migration Boundary

This decision specifies the target model, not the full migration sequence. The
implementation plan must preserve these boundaries:

- Version-1 keys and the restore journal remain untouched while the first
  version-2 snapshot is staged.
- Initial migration writes and validates both root slots before version 2
  becomes authoritative.
- Startup continues to understand version 1 until version 2 has reopened
  successfully after publication.
- Interrupted migration is idempotent and restarts from the readable legacy
  state or resumes discoverable staged work.
- Legacy deletion is delayed until version 2 is proven complete and recoverable.
- Android uninstall or device transfer is not a migration case because Expo
  SecureStore does not preserve that data.

## Test Obligations

The implementation plan must use a deterministic fault-injecting storage adapter
and cover:

- failure before and after every staged write;
- loss or corruption of either transaction-intent header and any intent plan
  page;
- interrupted intent recovery never deleting a root-reachable record;
- a write that resolves but disappears after simulated restart;
- read-back mismatch;
- malformed, missing, duplicated, reordered, looped, or checksum-invalid
  manifest pages;
- corruption of the newest root with successful fallback;
- both roots invalid with a readable legacy store;
- both roots invalid with no legacy state;
- two racing mutations serialized without lost updates;
- unchanged value chunks reused by metadata-only and unrelated-key changes;
- delete interruption before the first and second root publications;
- delete success with physical cleanup failure and later retry;
- cleanup never deleting records reachable from either root;
- interrupted and repeated version-1 migration;
- ASCII, multibyte Unicode, and surrogate-pair values around the byte ceiling;
  and
- device-locked errors never being treated as corruption or absence.

Every failure test must reopen a fresh store instance to model loss of
same-process SharedPreferences memory.

## Non-Goals

- Protecting data across uninstall, device loss, Android backup/restore, or
  device transfer.
- Replacing the existing user-controlled backup and restore feature.
- Adding biometric authentication to stored keys.
- Providing multi-process writers.
- Keeping more than one fallback logical state.
- Repairing version-1 mutation behavior beyond the separate lookup hotfix.
- Depending on physical garbage deletion for logical correctness.

## Acceptance Criteria

- A failed or interrupted upsert always leaves at least the previous complete
  logical state selectable.
- A successful upsert exposes one complete new snapshot and keeps one complete
  fallback snapshot.
- Updating one key writes secret value data only for that changed key.
- A successful delete leaves both root slots pointing to a state without the
  entry before cleanup begins.
- No live record is deleted until it is unreachable from both valid roots.
- Interrupted attempt records remain discoverable through redundant fixed
  intents and deterministic keys.
- Recovery reads do not mutate storage.
- All SecureStore payloads are bounded by exact UTF-8 byte count.
- Version-1 data remains readable throughout interrupted migration.
- The design requires no cross-key atomicity, enumeration, trustworthy delete
  acknowledgement, or universal native size guarantee.
