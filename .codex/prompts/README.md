# Codex Custom Prompts

This directory contains custom prompts for the Codex CLI that are shared across the team.

## Available Prompts

- **analyze-general.md** - General code analysis
- **analyze-regression.md** - Analyze test regressions
- **analyze-test-results.md** - Analyze test results and failures
- **analyze.md** - Quick analysis prompt
- **check.md** - Run code quality checks
- **debug-storybook.md** - Debug and fix Storybook stories
- **git-fix-pr.md** - Fix issues in pull requests
- **pr.md** - Create pull requests
- **run.md** - Run tests and tasks
- **select-test.md** - Select and configure tests
- **work-on-issue.md** - Work on specific issues
- **work-step-by-step.md** - Step-by-step task workflow

## Setup Instructions

The Codex CLI reads custom prompts from `~/.codex/prompts/`. To use the prompts from this repository:

### Option 1: Symlink (Recommended)

Create a symlink from your home directory to this repository:

```bash
# Navigate to the repository root
cd /path/to/cube9-dev

# Backup existing prompts (if any)
mv ~/.codex/prompts ~/.codex/prompts.backup 2>/dev/null || true

# Create symlink
ln -s "$(pwd)/.codex/prompts" ~/.codex/prompts

# Verify the symlink
ls -la ~/.codex/prompts
```

### Option 2: Copy (Not Recommended)

If you prefer not to use symlinks, you can copy the prompts:

```bash
cp -r .codex/prompts/* ~/.codex/prompts/
```

Note: You'll need to manually sync changes when prompts are updated in the repository.

## Usage

Once set up, you can use any custom prompt with the codex CLI:

```bash
codex /prompt-name
```

For example:
```bash
codex /check          # Run code quality checks
codex /pr             # Create a pull request
codex /analyze        # Analyze code
```

## Adding New Prompts

To add a new custom prompt:

1. Create a new `.md` file in this directory
2. Write your prompt content
3. Commit and push to share with the team
4. The prompt will automatically be available to all team members using the symlink setup

## Troubleshooting

**Prompts not showing up?**
- Verify the symlink exists: `ls -la ~/.codex/prompts`
- Check it points to the repository: should show `~/.codex/prompts -> /path/to/cube9-dev/.codex/prompts`
- If using the copy method, make sure you copied the files after the latest changes

**Want to restore original prompts?**
```bash
rm ~/.codex/prompts
mv ~/.codex/prompts.backup ~/.codex/prompts
```
