---
title: Choose the Transactional Secure-Storage Model
status: closed
order: 30
labels:
  - wayfinder:grilling
parent: ../map.md
blocked_by:
  - '[Characterize SecureStore Failure and Commit
    Semantics](./characterize-secure-store-failure-semantics.md)'
assignee:
---

## Question

Which clean-slate storage model should replace the current delete-first chunked
manifest so updates always expose one complete generation, deletion failures
remain recoverable, and the model stays within the verified SecureStore
guarantees?

## Resolution

The approved answer is the
[Transactional Secure Storage V2 Model Design](../../../superpowers/specs/2026-07-12-transactional-secure-storage-model-design.md).

Storage v2 uses two fixed root slots, two fixed transaction-intent slots, and
immutable attempt records. Normal saves publish changed records and a complete
manifest before replacing the older root; startup validates both roots and uses
the newest complete state, falling back to the previous complete state when
needed. Unchanged private-key value records are reused.

Delete publishes the state without the key to both root slots before old
encrypted records enter retryable cleanup. All mutations are serialized, records
are capped at 1800 UTF-8 bytes, recovery reads never prune data, and fixed
redundant intents plus deterministic attempt keys make interrupted work
discoverable without SecureStore enumeration.

The user approved automatic fallback, two logical states, changed-key-only
secret writes, and logical deletion before physical cleanup. The existing “Write
the Secure-Storage V2 and Automatic-Migration Plan” ticket covers the
implementation and migration details, so this resolution creates no new ticket
or fog.
