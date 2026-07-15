# Mdev Codex Restart Timeout Design

## Summary

Issue 136 reports that `Cmds > mdev > restart codex` times out because the
remote restart can take longer than the command entry's current 10-second
allowance. The same restart succeeds when run manually and allowed to finish.

Increase the bundled command entry's timeout from 10 seconds to 60 seconds.
Keep the existing bridge-backed restart flow and user experience unchanged.

## Goals

- Allow a Codex restart that takes more than 10 seconds, but no more than 60
  seconds, to complete successfully.
- Keep using the structured `codex.restart` bridge operation.
- Limit the longer timeout to the bundled `restart codex` command entry.
- Deliver the updated bundled configuration to existing installations through
  the normal shell-config version update path.

## Non-Goals

- Do not add progress UI, cancellation, retry, or fallback behavior.
- Do not add separate context-lookup and restart timeout fields.
- Do not change the default timeout used by other Workmux operations.
- Do not write restart command text into the terminal PTY.
- Do not change existing success or failure presentation.

## Design

Change the `restart codex` bridge entry in
`apps/mobile/config/shell-config.json` from:

```json
{
	"type": "bridge",
	"label": "restart codex",
	"operation": "codex.restart",
	"timeoutMs": 10000
}
```

to:

```json
{
	"type": "bridge",
	"label": "restart codex",
	"operation": "codex.restart",
	"timeoutMs": 60000
}
```

The existing command-menu dispatcher passes the entry to the existing Codex
restart handler. `restartCodexWithBridge` continues to apply the configured
timeout independently to each request in the existing two-stage flow:

1. Resolve the current Workmux target, with a 60-second request timeout.
2. Request `codex.restart` for that target, with a separate 60-second request
   timeout.

This preserves the current timeout semantics; it does not introduce a shared
60-second deadline across both requests.

No runtime API or default timeout changes are required. The shell-config
`version` and `updatedAt` metadata must be advanced so the application treats
the bundled configuration as newer and publishes it through the established
configuration update path.

## Error Handling

Existing behavior remains unchanged:

- A successful restart completes silently.
- A bridge timeout after 60 seconds uses the existing timeout failure path.
- Unsupported or outdated remote bridge operations use the existing
  update-required message.
- Other remote failures preserve the existing bridge failure message.

The implementation does not add a fallback that pastes a shell command into
the terminal.

## Testing

Update the focused command-menu integration expectation so the bundled
`restart codex` entry is required to have `timeoutMs: 60_000` and still uses
the `codex.restart` operation.

Run the focused mobile tests covering:

- bundled command-menu parsing and contents;
- shell-config schema and version handling; and
- the existing Codex restart bridge behavior.

Existing Codex restart behavior tests should remain unchanged unless they
directly assert the bundled entry's configured timeout.

## Acceptance Criteria

- `Cmds > mdev > restart codex` gives the `codex.restart` bridge request up to
  60 seconds to complete.
- A restart taking more than 10 seconds and no more than 60 seconds can finish
  successfully.
- The entry remains a bridge entry using `codex.restart`.
- No restart command text is injected into the terminal.
- Unrelated Workmux actions retain their existing timeouts.
- Existing success and failure presentation remains unchanged.

## Expected Code Impact

- `apps/mobile/config/shell-config.json`
  - increase the entry timeout;
  - advance `version` and `updatedAt`.
- `apps/mobile/test/integration/command-menu.test.ts`
  - update the bundled entry timeout expectation.
- Focused shell-config tests only if the metadata change requires an updated
  expectation.
