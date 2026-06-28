# Connection Diagnostics Zero-Debt Cleanup Design

## Purpose

The current connection diagnostics branch works, but the thermo-nuclear code
quality review found structural debt that should be fixed before shipping:

- `connectAndOpenShell` is a flag-driven shared flow with diagnostic-specific
  branches in the normal saved-connection path.
- `shell/detail.tsx` owns too much of the debug-command orchestration.
- `connection-diagnostics.ts` is a new near-1k-line module that mixes unrelated
  responsibilities.
- passive auto-connect/reconnect tracing is visually threaded through busy
  branch logic.
- one integration test validates wiring with source grep instead of executable
  behavior.

This cleanup keeps the user-visible behavior unchanged: the command-menu action
still starts a fresh diagnostic attempt, records a local trace, and pastes or
copies a Codex debugging prompt.

## Goals

- Split normal saved-entry shell opening from diagnostic probing.
- Extract the shell debug command workflow out of `shell/detail.tsx`.
- Split diagnostic types, redaction, recorder, and prompt formatting into
  focused modules.
- Move passive diagnostic event emission behind clearer helpers for the branches
  touched by this cleanup.
- Replace source-grep integration coverage with behavioral tests against the
  extracted boundaries.
- Preserve all existing reliability guarantees: no diagnostic persistence, no
  diagnostic shell-store registration, bounded disconnect, manual timeout,
  stale-run protection, best-effort trace recording, and prompt delivery
  fallback.

## Non-Goals

- Do not change the command-menu label, action id, prompt wording intent, or
  user-facing workflow.
- Do not redesign reconnect timing, Tailscale recovery policy, tmux behavior, or
  saved-connection selection policy.
- Do not add new UI.
- Do not run Android data-destructive workflows.

## Architecture

### Normal Saved Shell Flow

`connect-and-open-shell.ts` should become normal-path only. It should:

- connect through `connectAndRememberConnection`;
- persist saved-connection metadata;
- start a registered shell;
- navigate on success;
- navigate with tmux attach failure metadata for normal tmux failures;
- record trace events for the normal path when a trace sink is provided.

It should not accept `diagnosticMode`, should not know about diagnostic cleanup,
and should not suppress navigation or shell-store registration.

### Diagnostic Shell Probe

Add `diagnostic-shell-probe.ts` as the only module that performs diagnostic SSH
probes. It should:

- accept already-resolved connection security;
- call an injected native `connect` function, normally `RnRussh.connect`;
- never call `connectAndRememberConnection`;
- never save connection metadata;
- never navigate;
- start the shell with `registerInStore: false`;
- record connect, progress, shell, tmux attach, failure, and disconnect events;
- attempt bounded disconnect after a native connection exists;
- preserve the original connect/shell/tmux error if disconnect fails.

This removes diagnostic policy from the normal shell-open path.

### Connection Debug Command

Add `connection-debug-command.ts` to own the command-menu workflow currently
embedded in `shell/detail.tsx`. The screen should provide adapters only:

- `closeMenu`;
- app-state snapshot fields;
- `hasShell`;
- `pasteIntoTerminal`;
- `copyToClipboard`;
- `showAlert`;
- logger dependency for warning paths.

The command module should own:

- latest auto-connect saved-entry lookup;
- key resolution with warning-to-null behavior;
- `runManualConnectionDiagnostic` invocation;
- diagnostic probe invocation through `diagnostic-shell-probe`;
- prompt delivery through `deliverConnectionDiagnosticPrompt`.

After this extraction, `shell/detail.tsx` should only bind
`debugConnectionInCodex` to the extracted command runner.

### Diagnostic Modules

Split `connection-diagnostics.ts` into focused modules:

- `connection-diagnostic-types.ts`: public trace, event, app-state, recorder,
  and prompt option types.
- `connection-diagnostic-redaction.ts`: redaction patterns, text redaction,
  snapshotting, clone helpers, and hostile input normalization helpers.
- `connection-diagnostic-recorder.ts`: recorder implementation, bounded history,
  trace lifecycle, and singleton recorder.
- `connection-diagnostic-prompt.ts`: prompt formatting, primary identity
  selection, event formatting, and app-state lines.
- `connection-diagnostics.ts`: a small barrel preserving the current public
  import shape during this cleanup.

The split should preserve current public exports through the barrel.

### Passive Auto-Connect Diagnostics

Keep the current trace lifecycle:

- initial auto-connect owns a trace unless reconnect already created one;
- reconnect can create the trace first;
- blocked reconnect starts finish as skipped;
- reconnect stopped as `reconnected` finishes connected;
- other reconnect stops finish failed.

Reduce tracing noise in each auto-connect/reconnect file touched by this
cleanup. Prefer small event helper functions over repeated inline `traceEvent`
blocks in branch-heavy functions. The cleanup should improve scanability without
changing auto-connect control flow or timing.

## Data Flow

### Manual Debug Command

1. Command menu invokes `debugConnectionInCodex`.
2. `shell/detail.tsx` delegates to `runConnectionDebugCommand`.
3. The command closes the menu, snapshots app state, and loads the latest
   auto-connect saved connection.
4. The command resolves key security through `secretsManager`.
5. The command calls `runManualConnectionDiagnostic`.
6. The manual runner owns single-flight, timeout, stale-run protection, trace
   lifecycle, and Tailscale recovery wrapping.
7. The manual runner calls `runDiagnosticShellProbe` for the actual SSH probe.
8. The probe records SSH events and performs bounded cleanup.
9. The command formats and delivers the prompt through terminal paste or
   clipboard fallback.

### Normal Saved Entry

1. Auto-connect calls normal `connectAndOpenShell`.
2. The normal flow persists metadata, starts a registered shell, and navigates.
3. No diagnostic flags or diagnostic cleanup branches exist in this module.

## Error Handling

- Diagnostic cleanup is mandatory after a native connection exists.
- Disconnect failure is traced but must not replace the original shell/tmux
  failure.
- Manual diagnostic timeout releases single-flight state and prevents stale late
  work from starting a probe.
- Trace recorder failures remain best-effort and must not affect connection
  behavior.
- Key lookup failure produces a failed diagnostic trace and prompt, not an
  uncaught exception.
- Prompt delivery failure returns `copy-failed` and alerts the user.

## Testing

Replace `connection-diagnostic-integration.test.ts` source-grep assertions with
behavioral tests against extracted boundaries.

Required coverage:

- `connectAndOpenShell` has no `diagnosticMode` option and preserves normal
  saved-entry behavior.
- `runDiagnosticShellProbe` success disconnects and does not save, navigate, or
  register a shell.
- diagnostic probe shell failure disconnects and preserves the shell error.
- diagnostic probe tmux attach failure disconnects and returns the tmux failure
  result.
- diagnostic probe disconnect timeout records disconnect failure without
  replacing the original failure.
- `runConnectionDebugCommand` closes the menu, resolves the latest saved entry,
  resolves key security, invokes the manual runner, and delivers the prompt.
- key resolution failure remains a failed diagnostic prompt path.
- passive auto-connect/reconnect trace lifecycle remains covered by executable
  tests or focused helper tests rather than source-grep tests.
- existing redaction, recorder mutation isolation, manual timeout, missing-key,
  copy-failure, no-store-registration, and no-save tests remain passing.

## Acceptance Criteria

- No production code path branches on `diagnosticMode`.
- Normal saved-entry shell opening and diagnostic probing are separate exported
  flows with explicit contracts.
- `shell/detail.tsx` no longer contains saved-entry lookup, key resolution, or
  diagnostic probe wiring.
- `connection-diagnostics.ts` is no longer a near-1k-line implementation module.
- source-grep integration tests are removed or replaced with behavioral tests.
- Current targeted mobile typecheck, focused lint, and diagnostic integration
  tests pass.
