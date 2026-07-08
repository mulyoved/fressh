# Local Agent Config Cleanup Design

## Goal

Reduce repository-local agent/tooling confusion by keeping only Fressh-specific
Codex skills in the repo and relying on user/global installs for shared skills,
prompts, commands, editor config, and CI configuration.

## Current State

The machine already provides shared skills globally:

- `~/.codex/skills/*` points at `/home/muly/code/skills/skills/*`.
- `~/.claude/skills/*` points at `/home/muly/code/skills/skills/*`.

The repository still contains several local or legacy tool surfaces:

- `.codex/skills/` has Fressh/mobile-specific skills.
- `.agents/` is a working-tree symlink to a global shared skills location, while
  Git still tracks older `.agents/skills/*` entries with `skip-worktree`.
- `app/.agents/skills/` is a tracked copy of older OpenClaw-style skills, some
  with non-Fressh wording.
- `.claude/` contains command prompts and skill links, many of which duplicate
  global/user-level Claude configuration or reference missing local paths.
- `.codex/prompts/` is tracked, but the active user prompt directory on this
  machine points elsewhere.
- `.ai/context/` contains stale scratch/context XML files.
- `.vscode/` and `.github/` are repo-local editor and GitHub Actions config.

## Decisions

Keep only these repository-local skills:

- `.codex/skills/expo-deployment`
- `.codex/skills/upgrading-expo`
- `.codex/skills/qa-testing-android`
- `.codex/skills/ios-android-logs`
- `.codex/skills/modify-mobile-keyboard`

Remove these folders from the repository:

- `.agents`
- `app/.agents`
- `.claude`
- `.codex/prompts`
- `.ai`
- `.vscode`
- `.github`

Keep global/user skill surfaces outside this repository unchanged:

- `~/.codex/skills`
- `~/.claude/skills`
- `/home/muly/code/skills/skills`

## Documentation Cleanup

Update current-facing documentation so it no longer points at removed local
paths. At minimum:

- Remove the `AGENTS.md` claim that CI uses `.github/workflows/check.yml`.
- Remove or rewrite docs whose main purpose is now-obsolete local `.agents`
  workflow setup.
- Leave product or architecture docs intact when they only mention Claude,
  Codex, or GitHub as concepts rather than removed repository-local paths.

Use targeted path searches to find stale references after deletion:

- `.agents`
- `app/.agents`
- `.claude`
- `.codex/prompts`
- `.ai/context`
- `.vscode`
- `.github/workflows`

## Non-Goals

- Do not remove or alter global user/machine skills.
- Do not move the Fressh-specific Codex skills to global storage.
- Do not change application source code, package manager config, mobile build
  config, or generated artifacts.
- Do not rewrite historical product docs solely because they mention Claude,
  Codex, or GitHub in a non-local-config sense.

## Verification

After implementation:

- `git status --short` shows only the intended deletions and doc edits.
- `git ls-files` confirms removed folders are no longer tracked.
- `rg` confirms removed local path references are gone or intentionally absent
  from current-facing docs.
- `.codex/skills` still contains exactly the approved Fressh-specific skills.

No app build or test run is required because the cleanup is limited to local
agent/tooling metadata and docs.
