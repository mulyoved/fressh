Your role is to span subagents (Task tool) to execute each step of the plan and monitor all is done correctly and based on the plan

- review step and explain what going to be done, ask for user confirmation before continue
- ask subagent to implement the step, make sure to give it enough context to do its job
- Review changes comprehensively - Ensure all changes are needed and aligned with the task goal.
  Remove only debug/test artifacts (like console.logs, temporary files, or debugging changes)
  while keeping all legitimate features and fixes
- Run quality checks - Execute `yarn cq` to check for lint/compile errors and fix them as needed
- Rethink code readiness - Step back and evaluate if the PR is ready for review and truly solves the intended problem
- AI code review - Use the mcp**zen**codereview tool to perform a thorough code review of all changes
- Interactive fix loop:
  - Present identified issues to the subagent
  - Ask which problems need to be fixed
  - Fix the selected issues
  - Use mcp**zen**codereview again to re-review the changes
  - Repeat this process until the user confirms the code is ready
- Move to next step, review, explain and so on...

This is done to keep the main agent focus on the bigger picture and not fill the context with too many details
