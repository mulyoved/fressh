# Connection Diagnostics Architecture Cleanup Design

## Goal

Redesign the connection diagnostics event architecture so the code is smaller,
easier to scan, and harder to extend incorrectly.

The current implementation is functionally useful, but it concentrates too much
responsibility in `connection-diagnostic-events.ts` and repeats event knowledge
across constructors, kind lists, legacy normalization, prompt formatting, and
tests. This cleanup should keep the current diagnostic value while removing that
incidental complexity.

Primary success metric: reduce file size and cognitive load. New diagnostic
events should have an obvious owner, and no source file in the redesigned
diagnostics event stack should grow near 1,000 lines. The target is below 500
lines per diagnostics event source file, with an explicit guard at 800 lines.

## Scope

In scope:

- Split diagnostic events by domain ownership.
- Replace the giant event module with smaller focused files.
- Remove legacy `type`/alias trace compatibility entirely.
- Allow diagnostic event names to change where clearer names reduce coupling.
- Keep live traces typed end to end.
- Keep Codex-ready prompt output useful, but allow wording and field ordering to
  change.
- Consolidate diagnostic snapshot, redaction, and error serialization helpers.
- Move saved-entry connection identity construction into a canonical helper.
- Decouple shared saved-entry Tailscale recovery from auto-connect diagnostic
  event names.
- Replace the giant event test with domain-specific tests.

Out of scope:

- UI changes.
- New diagnostic commands or command-menu behavior.
- Persistent trace storage.
- Reworking SSH or Tailscale recovery behavior beyond diagnostic ownership
  cleanup.
- Supporting old copied or locally stored trace payloads.

## Architecture

Create a diagnostics event folder owned by the mobile app:

- `connection-diagnostics/events/types.ts`
  - shared trace, status, source, connection identity, error, and timed-event
    types
- `connection-diagnostics/events/identity.ts`
  - canonical builders for saved-entry, active-connection, shell, and partial
    connection identities
- `connection-diagnostics/events/snapshot.ts`
  - one JSON-safe snapshot helper
  - private-key omission
  - diagnostic error serialization
- `connection-diagnostics/events/ssh.ts`
- `connection-diagnostics/events/auto-connect.ts`
- `connection-diagnostics/events/manual.ts`
- `connection-diagnostics/events/tailscale.ts`
- `connection-diagnostics/events/reconnect.ts`
- `connection-diagnostics/events/index.ts`
  - barrel exports
  - assembled `ConnectionDiagnosticEvent` union
  - assembled event kind list for tests and narrow runtime checks

Each domain module owns:

- its event type definitions
- its constructor functions
- its prompt-specific field formatter
- its focused tests

The prompt formatter should delegate by domain instead of carrying one large
`switch` over every event kind. Shared prompt helpers should format connection
identity, errors, inline JSON, and private-key omission.

## Data Flow

Live traces are strictly typed:

1. A caller emits a domain event through a domain constructor, such as
   `autoConnectEvents.savedEntrySelected(...)` or `sshEvents.connectFailed(...)`.
2. The constructor snapshots only allowed fields through the shared snapshot
   helpers.
3. The recorder timestamps typed events. It does not normalize, alias, repair,
   or accept legacy event shapes.
4. Prompt formatting receives a typed trace and delegates each event to the
   formatter exported by that event's domain module.
5. Invalid runtime values are handled only at real boundaries: caught errors,
   identity builders, and snapshot/error helpers.

Old `type`-based traces are not supported. There should be no alias table and no
generic `normalizeLegacyEvent` path.

## Saved-Entry Recovery Boundary

`attemptSavedEntryWithTailscaleRecovery` should stop emitting diagnostic events
with auto-connect names.

The shared helper should return lifecycle outcomes only:

- `blocked`
- `connected`
- `tmuxAttachFailed`
- `recoveryNotAttempted`
- `retryFailed`
- `threw`

Auto-connect and manual diagnostic callers should map those outcomes into their
own domain events. This keeps shared recovery policy independent from caller
diagnostic vocabulary.

## Error Handling

Diagnostics remain best-effort, but the fallback points should be explicit:

- Event constructors copy only allowed payload fields.
- Error values are serialized through the shared snapshot/error helper.
- The recorder stores typed events and can defensively clone them, but it does
  not repair unknown shapes.
- Prompt formatting must not throw for a valid typed trace.
- Event sink failures may be swallowed by callers so diagnostics never change
  connection behavior.
- `unknown` is acceptable only for true runtime boundaries: caught errors,
  JSON-safe snapshotting, and error serialization.

## Testing

Replace the giant event test with focused domain tests:

- `connection-diagnostic-ssh-events.test.ts`
- `connection-diagnostic-auto-connect-events.test.ts`
- `connection-diagnostic-manual-events.test.ts`
- `connection-diagnostic-tailscale-events.test.ts`
- `connection-diagnostic-reconnect-events.test.ts`

Shared tests should cover:

- identity builders copy only allowed fields
- snapshot/error helper is circular-safe and omits private key blocks
- exported event union and exported event kind list stay in sync
- recorder timestamps typed events and does not normalize legacy shapes
- prompt formatting delegates to domain formatters
- shared saved-entry recovery returns outcomes without emitting auto-connect
  diagnostic event names

Delete tests whose only purpose is preserving legacy `type`/alias
normalization.

Add a lightweight file-size guard for the diagnostics event stack so no single
source file exceeds 800 lines.

Verification target:

- focused diagnostic event, prompt, recorder, and recovery tests
- broader connection/Tailscale integration slice
- mobile typecheck
- formatting
- lint when the existing ESLint config issue is fixed, or document that blocker

## Migration Order

1. Add the new event folder and shared type/snapshot/identity helpers.
2. Move event domains one at a time, starting with the smallest domain.
3. Replace call-site imports domain by domain.
4. Move prompt field formatting into domain modules.
5. Remove legacy normalization and alias tests.
6. Decouple saved-entry recovery outcomes from diagnostic event names.
7. Split the giant event tests into domain tests.
8. Run verification and a strict maintainability review.

The implementation should preserve current debugging usefulness at each step.
It should not introduce a custom schema DSL unless the domain-sliced approach
proves insufficient.
