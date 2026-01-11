---
description: GPT-5.2 Pro code review via Oracle - writes validated findings to docs/tasks/
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(gh:*), Bash(git:*), Bash(rg:*), Bash(ast-grep:*), Bash(cat:*), Bash(mkdir:*), Write(.ai/tmp/**), Write(docs/tasks/**), Edit
argument-hint: --pr <number> | "<topic to review>" | --files <path>
---

# GPT-5.2 Pro Code Review

Activate the **gpt-code-review** skill to perform external code review using GPT-5.2 Pro via Oracle.

## Arguments: $ARGUMENTS

Options:
- `--pr <number>` - Review a GitHub PR
- `--files <paths>` - Review specific files
- `"<topic>"` - Topic-based review (finds relevant files)
- `--collect-only` - Only collect context, skip Oracle call

## Review Methodology

GPT-5.2 Pro uses a comprehensive code quality prompt that prioritizes **needle-moving discoveries**:

**🚨 High Priority**: Security, data integrity, runtime stability, correctness
**🔥 Medium Priority**: Performance, maintainability, code duplication, React best practices
**❌ Excluded**: Minor style issues, micro-optimizations, theoretical concerns

## Quick Start

Read and follow the workflow in `.claude/skills/gpt-code-review/SKILL.md`.

The skill will:
1. Collect context (PR diff, files, schema)
2. Send to GPT-5.2 Pro via Oracle with detailed review prompt (5-15 min)
3. Validate findings against actual code
4. Write findings report to `docs/tasks/pr-{N}-code-review-findings.md`

## CRITICAL: Oracle Failure Policy

**If Oracle fails (timeout, connection error, CLI not found), you MUST:**
1. Report the failure to the user with the specific error
2. Suggest troubleshooting steps
3. Ask if user wants to retry

**NEVER perform your own code review as a fallback.** The entire point of this skill is external GPT review, not Claude's analysis.
