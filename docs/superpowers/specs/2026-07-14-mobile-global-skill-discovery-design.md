# Mobile Global Skill Discovery Design

## Goal

Make the mobile terminal `$` skill selector show both skills installed in the
active repository and user-installed global Codex skills. Repository skills must
take precedence when the same skill name exists in both scopes.

## Root Cause

The selector currently behaves according to its original design: the remote
discovery command scans only `.agents/skills` and `.codex/skills` under the
resolved repository root. It never inspects the user's global Codex skill
directory. The parser, modal, and cache return exactly the records supplied by
that repo-only command, so global skills cannot appear.

## Scope

Discovery will inspect these direct-child roots in this order:

```text
<repository-root>/.agents/skills/*/SKILL.md
<repository-root>/.codex/skills/*/SKILL.md
~/.codex/skills/*/SKILL.md
```

The global scan is limited to user-installed skills directly under
`~/.codex/skills`. It does not include bundled system skills nested below
`~/.codex/skills/.system`, plugin-cache skills, or arbitrary `SKILL.md` files
elsewhere on the host.

This change does not alter the keyboard action, selector modal, filtering,
selection, or terminal insertion behavior.

## Discovery and Precedence

Extend the existing Python discovery payload created by
`buildSkillDiscoveryCommand`. Resolve the repository root exactly as today, then
append the home-directory global root after both repository roots.

The parser continues to deduplicate case-insensitively by skill name and keep
the first record. Root order therefore defines precedence:

1. Repository `.agents` skill.
2. Repository `.codex` skill.
3. User-global `.codex` skill.

This preserves existing repository precedence and ensures a repository can
override a global skill intentionally. The returned list remains sorted by skill
name after deduplication.

Python's path reads follow normal skill-directory symlinks, which is required
because user-installed global skills may be represented by symlinks. The scan
still accepts only one directory level beneath each configured root.

## Cache Migration

Existing version 1 cache entries contain repo-only discovery results. Reusing
them after this change would make the selector appear unfixed until the user
manually refreshes every workspace.

Increment `SKILL_DISCOVERY_CACHE_VERSION` and the cache-key namespace to
version 2. Version 1 entries then miss naturally, causing the first selector
open in each workspace to perform combined discovery and write a version 2
record. No destructive storage migration is needed.

## Error Handling

A missing global directory produces no records and leaves repository discovery
unchanged. An unreadable or disappearing `SKILL.md` is skipped using the
existing per-file error handling. Failures in the discovery command itself
continue through the selector's existing inline error and retry behavior.

## Testing

Add a failing integration test before changing discovery. The test will create
an isolated home directory and repository, execute the generated discovery
command, and verify that:

- Repository and user-global skills are both returned.
- A repository skill wins over a global skill with the same case-insensitive
  name.
- A global-only skill is returned.
- Nested bundled-system-style skills under `.system` are excluded.
- Repository paths containing spaces and quotes remain supported.

Update cache tests to require version 2 keys and records and to prove that a
serialized version 1 record is rejected. Run the focused mobile integration
tests, mobile type checking/lint checks relevant to the changed files, and the
repository's CI-safe validation appropriate to the final diff.

## Delivery

This is a JavaScript/TypeScript behavior change, not a shell-config-only
keyboard change. Deliver it through the normal mobile application update path;
the runtime shell-config reload flow does not apply.
