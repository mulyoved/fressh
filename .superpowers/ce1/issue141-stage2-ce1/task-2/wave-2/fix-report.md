# Task 2 CE1 wave 2 fix report

All eight synthesized findings are resolved.

- CE1-T2-001: detail-free host-command failures carry a typed `no-detail`
  reason and preserve the feature-request install/auth fallback.
- CE1-T2-002: active-trace and persistent Workmux diagnostic writes are
  independently contained, so either sink can fail without suppressing the
  other.
- CE1-T2-003: channel-null/factory-failed Workmux owners enqueue normal
  retirement and run each registered cleanup once on replacement or unmount.
- CE1-T2-005: the scrollback executor consumes `ShellWorkmuxScrollPort`
  outcomes directly; the raw result contract, typed-to-raw adapter, and
  duplicate `runScroll` pipeline are removed.
- CE1-T2-007: keyboard modules use the canonical `ShellTerminalViewPort`.
- CE1-T2-008: the extracted terminal-source adapter is directly tested for
  exact bigint string conversion above `MAX_SAFE_INTEGER` and stale-generation
  null behavior.
- CE1-T2-012: both keyboard outcome decoders use the shared exhaustive helper,
  and `unwrapControllerOutput` now constrains failures to typed messages.
- CE1-T2-013: keyboard Workmux commands sample terminal output diagnostics
  before and after execution, with reader/logger failures contained and tested.

Architecture guards now reject raw scroll contracts/adapters, duplicate scroll
pipelines, keyboard runtime-view aliases, and local keyboard outcome switches.

Verification:

- `pnpm test:integration`: 2267 passed, 0 failed.
- `pnpm fmt:check`: passed.
- `pnpm lint:check`: passed with zero warnings.
- `pnpm typecheck`: passed.
- Focused terminal-source and architecture guard matrix: 9 passed, 0 failed.

No build, deployment, device-data, signing, generated-artifact, or
configuration operation was performed.
