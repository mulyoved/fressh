---
title: Plan the Multi-Manifest Lookup Safety Hotfix
status: closed
order: 10
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
assignee:
---

## Question

What is the smallest independently releasable, test-driven implementation plan
that fixes `getEntry` across multiple manifest chunks and proves existing
private keys remain discoverable until the storage-v2 migration lands?

## Resolution

The answer is the
[Multi-Manifest Lookup Safety Hotfix Implementation Plan](../../../superpowers/plans/2026-07-12-multi-manifest-lookup-hotfix.md).
It defines one independently releasable production change: flatten all loaded
manifest entries before selecting the requested ID. A focused red-green
integration test first proves that two manifest chunks exist, then verifies
synthetic private-key values and creation metadata from the oldest, middle, and
newest records.

The hotfix preserves every storage key, serialized format, store API, error
message, and mutation path. Transactional writes, recovery semantics, and
automatic storage-v2 migration remain with the existing storage design and
implementation-plan tickets, so this resolution surfaces no new fog or child
ticket.
