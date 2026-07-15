# Task 2 CE1 wave 3 fix report

Both synthesized testing findings are resolved without production changes.

- CE1-T2-014: deterministic deferred tests now cross terminal-source generation
  rotation for `readBuffer`, `addListener`, `sendData`, and `resizePty`. They
  prove retired buffer output is not returned, late listener registration is
  removed exactly once and never exposed, and completed native send/resize
  operations reject as superseded without replaying their payload or dimensions.
- CE1-T2-015: focused Workmux owner tests now prove a rejected current command
  becomes a typed failed outcome with the rejection message, while the same
  rejection after owner replacement becomes superseded. These tests exercise
  the common command pipeline shared by command, operation, and scroll methods.

TDD/mutation evidence:

- With the four terminal post-await checks and stale Workmux rejection
  classification temporarily disabled, the focused matrix exited 1 with the
  expected five failures (29 passed, 5 failed).
- After restoring the unchanged production implementation, the focused matrix
  passed 34/34.

Verification:

- `pnpm test:integration`: 2273 passed, 0 failed.
- `pnpm test:components`: 15 passed, 0 failed.
- `pnpm fmt:check`: passed.
- `pnpm lint:check`: passed with zero warnings.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.

No production source, build, deployment, device-data, signing,
generated-artifact, or configuration change is included.
