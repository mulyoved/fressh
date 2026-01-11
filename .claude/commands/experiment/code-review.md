---
allowed-tools:
description: Analyze code for unused, complex, or duplicated patterns
argument-hint: OPTIONAL: Specify "recent commits" to focus on the most recently modified files, or describe a specific part of the codebase (otherwise it'll scan the entire codebase)
---

# Code Quality Review

Analyze the codebase for code quality or maintainability issues, and suggest improvements.

Specific area to focus on (if any): "$ARGUMENTS"

## Core Philosophy

This command prioritizes **needle-moving discoveries** over exhaustive lists. Every finding must demonstrate significant impact on the maintainability or quality of the codebase.

### 🚨 High Priority Issues
Issues that could easily be fixed, and would have a significant impact on the maintainability or quality of the codebase.

### 🔥 Medium Priority Issues
Issues that may be harder to fix, but would still have a significant impact on the maintainability or quality of the codebase.

### ❌ Excluded from Reports
Minor style issues, micro-optimizations (<10%), theoretical best practices, obscure edge cases, or things that would have unintended side effects.


## Process

### 1. Understand the codebase and project structure

- Read CLAUDE.md for project guidelines and standards
- Review docs/ai-context/project-structure.md for architecture
- Scan README.md and documentation to understand how things are built
- Check pyproject.toml or package.json for dependencies and tooling

### 2. Define the scope of the analysis

If the user has specified "recent commits", review all of the files from the 5 most recent commits, and their dependencies.

If the user has specified a specific area to focus on, review that area in depth.

Otherwise review the entire codebase, prioritizing files that might have a lot of complexity or be large, or otherwise have room for improvement.


### 3. Systematic code analysis

Review all of the listed areas of analysis the scope specified. If the user has provided a specific area to focus on, review that area in depth, otherwise review the entire codebase.

1. **Unused Code**
  - Dead functions, variables, imports
  - Unreachable code paths
  - Obsolete comments

2. **Complexity Reduction**
  - Overly nested structures
  - Long functions that should be split
  - Complex conditionals that could be simplified
  - Unnecessary abstractions
  - Unnecessary edge case handling for things that don't matter

3. **Code Duplication**
  - Repeated patterns that could be extracted
  - Similar functions that could be generalized
  - Copy-pasted code blocks

4. **Maintainability Issues**
  - Unclear naming
  - Missing type hints
  - Inconsistent patterns
  - Tight coupling

### 3. Prioritize findings

- **High Priority**: Issues that impact functionality, security, or major maintainability
- **Medium Priority**: Code that works but is hard to understand or modify
- **Low Priority**: Style issues or minor improvements


## Analysis Tools

Do *not* write any code and
Do *not* chain together multiple complex commands (as that will likely require a bunch of approvals),

Instead use just use your normal codebase navigation tools to gather information.

Some optional additional tools:
- `git log --oneline -n 5` - List of recent commits
- `git diff --name-only HEAD~5..HEAD` - List of files changed in recent commits
- `grep -r "TODO\|FIXME\|HACK" --include="*.py" --include="*.js" --include="*.ts"` - List of technical debt markers
- `find . -name "*.py" -exec wc -l {} + | sort -n` - List of large files


## Output format:

### Summary
- Files analyzed: [count]
- Focus area: [recent commits/specific request/full scan]
- Total issues found: [count by priority]

### High Priority Opportunities
------------------------------------

**Issue**: [Summary of the issue with file:line references]
**Impact**: [Why this matters]
**Recommendation**: [Specific fix with example if helpful]

### Medium Priority Opportunities
------------------------------------

**Issue**: [Summary of the issue with file:line references]
**Impact**: [Why this matters]
**Recommendation**: [Specific fix with example if helpful]

(low priority issues not included)
