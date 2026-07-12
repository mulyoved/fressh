---
title: Write the Secure-Storage V2 and Automatic-Migration Plan
status: closed
order: 40
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - '[Plan the Multi-Manifest Lookup Safety
    Hotfix](./plan-multi-manifest-lookup-hotfix.md)'
  - '[Choose the Transactional Secure-Storage
    Model](./choose-transactional-secure-storage-model.md)'
assignee:
---

## Question

What exact test-driven implementation plan introduces the chosen transactional
store, automatically migrates every existing key and restore journal, verifies
rollback and crash recovery at each write boundary, and removes the legacy
format only after successful commit?

## Resolution

The answer is the
[Secure Storage V2 and Automatic Migration Implementation Plan](../../../superpowers/plans/2026-07-12-secure-storage-v2-automatic-migration.md).

Its ten test-driven tasks split codec, record schemas, read-only legacy access,
snapshot validation, transaction writing, deletion, migration, and mobile wiring
into focused modules. A restartable fault-injection adapter verifies rejection,
visible-only writes, acknowledged-but-lost writes, corrupt records, root
fallback, intent recovery, delete cleanup, concurrent mutation, and Unicode byte
limits.

Private keys and the pending restore journal migrate independently. Version-1
records remain untouched during the first version-2 commit and become cleanup
candidates only when a fresh store instance reopens valid version-2 roots.
Backup replacement and default-key updates become one replace-all transaction.

Source mapping clarified the approved record model by replacing an unbounded
array of value-chunk keys with a bounded `valueRecordId` plus chunk count. This
preserves the approved behavior and supports large restore journals without
creating a new decision or ticket.
