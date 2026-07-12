# Review: Source-Quality Recovery Package

**Reviewed:** 2026-07-12, against `dev` at `82d6f44` **Scope:** The 8-stage
staged implementation package, the multi-manifest lookup hotfix plan, and the
secure storage v2 migration plan, with claims spot-checked against the actual
source tree.

## Verdict

The problems are real — verified in the code — and most of this package is
genuine improvement, not architecture astronautics. Two stages carry real
overcomplication risk, and the total scope is large enough that sequencing and
trimming matter.

## Claims verified against the code

- **Stage 0 bug is real and nasty.**
  `apps/mobile/src/lib/chunked-storage.ts:192` uses `reduce` in a way that
  throws away the accumulator every iteration — only the _last_ manifest chunk
  is ever searched. Once a user has enough keys to spill into a second manifest
  chunk, their older private keys become unreadable. The fix is a one-expression
  change plus a regression test.
- **Stage 1's problem is real.** `upsertEntry` at `chunked-storage.ts:308` calls
  `deleteEntry(...)` first, then re-writes. A crash mid-upsert **loses the
  private key** — the worst possible data loss for an SSH app. Deletes and
  manifest writes also run under `Promise.all` with no ordering guarantees.
- **The giant files are real.** `detail.tsx` is 2,012 lines,
  `selection-handles.ts` is 1,514, `auto-connect.tsx` is 815, Rust
  `ssh_connection.rs` is 1,166, and Rust `ssh_shell.rs` is 718. The separate
  `ssh_command.rs` is also 1,431 lines, but Stage 6 deliberately does not
  decompose it.
- Plan file/command references match the repo at `82d6f44` where spot-checked.

## Where the overcomplication risk actually is

### Stage 1 (storage v2) — accept consciously, contain it

The problem deserves a transactional fix, but the design is a mini-database on
top of SecureStore: two roots, dual intent keys, bounded manifest and intent
pages, SHA-256 content hashing, canonical JSON, cleanup pages, and several
focused modules and tests — all to store **a handful of SSH keys and one
restore-journal entry**. Manifest pages contain an ordered set of entry
references; the design is not one manifest page per entry.

A simpler copy-on-write scheme (write the complete new snapshot under new keys,
then flip a single root pointer, never delete before the flip) would eliminate
the data-loss bug with roughly a third of the machinery. The two-root fallback
is defensible _only_ because the research says SecureStore acks can silently
fail to persist — if that finding holds, the design is justified. The
fault-injection test matrix is excellent either way.

**Recommendation:** accept this design for private keys specifically (it's the
one place paranoia pays), but do not let this pattern spread to any other
storage in the app.

### Stage 7 (quality gate) — expensive, so keep it last

Portable Linux gate, exact no-growth baselines, required GitHub status, Nix
evidence, "run the gate twice and diff" — this is CI process for a large team on
what looks like a solo/small repo. It is the largest process investment in the
package.

An ESLint-only replacement would not cover Rust, exact no-growth handling for
existing debt, duplicate code, dead code, giant test splits, or safe release
evidence. **Recommendation:** keep the approved Stage 7 plan, execute it last,
and trim an analyzer only if final-tree evidence shows that it has no useful
finding to enforce.

### Stages 2–6 — good decomposition, one honest caveat

The plans have strong anti-overengineering guardrails baked in: "no
compatibility shims," "do not create a generic mutex class," "delete forwarding
layers," size caps on new modules. That is the opposite of what bad refactoring
plans look like — the end state will be _simpler_ code, not more layers.

**The caveat:** Stages 2–4 rewrite live SSH session ownership, controllers, and
auto-connect in three consecutive PRs. Stages 2 and 3 already require a local
Android preview build and non-destructive manual checks. Stage 4 explicitly
leaves EAS and physical-device work outside its plan. Integration tests are
decent, but auto-connect regressions such as frozen terminals or dropped
connections can appear only on-device.

**Recommendation:** add the same safe local Android preview gate to Stage 4
before merge. Stage 3 already has this gate.

## Recommended execution order

1. **Stage 0 now** — it's a bug fix, not refactoring.
2. **Stage 1 next** — the delete-first pattern is a live data-loss risk. Accept
   the design as-is or push back on one-entry-per-page and dual intents, but
   don't defer it.
3. **Stages 2, then 5** — the two biggest files, independent lanes.
4. **Reassess before Stages 3, 4, and 6.** Stage 2 may relieve enough shell
   pressure that controller consolidation and auto-connect can wait. Stage 6 is
   independent and will not be simplified by Stage 2, so schedule it according
   to its own maintenance cost. Completing the full eight-finding recovery still
   requires all three stages.
5. **Execute Stage 7 last.** Keep its full approved scope unless the project
   intentionally narrows the original audit goal.

## On the process ceremony

The per-stage ceremony ("thermo-nuclear review" at every merge, fresh-evidence
re-runs, exact staged-file lists) is heavyweight, but for agent-executed plans
that rigidity is a feature, not a smell — it's what keeps an agent from
wandering. The plans are internally consistent.

## Bottom line

Good refactoring built on real, verified defects — not résumé-driven complexity.
The risks are Stage 1's machinery (accept consciously, contain it), Stage 4's
on-device regression surface, and Stage 7's implementation cost. Doing stages 0
→ 1 → 2 → 5 and then reassessing captures the highest-value work first without
discarding the remaining plans.

`ssh_command.rs` remains separate giant-file debt. Add a focused future plan if
the goal expands from the eight audited findings to eliminating every existing
giant Rust file.
