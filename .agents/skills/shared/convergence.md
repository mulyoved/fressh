# Long-Session Convergence Policy

Use this policy when a skill or workflow is about to repeat review, fix,
verification, or subagent loops on the same task.

The policy is a strong advisory rule, not an absolute hard stop. The agent is
expected to run the checkpoint when a trigger appears. The agent may continue
without stopping only after recording why continuing is cheaper or safer than
consolidating first.

## Triggers

Run a convergence checkpoint when any of these happen:

- two review/fix loops have run on the same task without a clean result;
- the same or closely related finding returns after an attempted fix;
- reviewer or subagent thread/slot capacity is exhausted or close to exhausted;
- the workflow is about to retry a verification gate already identified as
  environment or configuration broken;
- patch anchors fail repeatedly in files that have changed during the session;
- a task changes a shared contract, helper shape, or assumption used by later
  tasks;
- a major review phase just completed and the workflow is about to launch
  another full review matrix;
- token or context cost is growing faster than the risk being reduced.

## Checkpoint Output

Keep the checkpoint short. Record it in the workflow's durable report when one
exists; otherwise record it in the user-visible session summary or active plan
state.

Include these fields:

- `Original plan`: the task or requirement the loop started from.
- `Current contract`: what remains in scope and what behavior must now hold.
- `Superseded assumptions`: assumptions or plan text that no longer apply.
- `Findings state`: duplicate findings, genuinely new defects, and rejected
  false positives.
- `Verification state`: trusted gates, blocked gates, downgraded gates, and the
  approved fallback for each downgraded gate.
- `Capacity state`: active reviewer/subagent threads, completed threads that can
  be closed, and the next batch size.
- `Next action`: targeted verification, one final integrated review, another
  bounded review batch, or a user decision.

## Reviewer And Subagent Capacity

- Batch reviewer and subagent work instead of opening unbounded parallel
  threads.
- Close completed reviewer/subagent threads before launching another phase when
  the environment supports it.
- Treat slot saturation as a process failure to correct, not normal retry
  behavior.
- Reduce the next batch size after saturation.
- Do not retry the same launch pattern after a thread-limit error without first
  changing the plan, closing completed threads, or reducing concurrency.

## Verification Downgrade

Once a verification gate is proven environment or configuration broken:

1. Record the command, exact failure summary, and why the failure is not caused
   by the current code change.
2. Name the fallback gate that will be used for the rest of the session.
3. Do not rerun the broken gate unless dependencies, configuration, or
   environment changed.
4. Report the downgraded gate in final verification notes.

Examples of valid fallbacks include a narrower package test, typecheck for the
touched package, a focused unit/integration test, or manual inspection when no
executable check exists.

## Patch Anchoring

Before nontrivial edits in churned files:

- refresh exact snippets from the active worktree;
- derive target paths from the current diff or current file list;
- use small anchored patches;
- split unrelated changes into separate patches;
- stop and consolidate if patch failures show the file is changing faster than
  the agent's context.

## Review Strategy

Distinguish targeted follow-up from final integrated review.

- After small patches, prefer targeted verification and update the existing
  findings queue.
- Do not reopen the full review matrix after every narrow amendment.
- Use another full review pass when the task contract changed, broad files
  changed, or final closeout needs integrated confidence.
- If another full review is launched after a convergence trigger, record why a
  targeted check is insufficient.

## User Decision Boundary

Stop for a user decision when the checkpoint shows:

- the next step requires product judgment or broad redesign;
- trusted verification is unavailable and no acceptable fallback exists;
- duplicate findings cannot be resolved from code or docs;
- continuing would mostly spend context or reviewer capacity without reducing
  risk.
