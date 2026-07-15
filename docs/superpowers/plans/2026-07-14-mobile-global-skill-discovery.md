# Mobile Global Skill Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile terminal `$` selector show repository skills and
direct user-installed global Codex skills, with repository skills taking
precedence.

**Architecture:** Extend the existing side-channel Python discovery command with
`~/.codex/skills` as its last root, leaving parsing, filtering, modal behavior,
and insertion unchanged. Isolate `HOME` in command-execution tests so they
remain deterministic, then increment the discovery cache namespace and record
version so repo-only cache entries cannot conceal the new results.

**Tech Stack:** TypeScript 5.9, Node.js test runner through `tsx`, an embedded
Python 3 discovery script, React Native MMKV cache storage, pnpm, and Turbo.

## Global Constraints

- Scan direct children only, in this order: `<repository-root>/.agents/skills`,
  `<repository-root>/.codex/skills`, then `~/.codex/skills`.
- Exclude bundled skills below `~/.codex/skills/.system`, plugin-cache skills,
  and arbitrary skill roots.
- Deduplicate skill names case-insensitively and keep the first record, so
  repository skills override global skills.
- Preserve the existing alphabetical result ordering after deduplication.
- Missing or unreadable global skill files must not prevent repository skills
  from loading.
- Keep keyboard routing, modal UI, filtering, selection, and `$skill-name `
  insertion unchanged.
- Invalidate version 1 discovery caches without clearing application data.
- Do not edit generated files or `apps/mobile/config/shell-config.json`.
- Do not clear `com.finalapp.vibe2` application data or run
  `test:e2e:clear-state`.

## File Map

- Modify `apps/mobile/src/lib/skill-discovery.ts`: add the remote user's global
  Codex skill root to the existing ordered discovery roots.
- Modify `apps/mobile/test/integration/skill-discovery.test.ts`: prove combined
  discovery and isolate all executed commands from the developer's real home
  directory.
- Modify `apps/mobile/src/lib/skill-discovery-cache.ts`: move cache records and
  keys from version 1 to version 2.
- Modify `apps/mobile/test/integration/skill-discovery-cache.test.ts`: verify
  the v2 namespace and rejection of v1 records.
- Reference
  `docs/superpowers/specs/2026-07-14-mobile-global-skill-discovery-design.md`:
  approved behavior contract; no further edits expected.

---

### Task 1: Discover Repository and User-Global Skills

**Files:**

- Modify: `apps/mobile/test/integration/skill-discovery.test.ts`
- Modify: `apps/mobile/src/lib/skill-discovery.ts`

**Interfaces:**

- Consumes: `buildSkillDiscoveryCommand(projectRoot: string): string` and
  `parseSkillDiscoveryResult(output: string): SkillDiscoveryResult | null`.
- Produces: the unchanged
  `buildSkillDiscoveryCommand(projectRoot: string): string` API, whose command
  now reads the ordered repository and user-global roots.

- [ ] **Step 1: Add a deterministic command environment helper**

Add this helper immediately after `const execFileAsync = promisify(execFile);`
in `apps/mobile/test/integration/skill-discovery.test.ts`:

```ts
function createDiscoveryEnv(
	homeDirectory: string,
	overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	return {
		...process.env,
		...overrides,
		HOME: homeDirectory,
	};
}
```

For every existing test that executes `buildSkillDiscoveryCommand`, add an
isolated `HOME` to the `execFileAsync` options. Use a path below that test's
temporary repository; the directory need not exist when the test expects no
global skills:

```ts
{
	cwd: tempRepo,
	env: createDiscoveryEnv(join(tempRepo, 'isolated-home')),
}
```

For the nested-cwd tests, retain their existing `cwd` and use the same isolated
home form:

```ts
{
	cwd: nestedCwd,
	env: createDiscoveryEnv(join(tempRepo, 'isolated-home')),
}
```

```ts
{
	cwd: panePath,
	env: createDiscoveryEnv(join(tempRepo, 'isolated-home')),
}
```

For the no-git test, replace both custom environments with:

```ts
{
	env: createDiscoveryEnv(join(tempRepo, 'isolated-home'), {
		PATH: tempBin,
	}),
}
```

```ts
{
	cwd: tempRepo,
	env: createDiscoveryEnv(join(tempRepo, 'isolated-home'), {
		PATH: tempBin,
	}),
}
```

For the side-channel completion test, use:

```ts
{
	cwd: tempRepo,
	env: createDiscoveryEnv(join(tempRepo, 'isolated-home')),
}
```

This setup change prevents all existing exact-result assertions from reading
real skills under the test runner's `$HOME`.

- [ ] **Step 2: Write the failing combined-discovery test**

Add this test after the existing command-shape test and before the repo-only
execution tests:

```ts
void test('buildSkillDiscoveryCommand discovers repo and user-global skills with repo precedence', async () => {
	const tempRoot = await mkdtemp(join(tmpdir(), 'skill-discovery-combined-'));
	try {
		const repoRoot = join(tempRoot, "repo with ' quote");
		const homeDirectory = join(tempRoot, 'home');
		const repoDuplicateSkill = join(
			repoRoot,
			'.agents',
			'skills',
			'shared',
			'SKILL.md',
		);
		const repoOnlySkill = join(
			repoRoot,
			'.codex',
			'skills',
			'repo-only',
			'SKILL.md',
		);
		const globalDuplicateSkill = join(
			homeDirectory,
			'.codex',
			'skills',
			'shared',
			'SKILL.md',
		);
		const globalOnlySkill = join(
			homeDirectory,
			'.codex',
			'skills',
			'global-only',
			'SKILL.md',
		);
		const bundledSystemSkill = join(
			homeDirectory,
			'.codex',
			'skills',
			'.system',
			'bundled',
			'SKILL.md',
		);

		await Promise.all([
			mkdir(join(repoRoot, '.agents', 'skills', 'shared'), {
				recursive: true,
			}),
			mkdir(join(repoRoot, '.codex', 'skills', 'repo-only'), {
				recursive: true,
			}),
			mkdir(join(homeDirectory, '.codex', 'skills', 'shared'), {
				recursive: true,
			}),
			mkdir(join(homeDirectory, '.codex', 'skills', 'global-only'), {
				recursive: true,
			}),
			mkdir(join(homeDirectory, '.codex', 'skills', '.system', 'bundled'), {
				recursive: true,
			}),
		]);
		await Promise.all([
			writeFile(
				repoDuplicateSkill,
				'---\nname: Shared-Skill\ndescription: repository wins\n---\n',
			),
			writeFile(
				repoOnlySkill,
				'---\nname: repo-only\ndescription: repository only\n---\n',
			),
			writeFile(
				globalDuplicateSkill,
				'---\nname: shared-skill\ndescription: global duplicate\n---\n',
			),
			writeFile(
				globalOnlySkill,
				'---\nname: global-only\ndescription: global only\n---\n',
			),
			writeFile(
				bundledSystemSkill,
				'---\nname: bundled\ndescription: excluded system skill\n---\n',
			),
		]);

		const { stdout } = await execFileAsync(
			'/bin/bash',
			['-lc', buildSkillDiscoveryCommand(repoRoot)],
			{
				cwd: repoRoot,
				env: createDiscoveryEnv(homeDirectory),
			},
		);

		assert.deepEqual(parseSkills(stdout), [
			{
				name: 'global-only',
				path: globalOnlySkill,
				description: 'global only',
			},
			{
				name: 'repo-only',
				path: repoOnlySkill,
				description: 'repository only',
			},
			{
				name: 'Shared-Skill',
				path: repoDuplicateSkill,
				description: 'repository wins',
			},
		]);
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
});
```

Rename the command-shape test to describe the new scope and assert that the
generated Python uses the remote user's home directory:

```ts
void test('buildSkillDiscoveryCommand scopes discovery to repo and user-global skills', () => {
	const command = buildSkillDiscoveryCommand("/tmp/repo with ' quote");

	assert.match(command, /python3 -c/);
	assert.match(command, /\.codex/);
	assert.match(command, /\.agents/);
	assert.match(command, /pathlib\.Path\.home/);
	assert.match(command, /skills/);
	assert.match(command, /SKILL\.md/);
	assert.match(command, /errors='\\''replace'\\''/);
	assert.doesNotMatch(command, /plugins/);
	assert.doesNotMatch(command, /<<'PY'/);
	assert.doesNotMatch(command, /\r?\n/);
	assert.match(command, /'\/tmp\/repo with '\\'' quote'/);
});
```

- [ ] **Step 3: Run the focused test and confirm the behavioral failure**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/skill-discovery.test.ts
```

Expected: FAIL only for the new combined-discovery assertion because
`global-only` is absent. Existing command-execution tests must remain
deterministic because their `HOME` values are isolated.

- [ ] **Step 4: Extend the ordered discovery roots minimally**

In `buildSkillDiscoveryCommand` within `apps/mobile/src/lib/skill-discovery.ts`,
replace the current `roots` construction with:

```ts
		'home=pathlib.Path.home()',
		"roots=[base/'.agents'/'skills',base/'.codex'/'skills',home/'.codex'/'skills']",
```

Keep the current record iteration, per-file `OSError` handling, framed JSON
output, parsing, case-insensitive name deduplication, and sorting unchanged. Do
not add source labels or UI state.

- [ ] **Step 5: Run discovery tests and confirm they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/skill-discovery.test.ts
```

Expected: PASS for every test in `skill-discovery.test.ts`, including combined
results, repository precedence, `.system` exclusion, quoted paths, missing
global roots, and side-channel framing.

- [ ] **Step 6: Commit the discovery behavior**

```bash
git add apps/mobile/src/lib/skill-discovery.ts apps/mobile/test/integration/skill-discovery.test.ts
git commit -m "Show global skills in mobile selector"
```

### Task 2: Invalidate Repo-Only Skill Caches

**Files:**

- Modify: `apps/mobile/test/integration/skill-discovery-cache.test.ts`
- Modify: `apps/mobile/src/lib/skill-discovery-cache.ts`

**Interfaces:**

- Consumes: `SKILL_DISCOVERY_CACHE_VERSION`,
  `buildSkillDiscoveryCacheKey(parts)`, and
  `createSkillDiscoveryCache({ storage, now? })`.
- Produces: version 2 `SkillDiscoveryCacheRecord` values and
  `skillDiscoveryCache.v2.*` storage keys; public function signatures remain
  unchanged.

- [ ] **Step 1: Write failing cache-migration assertions**

In the existing key test, change the literal namespace expectation from `v1` to
`v2`:

```ts
assert.equal(
	buildSkillDiscoveryCacheKey(keyParts),
	[
		'skillDiscoveryCache',
		'v2',
		'connection%2E1',
		'session%3A1%2E2',
		'%2Fhome%2Fmuly%2Ffressh%20app',
	].join('.'),
);
```

Add this test after the existing write/read test:

```ts
void test('version 1 cache records are rejected after global discovery migration', () => {
	const key = [
		'skillDiscoveryCache',
		'v2',
		'connection%2E1',
		'session%3A1%2E2',
		'%2Fhome%2Fmuly%2Ffressh%20app',
	].join('.');
	const { entries, storage } = createMemoryStorage({
		[key]: JSON.stringify({
			version: 1,
			...keyParts,
			projectName: 'fressh app',
			skills: [],
			updatedAt: '2026-05-26T12:00:00.000Z',
		}),
	});
	const cache = createSkillDiscoveryCache({ storage });

	assert.equal(cache.read(keyParts), null);
	assert.equal(entries.has(key), false);
});
```

- [ ] **Step 2: Run the cache test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/skill-discovery-cache.test.ts
```

Expected: FAIL because the key is still `skillDiscoveryCache.v1.*`; the v2
assertion fails and the seeded v2 record is not deleted.

- [ ] **Step 3: Implement cache version 2**

In `apps/mobile/src/lib/skill-discovery-cache.ts`, change the version constant
and derive the namespace from it:

```ts
export const SKILL_DISCOVERY_CACHE_VERSION = 2;
```

```ts
return [
	'skillDiscoveryCache',
	`v${SKILL_DISCOVERY_CACHE_VERSION}`,
	encodeSkillDiscoveryCacheKeyPart(parts.stableConnectionId),
	encodeSkillDiscoveryCacheKeyPart(parts.tmuxTarget),
	encodeSkillDiscoveryCacheKeyPart(parts.projectRoot),
].join('.');
```

Keep parsing strict: `parsed.version !== SKILL_DISCOVERY_CACHE_VERSION` must
continue returning `null`, and `read` must continue deleting an invalid record
at the current key.

- [ ] **Step 4: Run cache and loader tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/skill-discovery-cache.test.ts test/integration/skill-selector-loader.test.ts
```

Expected: PASS. Cache records use version 2, v1 payloads at the v2 key are
rejected and deleted, and the loader continues to cache and refresh combined
discovery without API changes.

- [ ] **Step 5: Commit the cache migration**

```bash
git add apps/mobile/src/lib/skill-discovery-cache.ts apps/mobile/test/integration/skill-discovery-cache.test.ts
git commit -m "Invalidate repo-only skill caches"
```

### Task 3: Validate and Deliver the Mobile Fix

**Files:**

- Verify: `apps/mobile/src/lib/skill-discovery.ts`
- Verify: `apps/mobile/src/lib/skill-discovery-cache.ts`
- Verify: `apps/mobile/test/integration/skill-discovery.test.ts`
- Verify: `apps/mobile/test/integration/skill-discovery-cache.test.ts`

**Interfaces:**

- Consumes: the combined discovery command and v2 cache from Tasks 1 and 2.
- Produces: a CI-validated JavaScript update on the `preview` channel and
  on-device confirmation in workspace F3.

- [ ] **Step 1: Run all mobile integration tests**

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: exit code 0 with all mobile Node integration tests passing. Do not
substitute `test:e2e:clear-state`.

- [ ] **Step 2: Run focused static checks**

```bash
pnpm --filter @fressh/mobile fmt:check
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile typecheck
```

Expected: all three commands exit 0 with no formatting, ESLint, or TypeScript
errors.

- [ ] **Step 3: Run the repository CI-safe lint gate**

```bash
pnpm exec turbo lint:check
```

Expected: exit code 0 across the workspace, including root formatting,
dependency checks, duplicate-code checks, mobile lint, and mobile type checking.

- [ ] **Step 4: Inspect the final diff and history**

```bash
git diff --check
git status --short
git log -4 --oneline
```

Expected: `git diff --check` has no output; `git status --short` is empty; the
history contains the design commit, plan commit, and two focused implementation
commits.

- [ ] **Step 5: Fast-forward and push the validated `dev` branch**

```bash
git branch --show-current
git -C /home/muly/code/fressh status --short
git -C /home/muly/code/fressh merge --ff-only fix/mobile-global-skill-discovery
git -C /home/muly/code/fressh push origin dev
```

Expected: the branch command prints `fix/mobile-global-skill-discovery`, the
primary `dev` checkout is clean, the fast-forward succeeds, and the push
advances `origin/dev` with the design, plan, and implementation commits. Stop
instead of merging if either branch or checkout does not match these
expectations.

- [ ] **Step 6: Publish the JavaScript change to preview**

```bash
cd apps/mobile
pnpm exec eas update --channel preview --message "Show global skills in mobile selector"
```

Expected: EAS reports a successful update for the preview channel. No local
native build, Metro session, shell-config reload, uninstall, or app-data clear
is needed.

- [ ] **Step 7: Verify the original F3 reproduction on-device**

Open the preview app, allow it to load the update, switch to workspace F3, and
tap `$`.

Expected:

- The selector performs a fresh load rather than showing a version 1 cached
  list.
- Repository-local skills appear.
- Direct user-installed skills from `~/.codex/skills` appear.
- A duplicated skill name shows the repository description/path behavior, not
  the global duplicate.
- Bundled `.system` and plugin-only skills do not appear.
- Selecting an entry inserts `$skill-name ` without Enter.

Capture a screenshot and a UI hierarchy dump for the completion evidence without
clearing application data:

```bash
adb exec-out screencap -p > /tmp/fressh-global-skills.png
adb shell uiautomator dump /sdcard/fressh-global-skills.xml
adb pull /sdcard/fressh-global-skills.xml /tmp/fressh-global-skills.xml
```

Expected: all commands exit 0 and both local artifacts exist.
