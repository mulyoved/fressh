---
description: Check PR CI/CD failures, fix issues, validate locally, and confirm CI/CD passes
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh run list:*), Bash(gh api:*), Bash(git checkout:*), Bash(git pull:*), Bash(git diff:*), Bash(git status:*), Bash(yarn cq:*), Bash(yarn test:ci:*), Bash(yarn lint:fix:*), Bash(yarn format:*), Bash(yarn types:check:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*, git fetch:*, git merge:*), Task(*)
---

# /git:fix-ci-failure

Check PR CI/CD failures, intelligently fix issues, validate locally with comprehensive checks, and confirm CI/CD passes.

<task>
You are a CI/CD failure resolution assistant that diagnoses PR failures, applies targeted fixes, validates locally, and confirms successful CI/CD completion.

You handle the complete workflow:
1. Analyze PR CI/CD failure reasons
2. Categorize failures (fixable code issues vs environment issues)
3. Apply targeted fixes for code issues
5. Run comprehensive local validation
6. Push fixes and monitor CI/CD until success
</task>

<context>
This command analyzes GitHub PR CI/CD failures using the `gh` CLI and applies the same intelligent failure analysis from `/check` to distinguish between fixable code issues and acceptable environment issues.

Key capabilities:
- **PR Analysis** - Fetch PR details, check status, view logs
- **Failure Categorization** - Code issues (fixable) vs environment issues (acceptable)
- **Dev Sync** - Merge latest dev branch to catch integration issues
- **Local Validation** - Run `yarn cq` and `yarn test:ci` before pushing
- **Fix Loops** - Iterative fix-validate-push cycles until CI passes
- **CI Monitoring** - Track CI runs and verify successful completion
</context>

<workflow>
1. **PR Identification & Analysis**
   - If PR number provided: `gh pr view $ARGUMENTS`
   - If no PR number: `gh pr view` (uses current branch)
   - Check PR status and CI check results: `gh pr checks $ARGUMENTS` (or `gh pr checks` for current branch)
   - Identify failing CI jobs

2. **Fetch Detailed Failure Information**
   - List recent workflow runs: `gh run list --limit 5`
   - View specific failing run: `gh run view [run-id]`
   - Fetch job logs if needed: `gh api /repos/cube-9/cube9/actions/jobs/[job-id]/logs`
   - Analyze error patterns in logs

3. **Failure Categorization**
   - Use Task tool with general-purpose agent to analyze failures
   - Categorize as:
     - 🔧 **Code Issues** (fixable): Type errors, lint errors, test failures, schema validation
     - ⚠️ **Environment Issues** (acceptable): Missing credentials, external services, infrastructure
   - Identify specific files/areas requiring fixes

4. **Checkout & Update Branch**
   - Ensure on correct branch: `git checkout [branch-name]`
   - Pull latest changes: `git pull`
   - Verify current state: `git status`
5. **Merge Latest Dev Branch**
   - Fetch latest dev: `git fetch origin dev`
   - Merge dev into PR branch: `git merge origin/dev`
   - If merge conflicts occur:
     - List conflicted files: `git status`
     - Use Read tool to examine conflicts
     - Resolve conflicts carefully, preserving both PR changes and dev updates
     - Stage resolved files: `git add [resolved-files]`
     - Complete merge: `git commit` (with auto-generated merge commit message)
     - Verify resolution: `git status`
   - If merge succeeds without conflicts: Continue to next step
   - Push merged changes: `git push` (to update remote before running validations)


6. **Phase 1: Code Quality Fixes**
   - Run `yarn cq` to check format, lint, types
   - If fails: Apply fixes → Re-run `yarn cq` → Repeat until passes
   - Common fixes:
     - Type errors: Add proper types, fix imports
     - Lint errors: Run `yarn lint:fix`
     - Format errors: Run `yarn format`
   - Maximum 3 attempts before escalating

7. **Phase 2: CI Test Validation**
   - Run `yarn test:ci` for full CI simulation
   - If fails: Analyze with agent, categorize failures
   - Apply fixes for code issues only
   - Re-run both `yarn cq` AND `yarn test:ci` after fixes
   - Continue until:
     - Both pass completely (Complete Success), OR
     - Only environment issues remain (Acceptable Success), OR
     - Max 3 fix attempts reached (Failure)

8. **Push Fixes**
   - Stage changes: `git add .`
   - Commit with descriptive message: `git commit -m "Fix CI failures: [description]"`
   - Push to remote: `git push`

9. **Monitor CI/CD Completion**
   - Wait briefly for CI to start (30-60 seconds)
   - Check PR checks: `gh pr checks $ARGUMENTS` (or `gh pr checks` for current branch)
   - List new runs: `gh run list --limit 3`
   - View latest run: `gh run view [run-id]`
   - If still failing: Return to step 2 (max 3 total cycles)
   - If passing: Report success

10. **Success Recognition**
   - ✅ **Complete Success**: All CI checks pass
   - ✅ **Acceptable Success**: Code quality passes + only environment issues in CI
   - ❌ **Needs Escalation**: Persistent code issues after 3 cycles
</workflow>

<bash_execution>
## Pre-execution Analysis

When this command runs, it executes these bash commands in order:

1. **PR Status Check**:
   - View PR details: `gh pr view $ARGUMENTS` (or `gh pr view` for current branch)
   - Check status: `gh pr checks $ARGUMENTS`
   - List runs: `gh run list --limit 5`

2. **Repository State**:
   - Current branch: `git branch --show-current`
n### Merge Conflicts
- Run `git status` to see conflicted files
- Use Read tool to examine conflict markers (<<<<<<, =======, >>>>>>>)
- Resolve conflicts by combining changes intelligently
- Test merged code with `yarn cq` before committing
- Stage resolved files: `git add [files]`
- Complete merge: `git commit`
   - Local changes: `git status --porcelain`
   - Sync with remote: `git pull`

3. **Local Validation**:
   - Code quality: `yarn cq`
   - CI tests: `yarn test:ci`

4. **Push & Monitor**:
   - Commit and push: `git add . && git commit -m "..." && git push`
   - Check results: `gh pr checks $ARGUMENTS`
</bash_execution>

<error_handling>
## Common Failure Scenarios

### Type Errors
- Run `yarn types:check` to identify specific issues
- Fix missing types, incorrect imports, type mismatches
- Re-run `yarn cq` to validate

### Lint Errors
- Run `yarn lint` to see all issues
- Use `yarn lint:fix` for auto-fixable issues
- Manually fix remaining issues
- Re-run `yarn cq` to validate

### Test Failures
- Analyze test output from `yarn test:ci`
- Categorize as code issue or environment issue
- Fix code issues: update test logic, fix implementations, correct schemas
- Skip environment issues: missing credentials, external services
- Re-run `yarn test:ci` to validate

### CI/CD Still Failing After Push
- Wait for CI to complete (check `gh run view`)
- Analyze new failure logs
- If same issue: deeper investigation needed
- If new issue: start fix cycle again
- Max 3 total fix-push-check cycles

n2. **Dev Branch Sync**
   - Always merge latest dev branch before fixing issues
   - Catches integration problems early
   - Ensures fixes are compatible with current dev state
   - Sometimes the issue is already fixed in dev
### Git Issues
- Ensure branch is up to date: `git pull`
- Resolve merge conflicts if present
- Verify changes staged correctly: `git status`
- Check push permissions and authentication
</error_handling>

<intelligent_behavior>
The assistant will:

1. **Smart PR Detection**
   - If PR number in $ARGUMENTS: use it directly
   - Otherwise: detect from current branch
   - Validate PR exists before proceeding

2. **Log Analysis**
   - Use Task agent for complex log analysis
   - Extract specific error messages and line numbers
   - Identify patterns across multiple failures
   - Correlate failures to specific code changes

3. **Targeted Fixing**
   - Only fix code issues that are actually broken
   - Don't modify working code
   - Apply minimal, focused changes
   - Preserve existing functionality

4. **Validation Strategy**
   - Always run `yarn cq` first (faster feedback)
   - Only run `yarn test:ci` after `yarn cq` passes
   - Re-run BOTH after making fixes
   - Stop early if complete success achieved

5. **Intelligent Categorization**
   - Code issues MUST be fixed:
     - TypeScript type errors
     - ESLint rule violations
     - Test assertion failures
     - Schema validation errors
     - Missing exports/imports

   - Environment issues are acceptable:
     - GCP credential validation failures
     - Missing external service credentials
     - Network connectivity issues
     - Storybook provider setup issues
     - Test files requiring specific env setup

6. **Iterative Improvement**
   - Fix one category of issues at a time
   - Validate after each fix batch
   - Track progress across iterations
   - Prevent infinite loops with max attempt limits
   - Report clear status after each cycle

# Merge latest dev
git fetch origin dev
git merge origin/dev
# Output: Auto-merging... Merge made by the 'recursive' strategy.

git push

7. **Clear Communication**
   - Explain what failed and why
   - Describe fixes being applied
   - Report validation results clearly
   - Provide actionable next steps if escalation needed
</intelligent_behavior>

<examples>
## Example 1: Type Error in PR

```bash
# Check PR CI status
gh pr view 6850
# Output: CI failing - "Type check" job failed

# View run details
gh run view 12345678
# Output shows: Type error in src/components/deals/deal-form.tsx:42

# Checkout branch
git checkout bug/6850-fix-deals

# Run local validation
yarn cq
# Output: Type error - Property 'customerId' does not exist on type 'Deal'

# Fix the type error (add missing property or correct usage)
# ... apply fix ...

# Re-validate
yarn cq
# Output: All checks passed ✓

yarn test:ci
# Output: All tests passed ✓

# Commit and push
git add .
git commit -m "Fix CI failure: Add customerId type to Deal interface"
git push

# Monitor CI
gh pr checks
# Output: All checks passing ✓
```

## Example 2: Multiple Failures with Environment Issues

## Example 2: Merge Conflict Resolution

```bash
# Check PR
gh pr view 6920

# Checkout and merge dev
git checkout bug/6920-feature
git fetch origin dev
git merge origin/dev
# Output: CONFLICT (content): Merge conflict in src/utils/helpers.ts

# Examine conflicts
git status
# Output: both modified: src/utils/helpers.ts

# Use Read tool to see conflict markers and resolve
# ... resolve conflicts ...

git add src/utils/helpers.ts
git commit -m "Merge dev and resolve conflicts"
git push

# Continue with validation
yarn cq
# Output: All checks passed ✓
```

## Example 3: Issue Already Fixed in Dev

```bash
# Check PR
gh pr view 6900
# Output: CI failing - "Type check" job failed

# Merge latest dev
git fetch origin dev
git merge origin/dev
# Output: Merge made by the 'recursive' strategy.
#         Similar fix was already in dev!

git push

# Run validation
yarn cq
# Output: All checks passed ✓

yarn test:ci
# Output: All tests passed ✓

# No additional fixes needed - dev merge resolved it!
gh pr checks
# Output: All checks passing ✓
```

```bash
# Check PR
gh pr view

# Run local validation
yarn cq
# Output: 2 lint errors, 1 type error

# Fix code quality issues
yarn lint:fix
# ... manually fix type error ...

yarn cq
# Output: All checks passed ✓

# Run CI tests
yarn test:ci
# Output:
#   - 3 test failures in quickbooks integration (FIXABLE)
#   - GCP credential validation error (ENVIRONMENT)

# Analyze test failures with agent
# Agent categorizes: 2 code issues, 1 environment issue

# Fix the code issues only
# ... fix quickbooks test logic ...

# Re-validate everything
yarn cq && yarn test:ci
# Output:
#   - yarn cq: All passed ✓
#   - yarn test:ci: Only GCP credential error remains (acceptable)

# Push fixes
git add .
git commit -m "Fix CI failures: Correct QuickBooks test assertions and type errors"
git push

# Confirm CI passes (with acceptable env issues)
gh pr checks
# Output: Tests passing (GCP integration tests skipped - expected)
```

## Example 3: Persistent Failure Requiring Escalation

```bash
# Attempt 1
yarn cq  # Passes
yarn test:ci  # Fails: Schema validation error
# Fix applied, push made

# Attempt 2
yarn cq  # Passes
yarn test:ci  # Fails: Different schema error
# Fix applied, push made

# Attempt 3
yarn cq  # Passes
yarn test:ci  # Still fails: Complex schema issue

# Report to user:
# "After 3 fix attempts, schema validation errors persist in invoice generation tests.
#  This may require architectural review. Specific issues:
#  1. Invoice schema expects 'customerId' but tests provide 'dealId'
#  2. Schema validation occurring in multiple test files
#  Recommendation: Review schema design or update test fixtures comprehensively."
```
</examples>

<important_notes>
## Key Principles

- **Local Validation First**: Always run `yarn cq` and `yarn test:ci` before pushing
- **Categorize Intelligently**: Distinguish code issues from environment issues
- **Iterative Fixes**: Apply targeted fixes, validate, repeat
- **Max 3 Cycles**: Prevent infinite loops with attempt limits
- **Clear Reporting**: Communicate status, progress, and blockers clearly

## CI/CD Specifics

- **GitHub Actions**: Primary CI/CD platform
- **Check Types**: Format, lint, type check, tests, build
- **Monitoring**: Use `gh pr checks` and `gh run view` for status
- **Timing**: Allow 30-60s after push for CI to start

## Validation Strategy

- **yarn cq**: MUST pass completely, no exceptions
- **yarn test:ci**: Code issues must be fixed, environment issues acceptable
- **Both commands**: Always re-run after making fixes
- **Success criteria**: Complete pass OR only environment issues remaining

## When to Escalate

- Code issues persist after 3 fix cycles
- Failures indicate architectural problems
- Changes required are beyond scope of quick fixes
- Multiple unrelated failures suggest broader issues
</important_notes>
