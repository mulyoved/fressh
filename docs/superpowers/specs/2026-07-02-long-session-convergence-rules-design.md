# Long Session Convergence Rules Design

## Purpose

Issue 119 asks for explicit convergence rules for long refactor and review
sessions. The source postmortem for session
`019f1f02-30e8-7232-af60-b1ea6a3dbd04` showed strong review rigor but weak
convergence: repeated review/fix loops, stale task contracts, reviewer-slot
saturation, patch-anchor failures, repeated known-broken verification gates, and
very high token use.

This design adds a reusable process rule that future implementation and review
skills can reference without duplicating the full policy in every workflow.

## Goals

- Document a convergence checkpoint after repeated review/fix loops.
- Define reviewer and subagent batch limits, cleanup expectations, and slot
  saturation handling.
- Define a fallback path for verification gates proven to be environment or
  configuration broken.
- Distinguish final integrated review from repeated full review loops after
  small patches.
- Give long-session workflows one shared rule they can reference.
- Keep the first implementation scoped to process documentation and skill
  guidance, not application code.

## Non-Goals

- Do not change mobile, web, Rust, or generated application code.
- Do not introduce a new command-line tool or artifact script.
- Do not make the convergence rule an absolute hard stop.
- Do not retrofit every skill in the repository in the first pass.
- Do not change `git-pr`, `receiving-code-review`, `rloop-review`, or
  `verification-before-completion` in this issue unless a later plan expands
  scope.

## Architecture

Add one shared policy file:

- `.agents/skills/shared/convergence.md`

The policy is a strong advisory rule. Agents are expected to run the checkpoint
when triggered. They may continue without stopping only when they briefly record
why continuing is cheaper or safer than consolidating first.

The first implementation should then add short references to the shared policy
from the workflows most likely to create long-session churn:

- `.agents/skills/subagent-driven-development/SKILL.md`
- `.agents/skills/executing-plans/SKILL.md`
- `.agents/skills/requesting-code-review/SKILL.md`
- `.agents/skills/rloop-code-fix/SKILL.md`
- `.agents/skills/code-review/SKILL.md`
- `.agents/skills/code-review/references/workflow.md`
- `.agents/skills/code-review/references/stop-conditions.md`

Each workflow should link to the shared policy at its review, fix, verification,
or repeated-finding loop. The full rule should live only in the shared document.

## Shared Policy Content

The shared convergence policy should define these trigger conditions:

- two review/fix loops on the same task without a clean result;
- repeated similar findings after attempted fixes;
- reviewer or subagent thread/slot saturation;
- repeated failed attempts to run a gate already identified as environment or
  configuration broken;
- repeated patch-anchor failures in churned files;
- major drift from the original plan, task contract, or assumptions;
- a major review phase completes and the session is about to launch another full
  review matrix.

The policy should define a compact checkpoint output:

- what changed from the original plan;
- the current task contract and remaining scope;
- assumptions that are now superseded;
- duplicate findings versus genuinely new defects;
- which verification gates are trusted, blocked, or downgraded;
- the current unresolved findings queue;
- whether the next step should be targeted verification, one final integrated
  review, another bounded review batch, or a user decision.

The policy should also define process rules:

- batch reviewer and subagent work instead of opening unbounded parallel threads;
- close completed reviewer/subagent threads before launching another phase when
  the environment supports it;
- treat reviewer-slot saturation as a process failure to correct, not normal
  retry behavior;
- after a gate is proven environment-broken, record the command, failure reason,
  and fallback once, then use that fallback until the environment changes;
- before nontrivial edits in churned files, refresh exact snippets from the
  active worktree and use smaller anchored patches;
- after major review phases, compress current state into a short summary instead
  of replaying full branch history.

## Workflow Integration

### Subagent-Driven Development

Reference the shared convergence rule before repeated spec-review or
code-quality review loops. If a task needs multiple reviewer/fix passes, the
coordinating agent should consolidate root cause, task contract changes, and
remaining findings before launching more reviewers. If subagent capacity is
exhausted, the workflow should reduce batch size or clean up completed threads
instead of retrying the same launch pattern.

### Executing Plans

Reference convergence when verification fails repeatedly, when a plan step
changes the shared contract for later steps, or when the implementation no
longer matches the written plan. The checkpoint should update what remains in
scope before continuing through later tasks.

### Requesting Code Review

Adjust the current "review early, review often" guidance into bounded review.
Early review remains valuable, but after repeated review/fix cycles the agent
should consolidate findings and decide whether a targeted check or final
integrated review is more appropriate than another full pass.

### Rloop Code Fix

Keep the existing five-round batch boundary. Add a convergence reference for
cases where related findings point to one root cause before the boundary, where
verification gates are known broken, or where the same class of finding keeps
returning. Existing durable reports under `docs/run/` and `docs/tool-output/`
should hold the checkpoint when available.

### Code Review

Reference convergence from the autonomous fix loop and stop conditions. Repeated
findings should not trigger unlimited full External Codex reruns. After small
patches, the default should be targeted verification and queue updates. Full
integrated review should be reserved for broad edits, contract changes, or final
closeout.

## Data Flow

The convergence checkpoint is written session state, not a new executable tool.

1. A workflow reaches a trigger.
2. The agent writes a compact convergence summary.
3. The agent updates the active task contract: what remains in scope, what
   changed, and which assumptions no longer apply.
4. The agent batches unresolved findings into one queue.
5. The agent chooses the next action: targeted verification, one final
   integrated review, another bounded review batch, or a user decision.
6. Verification uses trusted gates first. Known environment-broken gates are not
   retried unless the environment changes.

For workflows with durable reports, the checkpoint should be recorded in the
report. For workflows without reports, the checkpoint can be a concise
user-visible summary and `update_plan` state.

## Error Handling

- Reviewer/subagent slot saturation: record it as a process failure, close
  completed threads if possible, reduce batch size, and avoid retrying the same
  launch pattern blindly.
- Known-broken verification gate: record the command, failure reason, and
  fallback once; use the fallback until dependencies, configuration, or
  environment change.
- Patch-anchor failure in churned files: refresh current snippets, reduce patch
  size, and stop escalating patch attempts if the file is changing faster than
  the agent's context.
- Repeated finding with no risk reduction: consolidate duplicate findings,
  identify the root cause, and stop for user decision if the next step requires
  broad redesign or product judgment.

## Testing

This issue changes process documentation and skill guidance. It should not run
mobile app tests unless the implementation unexpectedly touches app code.

Required verification:

- check that `.agents/skills/shared/convergence.md` exists;
- check that each scoped workflow references the shared policy;
- review the policy against the updated workflow text for contradictions;
- run a repository text search for stale unbounded-review language in the scoped
  files;
- optionally run a markdown formatting or lint command if the repo exposes one.

## Acceptance Criteria

- Long refactor/review sessions have a documented convergence checkpoint after
  repeated review/fix loops.
- Reviewer/subagent batch limits and cleanup expectations are documented.
- Known-broken verification gates have a documented fallback path.
- The workflow distinguishes final integrated review from repeated full-loop
  reviews after small patches.
- The rule can be referenced by future implementation and review skills.
- The first implementation updates the scoped workflow files and does not change
  application behavior.
