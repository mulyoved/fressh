---
allowed-tools: Bash(yarn zx scripts/bug-fix-pr.mjs --smart:*), Bash(git branch --show-current), Bash(git diff), Bash(git diff --name-only), Bash(git status --porcelain), Bash(gh issue create:*), Bash(git checkout -b:*), Bash(git log --oneline -n:*), Bash(gh pr view:*)
---

# /git:cc-fix-pr

Create a bug fix commit and pull request using the automated workflow script. Automatically creates GitHub issues when needed.

<task>
You are a streamlined bug fix workflow assistant that creates commits and PRs with ZERO iterations.

You can handle two scenarios:
1. When an issue already exists - use the --smart flag to create PR automatically
2. When no issue exists (e.g., working on dev branch) - create issue first, then branch and PR

Always aim for complete automation with minimal user interaction.
</task>

<context>
This command uses the enhanced bug fix PR automation script at scripts/bug-fix-pr.mjs which features:
- Auto-detection of issue numbers from branch names
- Smart mode that analyzes and configures everything automatically
- Handles existing PRs gracefully without errors
- Intelligent test execution (only runs tests when code files change)
- Auto-staging, auto-description generation, and zero confirmations
- **Bot authorship support** - Uses credentials from ~/.env file if configured (GitHub App or personal token)

The assistant ALWAYS uses --smart flag for maximum automation.
</context>

<workflow>
1. **Initial Branch Check**
   - First check current branch with `git branch --show-current`
   - If branch name contains issue number (e.g., bug/4393-fix-something), proceed to step 4
   - If on dev/main branch or branch without issue number, proceed to step 2

2. **Automatic Issue Creation (when no issue exists)**
   - Analyze changes with `git diff` and `git status --porcelain`
   - Generate intelligent issue title from the changes
   - Create issue with: `gh issue create --title "Fix: [description]" --body "[detailed description]"`
   - Extract issue number from the created issue URL
   - Create new branch: `git checkout -b bug/[issue-number]-[brief-description]`
   - Continue to step 3

3. **Single Command Execution**
   - ALWAYS run: `yarn zx scripts/bug-fix-pr.mjs --smart`
   - The script will handle EVERYTHING automatically
   - No pre-checks needed, no iterations, no retries

4. **What the Script Handles Automatically with --smart**
   - Extracts issue number from branch name
   - Generates description from branch name
   - Auto-stages all tracked changes
   - Detects file types and skips tests if appropriate
   - Skips all confirmations
   - Creates commit with bot authorship (MUST be core8-claude-code[bot])
   - Pushes to origin with bot credentials
   - Creates PR or updates existing PR (as core8-claude-code[bot])
   - Comments on issue with PR link

5. **Success Recognition**
   - If output shows "Process completed successfully!" → Done
   - If output shows "PR already exists" → Still success, done
   - If output shows commit created and pushed → Success
   - If error about existing PR → Check PR status with `gh pr view`
   - Check PR author (should be "core8-claude-code[bot]" if credentials configured)

5.5. **Update Issue Labels (on success)**
   - Extract issue number from branch name
   - Remove work-in-progress labels and add PR label:
   ```bash
   gh issue edit <issue-number> --remove-label "Picked" --remove-label "F$(tmux display-message -p '#I')" --add-label "PR"
   ```

6. **Only Intervene If**
   - Script exits with actual error code
   - New untracked files need manual staging
   - Script reports authentication issues
</workflow>

<bash_execution>
## Pre-execution Analysis

When this command runs, it executes these bash commands in order:

1. **Repository State Analysis**:
   - Current branch: !`git branch --show-current`
   - Changed files: !`git status --porcelain`
   - Uncommitted changes: !`git diff --name-only`
   - Recent commits: !`git log --oneline -n 5`

This information helps determine whether to:
1. Create a new issue first (if on dev/main branch)
2. Proceed directly with PR creation (if issue number found in branch)
</bash_execution>

<error_handling>
If the script fails:
- Check if issue number is valid
- Verify GitHub CLI (gh) is authenticated
- Ensure branch follows naming convention
- Confirm changes are staged
- Check network connectivity
- If bot credentials are missing, script will warn but continue (PR created from personal account)
</error_handling>

<intelligent_behavior>
The assistant will:
1. Check current branch with `git branch --show-current`
2. If no issue number found in branch name:
   - Analyze changes with `git diff` to understand what was fixed
   - Generate descriptive issue title like "Fix: [specific problem description]"
   - Create comprehensive issue body with:
     - Summary of the problem
     - What was changed
     - Files modified
     - Testing requirements
   - Create issue and extract issue number from response
   - Create properly named branch: `bug/[issue]-[brief-description]`
3. Check `git status --porcelain` to see what files are changed
4. Automatically determine the best flags:
   - If only `.md`, `.json`, `.yml` files → add `--skip-tests`
   - Always use `--auto-stage` to avoid manual staging
   - Always use `--no-confirm` for streamlined workflow
5. Run ONE command with all appropriate flags
6. Never retry the same command - analyze errors and fix root cause

Example intelligent decisions:
- Documentation change detected → `--auto-stage --skip-tests --no-confirm`
- Code files changed → `--auto-stage --no-confirm` (tests will run)
- Mixed changes → `--auto-stage --no-confirm` (safer to run tests)
</intelligent_behavior>

<examples>
Example 1: When on dev branch with uncommitted changes:
```bash
# Check current branch
git branch --show-current  # Output: dev

# Analyze changes
git diff  # Shows QuickBooks test file changes

# Create issue
gh issue create --title "Fix QuickBooks integration test for address validation sync state" \
  --body "## Summary
Fixed the QuickBooks integration test case to correctly expect sync-conflict and syncStateShadow states when address validation creates a discrepancy.

## Changes Made
1. Updated test expectation from 'sync' to 'sync-conflict' state after address validation
2. Changed expected sync state from 'syncStateFull' to 'syncStateShadow' after approval
3. Updated test comment to explain that address validation correcting postal code (78701 to 78702) creates a legitimate discrepancy requiring user resolution

## Files Modified
- src/server/integrations/test-runner/samples/quickbooks/gap-report/quickbooks-core8-basic-sync-3700-s1-address-discrepancy.yaml"

# Extract issue number (e.g., 4393) and create branch
git checkout -b bug/4393-fix-quickbooks-test-address-validation

# Then run the PR script
yarn zx scripts/bug-fix-pr.mjs --smart
```

Example 2: When already on a properly named branch:
- bug/4333-fix-navigation
- fix/4333-header-issue  
- hotfix/4333-critical-bug
- 4333-quick-fix

The assistant will intelligently run commands like:
```bash
# For docs-only changes:
yarn zx scripts/bug-fix-pr.mjs 4333 "Updated documentation" --auto-stage --skip-tests --no-confirm

# For code changes:
yarn zx scripts/bug-fix-pr.mjs 4333 "Fixed navigation bug" --auto-stage --no-confirm

# Always with all needed flags in ONE command
```
</examples>

<important_notes>
- **Streamlined Features**:
  - Issue number auto-detection from branch name
  - Smart test execution (only for code changes)
  - Optional auto-staging of all changes
  - Skip confirmations for trusted workflows

- **PR Details**:
  - Created to the `dev` branch
  - Issue NOT auto-closed (only referenced)
  - QA must verify before closing
  - Author depends on credential configuration (see below)

- **Bot Configuration (Recommended)**:
  - Script loads credentials from `~/.env` file automatically
  - Supports two authentication methods:
    1. **GitHub App** (recommended): `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`
    2. **Personal Token**: `GH_TOKEN_CLAUDE_CODE`
  - If configured: PRs created as "core8-claude-code[bot]"
  - If not configured: Script warns but continues, PRs created from your personal account

- **Tips**:
  - Use `--auto-stage` for quick fixes
  - Use `--skip-tests` for non-code changes
  - Combine flags for maximum speed
  - The `--smart` flag handles all of the above automatically
</important_notes>
