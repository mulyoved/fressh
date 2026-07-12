---
title: Characterize SecureStore Failure and Commit Semantics
status: closed
order: 20
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
assignee:
---

## Question

What ordering, atomicity, durability, size, and crash-recovery guarantees do
Expo SecureStore and the underlying supported Android/iOS stores provide, and
which guarantees may a transactional Fressh private-key store safely rely on?

## Resolution

The evidence and resulting least-common-denominator contract are recorded in
[SecureStore Failure and Commit Semantics](../research/2026-07-12-securestore-failure-semantics.md).

Fressh may rely on OS-protected per-key string operations, explicit
JavaScript-level sequencing, and ordinary in-place update persistence. It may
not rely on cross-key transactions, a universal 2048-byte acceptance limit,
promise fulfillment as a cross-platform durability or deletion acknowledgement,
`null` as proof an item never existed, enumeration, or uninstall/restore
persistence.

The installed Expo 15.0.8 source tightens the contract: Android ignores the
normal-value `SharedPreferences.commit()` result, while iOS ignores all
`SecItemDelete` results. The transactional model must therefore use serialized
writers, byte-safe bounded records, immutable generations, redundant
publish-last commit candidates, complete-generation validation and fallback, and
best-effort physical cleanup. These requirements fit the existing “Choose the
Transactional Secure-Storage Model” ticket, so no new ticket or fog graduation
is needed.
