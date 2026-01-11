# /pr

Prepare changes for a pull request by running tests and performing code review.
NOTE: This command does NOT create the actual PR or add files to git - the user will handle that manually.

1. Understand the context - Before diving into code review, ask and research:
   - What's the primary goal of this PR? (bug fix, feature, refactor, etc.)
   - Are there known bugs or production issues this addresses?
   - What's the timeline and risk tolerance? (quick fix vs. comprehensive refactor)
   - Are there related PRs or issues that provide additional context?
   - Review git log, branch name, and any linked issues to understand the scope
   - Research the codebase to understand what changed and why
   - Answer these questions based on your research before proceeding
2. Sync with latest dev branch - Ensure the branch is up to date before running checks:
   - Fetch the latest changes from origin: `git fetch origin dev`
   - Merge dev into current branch: `git merge origin/dev`
   - If conflicts occur, resolve them carefully by:
     - Examining each conflict to understand both changes
     - Preserving the intent of both the current changes and dev updates
     - Testing that merged code maintains functionality
     - Asking the user for guidance on non-trivial conflicts
     - After resolving conflicts, re-run quality checks to ensure nothing broke
3. Review changes comprehensively - Ensure all changes are needed and aligned with the PR goal. Remove only debug/test artifacts (like console.logs, temporary files, or debugging changes) while keeping all legitimate features, fixes, or tool updates - even if they're outside the main PR scope. When unsure, ask the user.
4. Run quality checks - Execute `yarn cq` to check for lint/compile errors and fix them as needed
5. Rethink PR readiness - Step back and evaluate if the PR is ready for review and truly solves the intended problem
6. AI code review - Use the mcp**zen**codereview tool to perform a thorough, prioritized code review:
   - Focus on needle-moving discoveries that significantly impact maintainability
   - Review for: unused code, complexity issues, duplication, maintainability problems
   - Prioritize findings: 🚨 High Priority (easy fixes, big impact) vs 🔥 Medium Priority (harder fixes, still impactful)
   - Exclude: minor style issues, micro-optimizations (<10%), theoretical best practices
   - Structure findings with: file:line references, Impact statement, and specific Recommendations
7. Interactive fix loop:
   - Present identified issues to the user
   - Ask which problems need to be fixed
   - Fix the selected issues
   - Use mcp**zen**codereview again to re-review the changes
   - Repeat this process until the user confirms the PR is ready
8. Generate PR description - Create a comprehensive PR description with summary, test plan, and list of changes
9. DO NOT create the actual PR or run git commands - user will handle git operations manually
