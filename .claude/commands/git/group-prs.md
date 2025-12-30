---
allowed-tools: Bash(yarn zx scripts/group-prs.mjs:*), Bash(git branch --show-current), Bash(git status --porcelain), Bash(yarn zx -e:*)
argument-hint: <branch-name> <pr-number-1> <pr-number-2> ...
description: Group multiple PRs under a new branch and merge them, then create a group PR (project)
---

# /group-prs

Group multiple PRs under a new branch and merge them into a single consolidated branch, then create a PR from that branch to dev.

<task>
You are a streamlined PR grouping workflow assistant that merges multiple PRs into a single branch with ZERO iterations.

Always aim for complete automation with minimal user interaction.
</task>

<context>
This command uses the PR grouping script at scripts/group-prs.mjs which features:
- Automated branch creation and PR merging
- Smart merge conflict handling
- Sequential PR processing with validation
- **Bot authorship support** - Uses credentials from ~/.env file (GitHub App or personal token)
- Creates merge commits with proper attribution

The script loads credentials from ~/.env file for bot operations.
</context>

<workflow>
1. **Initial Validation**
   - User provides branch name and list of PR numbers
   - Example: `/group-prs group/cleanup-6601-6603 6601 6602 6603`
   - Validate that at least 2 PR numbers are provided

2. **Repository State Check**
   - Check current branch with `git branch --show-current`
   - Check for uncommitted changes with `git status --porcelain`
   - Warn user if there are uncommitted changes

3. **Single Command Execution**
   - Run: `yarn zx scripts/group-prs.mjs <branch-name> <pr-numbers...>`
   - The script will handle EVERYTHING automatically
   - No pre-checks needed, no iterations, no retries

4. **What the Script Handles Automatically**
   - Creates new branch from current HEAD
   - Fetches and merges each PR sequentially
   - Handles merge conflicts automatically (if possible)
   - Validates each merge before proceeding
   - Pushes final merged branch with bot credentials
   - Creates merge commits with bot authorship (core8-claude-code[bot])

5. **Create Group PR to Dev (Required)**
   - After the script completes, you MUST create a PR from the group branch to dev
   - Use `yarn zx -e` with inline script to create PR as core8-claude-code[bot]
   - Generate PR title summarizing all included PRs (e.g., "Refactor: Code quality improvements (PRs #6596-6600)")
   - Generate PR body listing all PRs with titles and a summary of changes
   - Load bot credentials from ~/.env using same method as group-prs.mjs script
   - Use GitHub API to create PR: `gh api repos/cube-9/cube9/pulls`
   - Include Co-Authored-By footer with Claude attribution

6. **Success Recognition**
   - If output shows "Process completed successfully!" → Done with merge
   - Create the group PR → Final success
   - If error occurs → Report to user with error details

7. **Only Intervene If**
   - Script exits with actual error code
   - Manual conflict resolution is required
   - Script reports authentication issues
   - PR creation fails
</workflow>

<bash_execution>
## Pre-execution Analysis

When this command runs, it executes these bash commands in order:

1. **Repository State Analysis**:
   - Current branch: group/cleanup-6601-6603
   - Changed files: M app/.claude/commands/git/group-prs.md
   - Uncommitted changes: app/.claude/commands/git/group-prs.md
   - Recent commits: f854d9128 Merge PR #6601: Remove commented-out code from AssignmentDialog
1ee4837ac Merge PR #6602: Remove useless getPersonnelIdFromValue helper function
3e094e339 Merge PR #6603: Fix inconsistent search behavior between components
d1439d48e Merge PR #6596: Update outdated comments and refactor oversized modules
9e7fea8b9 Merge PR #6597: Refactor large pipeline trace serializer

This information helps determine whether to:
1. Create a new issue first (if on dev/main branch)
2. Proceed directly with PR creation (if issue number found in branch)
</bash_execution>

<error_handling>
If the script fails:
- Check if PR numbers are valid and exist
- Verify GitHub CLI (gh) is authenticated
- Ensure branch name is valid
- Check for merge conflicts that need manual resolution
- Verify network connectivity
- If bot credentials are missing, script will warn but continue (merges created from personal account)
</error_handling>

<intelligent_behavior>
The assistant will:
1. Validate user provided at least 2 PR numbers
2. Validate that all required arguments are provided
3. Check repository state with `git status --porcelain`
4. Run ONE command with all PR numbers
5. After script completes, create PR from group branch to dev using bot credentials
6. Never retry the same command - analyze errors and fix root cause
7. Report final summary with branch URL, PR list, and group PR URL

Example execution:
```bash
# User provides: /group-prs group/6589 6594 6593 6592 6591 6590 6589

# Step 1: Run the group-prs script
yarn zx scripts/group-prs.mjs group/6589 6594 6593 6592 6591 6590 6589

# Step 2: Create PR from group branch to dev as core8-claude-code[bot]
# Use yarn zx with inline script (same credential loading as group-prs.mjs)
yarn zx -e "
  import { $ } from 'zx';
  import fs from 'fs';
  import path from 'path';
  import os from 'os';
  import jwt from 'jsonwebtoken';

  // Load GitHub App credentials from ~/.env
  const envPath = path.join(os.homedir(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const GITHUB_APP_ID = envContent.match(/GITHUB_APP_ID=(.+)/)?.[1];
  const GITHUB_APP_INSTALLATION_ID = envContent.match(/GITHUB_APP_INSTALLATION_ID=(.+)/)?.[1];
  const GITHUB_APP_PRIVATE_KEY = envContent.match(/GITHUB_APP_PRIVATE_KEY=\\\"(.+)\\\"/)?.[1]?.replace(/\\\\n/g, '\\n');

  // Generate GitHub App token
  const jwtToken = jwt.sign({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, iss: GITHUB_APP_ID }, GITHUB_APP_PRIVATE_KEY, { algorithm: 'RS256' });
  const tokenResponse = await fetch(\`https://api.github.com/app/installations/\${GITHUB_APP_INSTALLATION_ID}/access_tokens\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${jwtToken}\`, Accept: 'application/vnd.github.v3+json' }
  });
  const { token: botToken } = await tokenResponse.json();

  // Create PR using GitHub API
  const prBody = \`## Summary
This PR consolidates multiple refactoring PRs...

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>\`;

  await $\`GH_TOKEN=\${botToken} gh api repos/cube-9/cube9/pulls -f title='Group PR Title' -f head='group/branch-name' -f base='dev' -f body=\${prBody}\`;
"
```


<examples>
Example 1: Basic usage with multiple PRs
```
User: /group-prs group/feature-bundle 1234 1235 1236
Assistant: [Runs script with all PR numbers in one command]
```

Example 2: Cleanup refactoring PRs
```
User: /group-prs group/cleanup-6601-6603 6601 6602 6603
Assistant: [Validates 3 PRs provided, runs grouping script once]
```

Example 3: Error - too few PRs
```
User: /group-prs group/single 1234
Assistant: "Error: Please provide at least 2 PR numbers to group"
```
</examples>

<important_notes>
- **Streamlined Features**:
  - Automatic branch creation from current HEAD
  - Sequential PR merging with validation
  - Bot credentials from ~/.env file
  - Merge commits authored by core8-claude-code[bot]

- **PR Grouping Details**:
  - Creates new branch with provided name
  - Merges PRs in the order specified
  - Each merge creates a commit referencing the original PR
  - Final branch pushed to origin

- **Bot Configuration (Recommended)**:
  - Script loads credentials from `~/.env` file automatically
  - Supports GitHub App or personal token authentication
  - If configured: Merge commits created as "core8-claude-code[bot]"
  - If not configured: Script warns but continues with personal account

- **Tips**:
  - Ensure you're on the correct base branch before running
  - PR numbers should be from the same repository
  - The script will handle all merge conflicts automatically
  - A PR from the group branch to dev will be automatically created as core8-claude-code[bot]
</important_notes>
