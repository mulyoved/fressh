# /pr

Prepare changes for a pull request by running tests and performing code review.
NOTE: This command does NOT create the actual PR or add files to git - the user will handle that manually.

1. Review changes comprehensively - Ensure all changes are needed and aligned with the PR goal. Remove only debug/test artifacts (like console.logs, temporary files, or debugging changes) while keeping all legitimate features, fixes, or tool updates - even if they're outside the main PR scope. When unsure, ask the user.
2. Run quality checks - Execute `yarn cq` to check for lint/compile errors and fix them as needed
3. Rethink PR readiness - Step back and evaluate if the PR is ready for review and truly solves the intended problem
4. AI code review - Use the mcp**zen**codereview tool to perform a thorough code review of all changes
5. Interactive fix loop:
   - Present identified issues to the user
   - Ask which problems need to be fixed
   - Fix the selected issues
   - Use mcp**zen**codereview again to re-review the changes
   - Repeat this process until the user confirms the PR is ready
6. Generate PR description - Create a comprehensive PR description with summary, test plan, and list of changes
7. DO NOT create the actual PR or run git commands - user will handle git operations manually
