# Connection Diagnostics Codex Prompt Design

## Problem

Reconnect and auto-connect now involve multiple moving parts: saved connection
selection, active shell reuse, active connection shell reopen, Tailscale
preflight and recovery, Android foreground service constraints, tmux attach,
and SSH transport errors.

When a connection fails, the app logs some high-level events to the React Native
console, but it does not keep a local trace that follows one failed connection
path end to end. That makes debugging the reconnect logic slow because the
useful context is split across app state, console output, and user memory.

The mobile command menu should provide a fast way to capture a complete local
connection trace and paste a debugging prompt into the Codex TUI.

## Goals

- Keep local structured traces for auto-connect and reconnect failures.
- Support a manual diagnostic connection attempt that records a fresh trace.
- Generate a Codex-ready prompt from the latest trace or the fresh diagnostic
  trace.
- Paste the prompt directly into the current terminal when a shell is active.
- Copy the prompt to the clipboard and show an alert when no shell is active.
- Include personal connection identity such as host, user, port, saved
  connection id, key id, tmux settings, and Tailscale state.
- Never include private key material.
- Keep tracing testable without requiring React Native runtime imports.

## Non-Goals

- Building a full diagnostics history screen.
- Uploading logs to a server.
- Redacting hostnames, usernames, or saved connection ids for this personal
  workflow.
- Replacing existing reconnect, Tailscale recovery, or saved connection logic.
- Depending on Workmux bridge availability for the core diagnostic path.
- Persisting long-term sensitive logs on disk.

## Architecture

Add a focused `connection-diagnostics` module under `apps/mobile/src/lib`.
It owns three concerns:

1. Recording structured trace events.
2. Formatting a trace into a human-readable Codex debugging prompt.
3. Running a manual diagnostic attempt through injectable dependencies.

The recorder should be independent of React components. Auto-connect and
reconnect modules receive an optional tracer or trace context dependency, so
existing Node integration tests can inject a memory recorder and avoid React
Native imports.

The UI/action layer stays thin. `detail.tsx` should expose an action handler
that asks the diagnostics module for a prompt, then delivers it through the
existing terminal input or clipboard paths.

## Trace Model

A trace represents one logical connection attempt or reconnect cycle:

```ts
type ConnectionDiagnosticTrace = {
	id: string;
	startedAtMs: number;
	finishedAtMs?: number;
	trigger:
		| 'initial-auto-connect'
		| 'reconnect'
		| 'manual-diagnostic'
		| 'command-menu';
	status: 'running' | 'connected' | 'failed' | 'skipped';
	events: ConnectionDiagnosticEvent[];
};
```

Events should be structured enough for tests and readable enough for prompt
formatting. Useful fields include:

- timestamp and elapsed milliseconds;
- source path: `latest-shell`, `active-connection`, `saved-entry`,
  `tailscale-recovery`, `reconnect-controller`, `manual-diagnostic`;
- reconnect reason, retry index, retry delay, reconnect window elapsed time;
- platform, app active state, background work allowance, foreground service
  requirement;
- saved connection id, username, host, port, key id;
- tmux enabled flag and tmux session name;
- Tailscale readiness and recovery result kind;
- connect start, connect success, connect failure;
- tmux attach failure reason;
- error name, message, stack, and parsed SSH failure detail when available.

Private key contents must not be recorded. A key id is allowed.

The app should keep the latest trace in memory. A small bounded in-memory
history is acceptable if cheap, but the current user workflow only requires the
latest trace and the trace produced by a manual diagnostic run.

## Passive Capture

Passive capture should instrument the existing connection path without changing
its behavior:

- `AutoConnectManager` starts or attaches a trace for automatic attempts and
  reconnect cycles.
- `createAutoConnectReconnectController` records start, blocked start, retry
  scheduling, stop reason, timeout, and success.
- `attemptAutoConnectSource` records which source it tries: latest shell,
  active connection, or saved entry.
- Active connection reopen records tmux settings, shell open success, tmux
  attach failure, and unexpected shell open errors.
- Saved entry path records missing saved entry, invalid saved entry tmux
  fields, key lookup failure, Tailscale readiness, SSH connect attempts,
  Tailscale recovery after network-like failure, retry result, and final
  outcome.

Tracing should be best-effort. A trace recording error must not change the
connection result.

## Manual Diagnostic

The command menu should support manually starting a fresh diagnostic connection
attempt.

The diagnostic runner should:

1. Guard against concurrent diagnostic runs.
2. Create a new trace with trigger `manual-diagnostic`.
3. Load the latest saved auto-connect-enabled connection.
4. Resolve its key security and record the key id or lookup failure.
5. Run the same Tailscale preflight and recovery-aware saved-entry path used by
   auto-connect.
6. Prefer a probe-style connection if the existing SSH API supports it cleanly.
7. If the existing helper opens a shell, close or disconnect any diagnostic
   connection as soon as the trace is complete.
8. Avoid navigation during diagnostic success. The command is for trace
   generation, not normal reconnect UX.
9. Finish the trace and build a prompt from it.

If no saved auto-connect connection exists, the diagnostic should still produce
a prompt containing current app and reconnect state and an event explaining that
there was no eligible saved connection.

## Prompt Delivery

Add the `DEBUG_CONNECTION_IN_CODEX` action and expose it in the bundled command
menu under the existing mobile command area.

When invoked:

1. Run a fresh manual diagnostic when possible.
2. Fall back to the latest passive trace if a fresh diagnostic cannot run.
3. Build the Codex prompt.
4. If the current shell exists, paste the prompt into the current terminal using
   the existing literal input path.
5. If no current shell exists, copy the prompt to the clipboard and show an
   alert explaining that the connection debug prompt was copied and can be
   pasted into Codex.

If pasting into the terminal fails, fall back to clipboard plus alert. If
clipboard copy fails, show an alert with the copy error.

The first implementation can use one command menu entry:

```json
{
	"type": "action",
	"label": "Debug connection in Codex",
	"actionId": "DEBUG_CONNECTION_IN_CODEX"
}
```

Separate `Debug last connection` and `Run connection diagnostic` actions are
out of scope for the first implementation.

## Prompt Shape

The generated prompt should be direct and self-contained. It should ask Codex to
debug the connection failure, identify the most likely failure layer, and
recommend the next code or logging change.

The prompt should include:

- app/platform state;
- saved connection metadata and connection identity;
- reconnect state and foreground service state;
- chronological trace events;
- raw error details;
- Tailscale readiness and recovery results;
- final diagnostic outcome.

It should explicitly say that private key material has been omitted.

## Error Handling

The diagnostics path must not make connection failures worse.

- Trace recorder failures are swallowed after local warning logs.
- Manual diagnostics are single-flight.
- Missing saved connections, missing keys, invalid saved connection fields, and
  Tailscale unavailable/cooldown states are trace outcomes, not unhandled
  exceptions.
- Network-like SSH errors should still flow through existing Tailscale recovery.
- Non-network SSH errors should not be mislabeled as Tailscale failures.
- Tmux attach failures should be captured as tmux failures and should not be
  treated as SSH transport success.
- Any diagnostic connection opened only for debugging should be cleaned up.

## Testing

Add focused tests for:

- trace creation, append, finish, and bounded latest-history behavior;
- prompt formatting with connection identity, Tailscale results, reconnect
  retry events, and raw error details;
- private key contents are not included in trace events or prompt output;
- reconnect controller trace events for start, blocked start, retry schedule,
  timeout, success, and stop reasons;
- auto-connect source tracing for latest shell, active connection, saved entry,
  missing saved entry, key lookup failure, active shell reopen failure, tmux
  attach failure, and saved-entry SSH failure;
- manual diagnostic single-flight behavior;
- manual diagnostic no-saved-connection behavior;
- action delivery pastes into the current terminal when a shell exists;
- action delivery falls back to clipboard and alert when no shell exists or
  paste fails;
- bundled shell config accepts and exposes the new action id.

Run the focused mobile integration tests for auto-connect, reconnect
controller, saved-entry Tailscale recovery, keyboard actions, command menu, and
shell config.

## Expected Files To Change Later

- `apps/mobile/src/lib/connection-diagnostics.ts`
  - trace types, recorder, prompt formatter, and diagnostic runner.
- `apps/mobile/src/lib/auto-connect.tsx`
  - create/pass trace contexts and expose diagnostic action dependencies.
- `apps/mobile/src/lib/auto-connect-reconnect-controller.ts`
  - optional tracing for reconnect lifecycle events.
- `apps/mobile/src/lib/auto-connect-attempt.ts`
  - optional tracing for source selection and attempt outcomes.
- `apps/mobile/src/lib/auto-connect-saved-entry.ts`
  - optional tracing for Tailscale readiness, recovery, retry, and outcomes.
- `apps/mobile/src/lib/ssh-connect-flow.ts` or `query-fns`
  - optional connect start/result/error tracing at the transport boundary.
- `apps/mobile/src/lib/keyboard-actions.ts`
  - add `DEBUG_CONNECTION_IN_CODEX` and its action context hook.
- `apps/mobile/src/app/shell/detail.tsx`
  - deliver the generated prompt to terminal or clipboard.
- `apps/mobile/config/shell-config.json`
  - add the command menu entry.
- `apps/mobile/test/integration/*`
  - add focused tests for diagnostics, action dispatch, and prompt delivery.

## Acceptance Criteria

- A failed auto-connect or reconnect leaves a local trace with enough context to
  understand the attempted path and failure layer.
- The command menu can run a fresh diagnostic attempt and generate a new trace.
- The generated prompt includes connection identity and local diagnostic state
  but excludes private key contents.
- With an active shell, the prompt is pasted into the current terminal.
- Without an active shell, the prompt is copied and an alert explains what
  happened.
- Diagnostics are best-effort and cannot alter normal connection behavior
  except for the intentional manual diagnostic attempt.
- Focused tests cover trace formatting, auto-connect/reconnect instrumentation,
  manual diagnostic behavior, and prompt delivery fallback.
