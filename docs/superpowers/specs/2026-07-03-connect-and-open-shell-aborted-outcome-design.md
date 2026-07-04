# Connect And Open Shell Aborted Outcome Design

## Goal

Give `connectAndOpenShell` an explicit aborted outcome when it observes a late
successful shell start after abort, cleans that shell and SSH connection up, and
therefore must not expose the result as usable.

This addresses Issue 116. The current behavior closes the shell, disconnects
SSH, skips navigation, and still returns a connected-shaped result. That forces
callers to infer usability from side effects. The new contract makes the abort
visible at the type boundary.

## Context

Recent connection lifecycle work already improved abort cleanup around
auto-connect and diagnostics. It introduced typed aborted outcomes at the
higher-level connection attempt boundary and made cleanup after abort more
consistent.

This design is intentionally narrower. It changes the public
`connectAndOpenShell` helper so that when the helper itself owns abort cleanup,
it returns an explicit aborted result instead of a cleaned-up connected result.

## Chosen Approach

Add `status: 'aborted'` to `ConnectAndOpenShellResult`.

When `connectAndOpenShell` receives a successful shell result but the active
shell lifecycle signal is already aborted:

1. If `cleanupOnAbort` is `true`, close the shell, disconnect SSH, skip
   navigation, and return an aborted result.
2. If `cleanupOnAbort` is `false`, preserve the current behavior and return the
   connected result so the caller can own cleanup and outcome mapping.

This keeps the fix local to the contract that currently leaks the ambiguity.

## Alternatives Considered

### Move Abort Cleanup Into `runSshShellLifecycle`

This would centralize late-success cleanup deeper in the shared shell lifecycle.
It is not the preferred change for Issue 116 because
`runSshShellLifecycle` is also used by diagnostics, where cleanup and public
status mapping differ. Moving the behavior there would broaden the blast radius
without being necessary to fix the public helper contract.

### Require Callers To Own Cleanup

This would keep `connectAndOpenShell` connected-only and ask lifecycle-managed
callers to set `cleanupOnAbort: false`. Auto-connect already uses that mode in
one path, but leaving the default helper able to return a cleaned-up connection
keeps the original footgun.

## API Shape

`ConnectAndOpenShellResult` should become a three-way union:

```ts
export type ConnectAndOpenShellResult =
	| Omit<ConnectedSshShellLifecycleResult, 'storedConnectionId'>
	| TmuxAttachFailedSshShellLifecycleResult
	| {
			status: 'aborted';
			reason: unknown;
	  };
```

The `reason` should come from the active shell lifecycle signal when available.
If that signal has no reason, fall back to the parent `abortSignal.reason`. If
neither signal provides a reason, use a generic
`Error('Connection attempt aborted')`.

The active shell lifecycle signal remains:

```ts
const activeShellAbortSignal = operationSignals?.shell ?? abortSignal;
```

That preserves the existing rule that an explicit shell operation signal owns
the shell lifecycle decision even when the parent signal also exists.

## Behavior

Connected success without abort stays unchanged: log success, navigate, and
return `connected`.

Late success after abort with `cleanupOnAbort: true` changes:

1. Log successful connection as today.
2. Close the shell and disconnect SSH using the existing cleanup helper.
3. Do not navigate.
4. Return `{ status: 'aborted', reason }`.

Late success after abort with `cleanupOnAbort: false` stays unchanged:

1. Do not clean up.
2. Navigate normally.
3. Return `connected`.

This preserves current ownership for callers that intentionally take over
cleanup and outcome mapping.

Tmux attach failure while aborted stays unchanged:

1. Skip `navigateWithError`.
2. Return the existing `tmux_attach_failed` result.

## Error Handling

Cleanup failures remain best-effort logs inside `connectAndOpenShell`.

An aborted late success should not become `failed` because cleanup failed. The
primary outcome is still abort, and the helper already treats shell close and
SSH disconnect cleanup as best effort.

This design does not change:

- `runSshShellLifecycle` error behavior.
- diagnostic public statuses.
- reconnect retry policy.
- `connection-attempt-lifecycle` outcome names.

## Caller Impact

Callers that ignore the result and rely on navigation should see no behavior
change except that aborted late success still does not navigate.

Callers that inspect `ConnectAndOpenShellResult` must handle `status:
'aborted'`. The important adapter is `toAutoConnectSavedEntryResult`. It
currently treats every non-connected result as `tmux_attach_failed`; that must
change because `aborted` is neither connected nor tmux failure.

Implementation can handle that boundary in either of two equivalent ways:

1. Widen `SavedEntryConnectResult` to include `{ status: 'aborted'; reason:
   unknown }`, then teach lifecycle mapping to return the existing connection
   attempt `aborted` outcome.
2. Keep `SavedEntryConnectResult` unchanged and handle `connectAndOpenShell`
   aborted results before calling `toAutoConnectSavedEntryResult`.

The implementation plan should choose the smaller change after checking current
call sites, but it must not cast an aborted result to `tmux_attach_failed`.

The `cleanupOnAbort: false` auto-connect path should continue to receive
`connected` so its higher-level lifecycle remains responsible for cleanup.

## Testing

Update existing integration tests around the problematic behavior:

- `connectAndOpenShell cleans up shell operation abort after late shell success`
  should expect `status: 'aborted'`.
- `connectAndOpenShell cleans up an aborted late success` should expect
  `status: 'aborted'`.
- `connectAndOpenShell lets caller own aborted success cleanup` should continue
  expecting `connected`.

Tighten assertions to verify:

- no navigation occurs when the helper returns `aborted`;
- shell close still runs once;
- SSH disconnect still runs once;
- abort reason propagates from the active shell operation signal;
- parent abort signal reason is used when no explicit shell operation signal is
  present.

## Out Of Scope

- Reworking `runSshShellLifecycle`.
- Changing manual diagnostic result statuses.
- Changing reconnect timeout or retry behavior.
- Changing Rust SSH APIs.
- Redesigning cleanup failure policy.
