# Wispr Timeout Retry Ownership Design

## Goal

Prevent a retry from replacing an unresolved native Wispr start transaction
after its UI timeout, while preserving bounded cleanup and exact authority-lease
settlement.

## Admission Contract

`WisprStartProtocol` exposes one authoritative
`hasOutstandingNativeTransaction()` query. It is true while that protocol owns
either a pending native-control acquisition or an exact native-control lease.

The shell controller includes this signal in its exported `busy` snapshot and in
both retry entry points: `openTextEditor()` and `setAutoStart(true)`. An attempt
made while the signal is true is rejected or ignored without calling
`beginRequest()` or `start()`. Therefore it cannot overwrite the request ID,
tap-issued marker, timeout marker, acquisition, or lease belonging to the
unresolved transaction.

## Settlement Behavior

A late rejection of the original timed-out start releases its exact lease,
clears its transaction markers, and makes the existing failed UI state
retryable. A late success restores recording for the still-current modal. The
subsequent close records the exact close-after-start obligation, binds its
five-second cleanup deadline, and settles or poisons the exact lease before a
successor can acquire.

Existing close/invalidate/dispose behavior remains unchanged: retiring the modal
may accept a new UI request, but the close coordinator defers its native start
until the predecessor cleanup transaction settles.

## Test Organization

Delete the 1,006-line lifecycle monolith. Move its behavioral tests, without
source-text assertions or empty facade imports, into focused integration files:

- acquisition and request supersession;
- issued-start retirement and cleanup;
- process-wide authority, successors, and bounded poison.

Shared clocks, deferred native ports, harness creation, and open/focus helpers
remain in `shell-wispr-controller-test-support.ts`.

## Verification

New fake-time cases cover retry/open and auto-start re-enable after timeout for
both late success and late rejection. They assert the snapshot remains busy,
request/status/native start counts do not advance, the old transaction identity
settles exactly once, native active state is closed when required, and a
successor either acquires after inactive settlement or is blocked after bounded
unknown cleanup.

All prior lifecycle cases remain executable through the focused files. The exact
Task 4 Node/Jest lanes, full mobile integration/components, formatting,
typecheck, scoped ESLint, and diff checks are required before completion.
