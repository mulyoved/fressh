# Mobile Detected Open Native Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fressh mobile `Browser -> Open` and `Browser -> Pick` open detected URLs/files through Android by using URL-returning `mdev` commands and a native picker.

**Architecture:** Add a backward-compatible `--print-url` mode to remote `mdev open` so mobile can request a plain final URL instead of terminal OSC output. Fressh keeps pane-context resolution in the existing Browser action controller, uses `mdev open detect --json` for candidate discovery, renders candidates in a native modal, and opens the final returned URL with the existing Android `Linking.openURL` path.

**Tech Stack:** Bun TypeScript CLI in `/home/muly/skills/dev-env/mdev`; Expo React Native app in `/home/muly/fressh/apps/mobile`; Node `tsx --test` integration tests; React Native `Modal`, `Pressable`, and existing theme helpers.

---

## Scope Check

This plan touches two repositories, but the work is one feature contract:

- `/home/muly/skills`: add URL-returning `mdev open` CLI behavior.
- `/home/muly/fressh`: consume that behavior in mobile and add a native picker.

The `mdev` update is testable on its own and remains backward-compatible. The Fressh update depends on that contract, so the tasks are sequential.

## File Structure

- `/home/muly/skills/dev-env/mdev/src/commands/open.ts`
  - Owns `mdev open` argument parsing and command behavior.
  - Add `--print-url` for `auto` and `bridge`; keep `pick` and `--emit` unchanged.
- `/home/muly/skills/dev-env/mdev/test/open-command.test.ts`
  - Covers URL printing, OSC compatibility, and invalid flag combinations.
- `/home/muly/fressh/apps/mobile/src/lib/host-browser-actions.ts`
  - Owns shell command builders and low-level parsing/validation helpers for host browser actions.
  - Add detected-open command builders, candidate types, candidate JSON parser, and final URL parser.
- `/home/muly/fressh/apps/mobile/test/integration/host-browser-actions.test.ts`
  - Covers command quoting, candidate parsing, and URL output validation.
- `/home/muly/fressh/apps/mobile/src/lib/detected-open-actions.ts`
  - Owns pure detected-open request state and async control flow.
  - Update `Open` to call `openUrl`; update `Pick` to request native picker state instead of assuming `mdev` opens the browser.
- `/home/muly/fressh/apps/mobile/test/integration/detected-open-actions.test.ts`
  - Covers Open command execution, URL opening, Pick candidate loading, stale requests, and failures.
- `/home/muly/fressh/apps/mobile/src/app/shell/components/DetectedOpenPickerModal.tsx`
  - New focused native picker UI.
- `/home/muly/fressh/apps/mobile/src/app/shell/components/detected-open-picker-modal-controller.ts`
  - New tiny controller for row press/close behavior.
- `/home/muly/fressh/apps/mobile/test/integration/detected-open-picker-modal-controller.test.ts`
  - Covers picker controller behavior without rendering React Native.
- `/home/muly/fressh/apps/mobile/src/lib/shell-modals.tsx`
  - Owns Browser action controller state and props.
  - Add detected picker state, bridge selection handler, and cleanup.
- `/home/muly/fressh/apps/mobile/src/app/shell/detail.tsx`
  - Renders the new `DetectedOpenPickerModal` beside the existing Browser and Host URL modals.

## Task 1: Add `mdev open --print-url`

**Files:**
- Modify: `/home/muly/skills/dev-env/mdev/src/commands/open.ts`
- Test: `/home/muly/skills/dev-env/mdev/test/open-command.test.ts`

- [ ] **Step 1: Write failing `mdev` tests for URL-printing commands**

In `/home/muly/skills/dev-env/mdev/test/open-command.test.ts`, add these tests inside `describe("open command emission", () => { ... })`, near the existing `bridge prints final URL by default and emits when requested` and `auto opens the first detected candidate` tests:

```ts
  test("bridge --print-url prints final URL without OSC", async () => {
    const io = fakeIo({ TMUX_PANE_PATH: process.cwd() });

    await runOpenCommand(["bridge", "https://example.test/app", "--print-url"], io, {
      bridgeCandidate: async (candidate) => ({
        url: candidate.normalized,
        served: false,
        port: null,
        serveTarget: null,
      }),
    });

    expect(io.stdout).toBe("https://example.test/app\n");
  });

  test("auto --print-url prints the selected final URL without OSC", async () => {
    const io = fakeIo({ TMUX_PANE: "%7", TMUX_PANE_PATH: process.cwd() });

    await runOpenCommand(["auto", "--print-url"], io, {
      tmux: async () => ({
        exitCode: 0,
        stdout: "older https://example.test/old\nnewer https://example.test/new\n",
        stderr: "",
      }),
      bridgeCandidate: async (candidate) => ({
        url: candidate.normalized,
        served: false,
        port: null,
        serveTarget: null,
      }),
    });

    expect(io.stdout).toBe("https://example.test/new\n");
  });

  test("auto without --print-url still emits OSC", async () => {
    const io = fakeIo({ TMUX_PANE: "%7", TMUX_PANE_PATH: process.cwd() });

    await runOpenCommand(["auto"], io, {
      tmux: async () => ({
        exitCode: 0,
        stdout: "newer https://example.test/new\n",
        stderr: "",
      }),
      bridgeCandidate: async (candidate) => ({
        url: candidate.normalized,
        served: false,
        port: null,
        serveTarget: null,
      }),
    });

    expect(io.stdout).toBe(tmuxSetUserVar("tmux_open_url", "https://example.test/new"));
  });

  test("open bridge rejects --emit and --print-url together", async () => {
    const io = fakeIo({ TMUX_PANE: "%7", TMUX_PANE_PATH: process.cwd() });
    const result = await runOpenCommand(
      ["bridge", "https://example.test/app", "--emit", "--print-url"],
      io,
    ).catch((error) => handleCliError(error, io));

    expect(result).toBe(64);
    expect(io.stderr).toContain("Use only one of --emit or --print-url");
  });
```

- [ ] **Step 2: Run the new `mdev` tests and verify they fail**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/open-command.test.ts
```

Expected: FAIL. The `auto --print-url` test should fail with an unexpected argument error, and the bridge conflict test should fail because the conflict is not rejected yet.

- [ ] **Step 3: Add `--print-url` parsing and output behavior**

In `/home/muly/skills/dev-env/mdev/src/commands/open.ts`, add this helper near `openUsage()`:

```ts
function parseOpenOutputFlags(argv: string[], usage: string): { emit: boolean; printUrl: boolean; values: string[] } {
  const emit = argv.includes("--emit");
  const printUrl = argv.includes("--print-url");
  if (emit && printUrl) throw new CliError("Use only one of --emit or --print-url", 64);

  const values = argv.filter((arg) => arg !== "--emit" && arg !== "--print-url");
  const unexpectedFlag = values.find((arg) => arg.startsWith("--"));
  if (unexpectedFlag) throw new CliError(`Unexpected ${usage} argument: ${unexpectedFlag}`, 64);

  return { emit, printUrl, values };
}

function writeOpenUrl(url: string, io: CliIo, printUrl: boolean): void {
  if (printUrl) {
    io.writeStdout(`${url}\n`);
    return;
  }
  emitOpenUrl(url, io);
}
```

Update `openUsage()` so it returns this exact list:

```ts
function openUsage(): string {
  return [
    "Usage:",
    "  mdev open auto [--print-url]",
    "  mdev open pick",
    "  mdev open detect [--json]",
    "  mdev open bridge <candidate> [--emit|--print-url]",
    "",
  ].join("\n");
}
```

Replace `runAuto` with:

```ts
async function runAuto(argv: string[], io: CliIo, deps: OpenCommandDeps): Promise<number> {
  const { printUrl, values } = parseOpenOutputFlags(argv, "open auto");
  if (values.length > 0) throw new CliError(`Unexpected open auto argument: ${values[0]}`, 64);

  const candidates = await detectFromPane(io, deps.tmux ?? runTmux);
  const candidate = candidates.find((item) => item.kind !== "file") ?? candidates[0];
  if (!candidate) throw new CliError("No openable URL or file found in tmux pane", 1);

  const bridge = deps.bridgeCandidate ?? bridgeOpenCandidate;
  const result = await bridge(candidate);
  writeOpenUrl(result.url, io, printUrl);
  return 0;
}
```

Replace `runBridge` with:

```ts
async function runBridge(argv: string[], io: CliIo, deps: OpenCommandDeps): Promise<number> {
  const { emit, printUrl, values } = parseOpenOutputFlags(argv, "open bridge");
  const value = values[0];

  if (!value) throw new CliError("Usage: mdev open bridge <candidate> [--emit|--print-url]", 64);
  if (values.length > 1) throw new CliError(`Unexpected open bridge argument: ${values[1]}`, 64);

  const candidates = await detectOpenCandidates(value, paneCwd(io));
  const candidate = candidates[0];
  if (!candidate) throw new CliError(`No openable URL or file found in candidate: ${value}`, 1);

  const bridge = deps.bridgeCandidate ?? bridgeOpenCandidate;
  const result = await bridge(candidate);
  if (emit) emitOpenUrl(result.url, io);
  else io.writeStdout(`${result.url}\n`);
  return 0;
}
```

This keeps legacy `bridge <candidate>` printing the URL by default, keeps `--emit` OSC, and makes `--print-url` explicit for mobile.

- [ ] **Step 4: Update the existing argument-error expected message**

In `/home/muly/skills/dev-env/mdev/test/open-command.test.ts`, update the existing `reports open command argument errors clearly` case for missing `bridge` args:

```ts
{ argv: ["bridge"], message: "Usage: mdev open bridge <candidate> [--emit|--print-url]", exitCode: 64 },
```

- [ ] **Step 5: Run `mdev` tests**

Run:

```bash
cd /home/muly/skills/dev-env/mdev
bun test test/open-command.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the `mdev` contract**

Run:

```bash
cd /home/muly/skills
git status --short
git add dev-env/mdev/src/commands/open.ts dev-env/mdev/test/open-command.test.ts
git commit -m "feat: print mdev open URLs for mobile"
```

Expected: commit succeeds in `/home/muly/skills`.

## Task 2: Add Fressh Command Builders And Parsers

**Files:**
- Modify: `/home/muly/fressh/apps/mobile/src/lib/host-browser-actions.ts`
- Test: `/home/muly/fressh/apps/mobile/test/integration/host-browser-actions.test.ts`

- [ ] **Step 1: Write failing host-browser helper tests**

In `/home/muly/fressh/apps/mobile/test/integration/host-browser-actions.test.ts`, add these imports:

```ts
	buildMdevOpenAutoPrintUrlCommand,
	buildMdevOpenBridgePrintUrlCommand,
	buildMdevOpenDetectJsonCommand,
	parseDetectedOpenCandidates,
	parsePrintedOpenUrl,
```

Add these tests after `mdev open command shell-quotes pane context values`:

```ts
void test('mdev open print-url command builders shell-quote pane context and candidates', () => {
	const context = {
		paneId: '%12',
		paneTty: '/dev/pts/7',
		panePath: "/home/muly/work repo's",
	};

	assert.equal(
		buildMdevOpenAutoPrintUrlCommand(context),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open auto --print-url",
	);
	assert.equal(
		buildMdevOpenDetectJsonCommand(context),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open detect --json",
	);
	assert.equal(
		buildMdevOpenBridgePrintUrlCommand(context, "https://example.test/app's"),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open bridge 'https://example.test/app'\\''s' --print-url",
	);
});

void test('parsePrintedOpenUrl accepts a single http or https URL', () => {
	assert.deepEqual(parsePrintedOpenUrl(' https://example.test/app\\n'), {
		type: 'valid',
		url: 'https://example.test/app',
	});
	assert.deepEqual(parsePrintedOpenUrl('http://localhost:3000/path'), {
		type: 'valid',
		url: 'http://localhost:3000/path',
	});
	assert.deepEqual(parsePrintedOpenUrl(''), {
		type: 'invalid',
		message: 'mdev open did not return a URL.',
	});
	assert.deepEqual(parsePrintedOpenUrl('not a url'), {
		type: 'invalid',
		message: 'mdev open returned an invalid URL.',
	});
	assert.deepEqual(parsePrintedOpenUrl('ftp://example.test'), {
		type: 'invalid',
		message: 'mdev open returned a non-http URL.',
	});
});

void test('parseDetectedOpenCandidates validates mdev open detect JSON', () => {
	const output = JSON.stringify([
		{
			kind: 'remote-url',
			raw: 'https://example.test/app',
			normalized: 'https://example.test/app',
			display: 'https://example.test/app',
			sourceLine: 1,
			sourceColumn: 6,
			path: null,
			line: null,
			url: 'https://example.test/app',
		},
	]);

	assert.deepEqual(parseDetectedOpenCandidates(output), {
		type: 'valid',
		candidates: [
			{
				kind: 'remote-url',
				raw: 'https://example.test/app',
				normalized: 'https://example.test/app',
				display: 'https://example.test/app',
				path: null,
				line: null,
				url: 'https://example.test/app',
			},
		],
	});
	assert.deepEqual(parseDetectedOpenCandidates(''), {
		type: 'invalid',
		message: 'mdev open detect did not return JSON.',
	});
	assert.deepEqual(parseDetectedOpenCandidates('{bad json'), {
		type: 'invalid',
		message: 'mdev open detect returned invalid JSON.',
	});
	assert.deepEqual(parseDetectedOpenCandidates('{}'), {
		type: 'invalid',
		message: 'mdev open detect returned an unexpected payload.',
	});
	assert.deepEqual(
		parseDetectedOpenCandidates(JSON.stringify([{ kind: 'other', raw: 'x', normalized: 'x', display: 'x' }])),
		{
			type: 'invalid',
			message: 'mdev open detect returned an invalid candidate.',
		},
	);
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/host-browser-actions.test.ts
```

Expected: FAIL with missing exported helper names.

- [ ] **Step 3: Implement command builders and parsers**

In `/home/muly/fressh/apps/mobile/src/lib/host-browser-actions.ts`, add these types after `TmuxPaneContext`:

```ts
export type DetectedOpenCandidateKind = 'remote-url' | 'local-url' | 'file';

export type DetectedOpenCandidate = {
	kind: DetectedOpenCandidateKind;
	raw: string;
	normalized: string;
	display: string;
	path: string | null;
	line: number | null;
	url: string | null;
};

export type ParsedDetectedOpenCandidates =
	| { type: 'invalid'; message: string }
	| { type: 'valid'; candidates: DetectedOpenCandidate[] };

export type ParsedPrintedOpenUrl =
	| { type: 'invalid'; message: string }
	| { type: 'valid'; url: string };
```

Add this helper near `quoteShell`:

```ts
function formatMdevOpenEnv(context: TmuxPaneContext): string {
	return [
		`TMUX_PANE=${quoteShell(context.paneId)}`,
		`TMUX_PANE_TTY=${quoteShell(context.paneTty)}`,
		`TMUX_PANE_PATH=${quoteShell(context.panePath)}`,
	].join(' ');
}
```

Replace `buildMdevOpenCommand` with this version and add the new builders directly below it:

```ts
export function buildMdevOpenCommand(
	mode: HostBrowserOpenMode,
	context: TmuxPaneContext,
): string {
	return [formatMdevOpenEnv(context), 'mdev', 'open', mode].join(' ');
}

export function buildMdevOpenAutoPrintUrlCommand(
	context: TmuxPaneContext,
): string {
	return [formatMdevOpenEnv(context), 'mdev', 'open', 'auto', '--print-url'].join(
		' ',
	);
}

export function buildMdevOpenDetectJsonCommand(
	context: TmuxPaneContext,
): string {
	return [formatMdevOpenEnv(context), 'mdev', 'open', 'detect', '--json'].join(
		' ',
	);
}

export function buildMdevOpenBridgePrintUrlCommand(
	context: TmuxPaneContext,
	candidateRaw: string,
): string {
	return [
		formatMdevOpenEnv(context),
		'mdev',
		'open',
		'bridge',
		quoteShell(candidateRaw),
		'--print-url',
	].join(' ');
}
```

Add these parser functions at the end of the file:

```ts
export function parsePrintedOpenUrl(output: string): ParsedPrintedOpenUrl {
	const trimmed = output.trim();
	if (!trimmed) {
		return { type: 'invalid', message: 'mdev open did not return a URL.' };
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { type: 'invalid', message: 'mdev open returned an invalid URL.' };
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { type: 'invalid', message: 'mdev open returned a non-http URL.' };
	}
	return { type: 'valid', url: parsed.href };
}

export function parseDetectedOpenCandidates(
	output: string,
): ParsedDetectedOpenCandidates {
	if (!output.trim()) {
		return {
			type: 'invalid',
			message: 'mdev open detect did not return JSON.',
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return {
			type: 'invalid',
			message: 'mdev open detect returned invalid JSON.',
		};
	}
	if (!Array.isArray(parsed)) {
		return {
			type: 'invalid',
			message: 'mdev open detect returned an unexpected payload.',
		};
	}
	const candidates: DetectedOpenCandidate[] = [];
	for (const item of parsed) {
		const candidate = parseDetectedOpenCandidate(item);
		if (!candidate) {
			return {
				type: 'invalid',
				message: 'mdev open detect returned an invalid candidate.',
			};
		}
		candidates.push(candidate);
	}
	return { type: 'valid', candidates };
}

function parseDetectedOpenCandidate(value: unknown): DetectedOpenCandidate | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (
		record.kind !== 'remote-url' &&
		record.kind !== 'local-url' &&
		record.kind !== 'file'
	) {
		return null;
	}
	if (
		typeof record.raw !== 'string' ||
		typeof record.normalized !== 'string' ||
		typeof record.display !== 'string'
	) {
		return null;
	}
	if (record.path !== null && typeof record.path !== 'string') return null;
	if (record.line !== null && typeof record.line !== 'number') return null;
	if (record.url !== null && typeof record.url !== 'string') return null;
	return {
		kind: record.kind,
		raw: record.raw,
		normalized: record.normalized,
		display: record.display,
		path: record.path,
		line: record.line,
		url: record.url,
	};
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper work**

Run:

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "feat(mobile): add detected open URL helpers"
```

Expected: commit succeeds in `/home/muly/fressh`.

## Task 3: Update Detected-Open Controller Logic

**Files:**
- Modify: `/home/muly/fressh/apps/mobile/src/lib/detected-open-actions.ts`
- Test: `/home/muly/fressh/apps/mobile/test/integration/detected-open-actions.test.ts`

- [ ] **Step 1: Remove temporary debug instrumentation from `detected-open-actions.ts`**

In `/home/muly/fressh/apps/mobile/src/lib/detected-open-actions.ts`, remove every `// #region debug log` block and its matching `// #endregion`. After cleanup, the `try` block inside `runDetectedOpenControllerRequest` starts like this:

```ts
		try {
			context = await resolvePaneContext();
			command = buildMdevOpenCommand(mode, context);
			if (!requestId.isCurrent(id)) return;
			await runHostBrowserCommand(command, getDetectedOpenTimeoutMs(mode));
		} catch (err) {
```

This establishes a clean baseline before changing behavior.

- [ ] **Step 2: Write failing controller tests for Open URL ownership and Pick candidate loading**

Update the imports in `/home/muly/fressh/apps/mobile/test/integration/detected-open-actions.test.ts`:

```ts
import {
	DETECTED_OPEN_SHORTCUTS,
	finishDetectedOpenRequest,
	getDetectedOpenTimeoutMs,
	planDetectedOpenShortcutPress,
	resolveDetectedOpenShortcutMode,
	runDetectedOpenCallback,
	runDetectedOpenControllerRequest,
	runDetectedOpenPickerSelectionRequest,
	tryBeginDetectedOpenRequest,
	type DetectedOpenCandidate,
} from '../../src/lib/detected-open-actions';
```

Remove the two existing tests named:

- `detected open command runs auto mode with pane context`
- `detected open command runs pick mode with pane context`

Replace the existing `detected open controller starts accepted request and clears in-flight state` test with:

```ts
void test('detected open controller opens printed URL for auto mode', async () => {
	const inFlightRef = { current: false };
	const openStates: boolean[] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const openedUrls: string[] = [];
	const errors: string[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: (open) => {
			openStates.push(open);
		},
		setPickerCandidates: () => {
			throw new Error('setPickerCandidates should not run for auto');
		},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		showErrorReport: (report) => {
			errors.push(`${report.title}: ${report.message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'https://example.test/open\n';
		},
		openUrl: async (url) => {
			openedUrls.push(url);
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(openStates, [false]);
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, []);
	assert.deepEqual(openedUrls, ['https://example.test/open']);
	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto --print-url",
			timeoutMs: 30_000,
		},
	]);
});

void test('detected open controller loads native picker candidates for pick mode', async () => {
	const inFlightRef = { current: false };
	const pickerCandidates: DetectedOpenCandidate[][] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'pick',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: () => {},
		setPickerCandidates: (candidates) => {
			pickerCandidates.push(candidates);
		},
		showError: () => {
			throw new Error('showError should not run');
		},
		showErrorReport: () => {
			throw new Error('showErrorReport should not run');
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return JSON.stringify([
				{
					kind: 'remote-url',
					raw: 'https://example.test/pick',
					normalized: 'https://example.test/pick',
					display: 'https://example.test/pick',
					sourceLine: 1,
					sourceColumn: 1,
					path: null,
					line: null,
					url: 'https://example.test/pick',
				},
			]);
		},
		openUrl: async () => {
			throw new Error('openUrl should not run before selection');
		},
	});

	assert.equal(result.accepted, true);
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open detect --json",
			timeoutMs: 60_000,
		},
	]);
	assert.deepEqual(pickerCandidates, [
		[
			{
				kind: 'remote-url',
				raw: 'https://example.test/pick',
				normalized: 'https://example.test/pick',
				display: 'https://example.test/pick',
				path: null,
				line: null,
				url: 'https://example.test/pick',
			},
		],
	]);
});
```

Add this picker selection test near the other controller tests:

```ts
void test('detected open picker selection bridges candidate and opens returned URL', async () => {
	const commands: { command: string; timeoutMs: number }[] = [];
	const openedUrls: string[] = [];
	const candidate: DetectedOpenCandidate = {
		kind: 'remote-url',
		raw: "https://example.test/pick's",
		normalized: "https://example.test/pick's",
		display: "https://example.test/pick's",
		path: null,
		line: null,
		url: "https://example.test/pick's",
	};

	await runDetectedOpenPickerSelectionRequest({
		candidate,
		context: {
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		},
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return 'https://example.test/final\n';
		},
		openUrl: async (url) => {
			openedUrls.push(url);
		},
	});

	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open bridge 'https://example.test/pick'\\''s' --print-url",
			timeoutMs: 60_000,
		},
	]);
	assert.deepEqual(openedUrls, ['https://example.test/final']);
});
```

- [ ] **Step 3: Run controller tests and verify they fail**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/detected-open-actions.test.ts
```

Expected: FAIL with missing `setPickerCandidates`, `openUrl`, `runDetectedOpenPickerSelectionRequest`, and changed command strings.

- [ ] **Step 4: Update detected-open controller implementation**

In `/home/muly/fressh/apps/mobile/src/lib/detected-open-actions.ts`, replace the import with:

```ts
import {
	buildMdevOpenAutoPrintUrlCommand,
	buildMdevOpenBridgePrintUrlCommand,
	buildMdevOpenDetectJsonCommand,
	parseDetectedOpenCandidates,
	parsePrintedOpenUrl,
	type DetectedOpenCandidate,
	type TmuxPaneContext,
} from '@/lib/host-browser-actions';
```

Add this export after the shortcut constants:

```ts
export type { DetectedOpenCandidate };
```

Update `RunDetectedOpenControllerRequestDeps`:

```ts
export type RunDetectedOpenControllerRequestDeps = {
	mode: HostBrowserOpenMode;
	resolvePaneContext: () => Promise<TmuxPaneContext>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
	openUrl: (url: string) => Promise<void>;
	setPickerCandidates: (
		candidates: DetectedOpenCandidate[],
		context: TmuxPaneContext,
	) => void;
	inFlightRef: DetectedOpenInFlightRef;
	requestId: DetectedOpenRequestId;
	setOpen: (open: boolean) => void;
	showError: (title: string, message: string) => void;
	showErrorReport?: (report: DetectedOpenErrorReport) => void;
	getErrorMessage: (error: unknown) => string;
};
```

Delete the old `runDetectedOpenCommand` export. Replace it with:

```ts
export async function runDetectedOpenPickerSelectionRequest({
	candidate,
	context,
	runHostBrowserCommand,
	openUrl,
}: {
	candidate: DetectedOpenCandidate;
	context: TmuxPaneContext;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
	openUrl: (url: string) => Promise<void>;
}): Promise<void> {
	const output = await runHostBrowserCommand(
		buildMdevOpenBridgePrintUrlCommand(context, candidate.raw),
		getDetectedOpenTimeoutMs('pick'),
	);
	const parsed = parsePrintedOpenUrl(output);
	if (parsed.type === 'invalid') throw new Error(parsed.message);
	await openUrl(parsed.url);
}
```

In `runDetectedOpenControllerRequest`, destructure `openUrl` and `setPickerCandidates`, then replace the async `try` body with:

```ts
		try {
			context = await resolvePaneContext();
			command =
				mode === 'pick'
					? buildMdevOpenDetectJsonCommand(context)
					: buildMdevOpenAutoPrintUrlCommand(context);
			if (!requestId.isCurrent(id)) return;
			const output = await runHostBrowserCommand(
				command,
				getDetectedOpenTimeoutMs(mode),
			);
			if (!requestId.isCurrent(id)) return;
			if (mode === 'pick') {
				const parsed = parseDetectedOpenCandidates(output);
				if (parsed.type === 'invalid') throw new Error(parsed.message);
				if (parsed.candidates.length === 0) {
					throw new Error('No openable URL or file found in tmux pane');
				}
				setPickerCandidates(parsed.candidates, context);
				return;
			}
			const parsed = parsePrintedOpenUrl(output);
			if (parsed.type === 'invalid') throw new Error(parsed.message);
			await openUrl(parsed.url);
		} catch (err) {
```

- [ ] **Step 5: Update expected failure command strings in existing tests**

In the existing `detected open controller reports mode-specific failures and clears in-flight state` test, update expected commands:

```ts
expectedCommand:
	"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto --print-url",
```

and:

```ts
expectedCommand:
	"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open detect --json",
```

Also add `setPickerCandidates` and `openUrl` callbacks to every `runDetectedOpenControllerRequest` call in the test file. For tests where they should not run, use:

```ts
setPickerCandidates: () => {
	throw new Error('setPickerCandidates should not run');
},
openUrl: async () => {
	throw new Error('openUrl should not run');
},
```

- [ ] **Step 6: Run controller tests**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/detected-open-actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit controller work**

Run:

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/detected-open-actions.ts apps/mobile/test/integration/detected-open-actions.test.ts
git commit -m "feat(mobile): own detected open URL handling"
```

Expected: commit succeeds.

## Task 4: Add Native Detected-Open Picker Modal

**Files:**
- Create: `/home/muly/fressh/apps/mobile/src/app/shell/components/detected-open-picker-modal-controller.ts`
- Create: `/home/muly/fressh/apps/mobile/src/app/shell/components/DetectedOpenPickerModal.tsx`
- Test: `/home/muly/fressh/apps/mobile/test/integration/detected-open-picker-modal-controller.test.ts`

- [ ] **Step 1: Write failing picker controller tests**

Create `/home/muly/fressh/apps/mobile/test/integration/detected-open-picker-modal-controller.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	getDetectedOpenCandidateSubtitle,
	handleDetectedOpenPickerClose,
	handleDetectedOpenPickerSelect,
} from '../../src/app/shell/components/detected-open-picker-modal-controller';
import { type DetectedOpenCandidate } from '../../src/lib/detected-open-actions';

const remoteCandidate: DetectedOpenCandidate = {
	kind: 'remote-url',
	raw: 'https://example.test/app',
	normalized: 'https://example.test/app',
	display: 'https://example.test/app',
	path: null,
	line: null,
	url: 'https://example.test/app',
};

void test('detected open picker select closes then selects candidate', () => {
	const calls: string[] = [];

	handleDetectedOpenPickerSelect({
		candidate: remoteCandidate,
		onClose: () => calls.push('close'),
		onSelect: (candidate) => calls.push(`select:${candidate.raw}`),
	});

	assert.deepEqual(calls, ['close', 'select:https://example.test/app']);
});

void test('detected open picker close calls onClose once', () => {
	const calls: string[] = [];

	handleDetectedOpenPickerClose({
		onClose: () => calls.push('close'),
	});

	assert.deepEqual(calls, ['close']);
});

void test('detected open picker candidate subtitles match candidate kind', () => {
	assert.equal(getDetectedOpenCandidateSubtitle(remoteCandidate), 'remote-url');
	assert.equal(
		getDetectedOpenCandidateSubtitle({
			...remoteCandidate,
			kind: 'local-url',
			raw: 'localhost:3000',
			display: 'localhost:3000',
		}),
		'local-url',
	);
	assert.equal(
		getDetectedOpenCandidateSubtitle({
			...remoteCandidate,
			kind: 'file',
			raw: 'README.md',
			display: 'README.md',
			path: '/tmp/project/README.md',
			url: null,
		}),
		'file',
	);
});
```

- [ ] **Step 2: Run picker controller tests and verify they fail**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/detected-open-picker-modal-controller.test.ts
```

Expected: FAIL with missing module.

- [ ] **Step 3: Create picker controller**

Create `/home/muly/fressh/apps/mobile/src/app/shell/components/detected-open-picker-modal-controller.ts`:

```ts
import { type DetectedOpenCandidate } from '@/lib/detected-open-actions';

export function handleDetectedOpenPickerSelect({
	candidate,
	onClose,
	onSelect,
}: {
	candidate: DetectedOpenCandidate;
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
}) {
	onClose();
	onSelect(candidate);
}

export function handleDetectedOpenPickerClose({
	onClose,
}: {
	onClose: () => void;
}) {
	onClose();
}

export function getDetectedOpenCandidateSubtitle(
	candidate: DetectedOpenCandidate,
): string {
	return candidate.kind;
}
```

- [ ] **Step 4: Create picker modal component**

Create `/home/muly/fressh/apps/mobile/src/app/shell/components/DetectedOpenPickerModal.tsx`:

```tsx
import React, { useCallback } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { type DetectedOpenCandidate } from '@/lib/detected-open-actions';
import { useTheme } from '@/lib/theme';
import {
	getDetectedOpenCandidateSubtitle,
	handleDetectedOpenPickerClose,
	handleDetectedOpenPickerSelect,
} from './detected-open-picker-modal-controller';

export function DetectedOpenPickerModal({
	open,
	bottomOffset,
	candidates,
	onClose,
	onSelect,
}: {
	open: boolean;
	bottomOffset: number;
	candidates: readonly DetectedOpenCandidate[];
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
}) {
	const theme = useTheme();
	const close = useCallback(() => {
		handleDetectedOpenPickerClose({ onClose });
	}, [onClose]);
	const select = useCallback(
		(candidate: DetectedOpenCandidate) => {
			handleDetectedOpenPickerSelect({
				candidate,
				onClose,
				onSelect,
			});
		},
		[onClose, onSelect],
	);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={close}
		>
			<Pressable
				onPress={close}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '80%',
						width: '78%',
						maxWidth: 380,
						minWidth: 280,
						marginRight: 8,
						marginBottom: bottomOffset,
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
							}}
						>
							Pick
						</Text>
						<Pressable
							accessibilityRole="button"
							onPress={close}
							style={{
								paddingHorizontal: 10,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
							}}
						>
							<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
						</Pressable>
					</View>

					<ScrollView>
						{candidates.map((candidate, index) => (
							<Pressable
								key={`${candidate.kind}:${candidate.raw}:${index}`}
								accessibilityRole="button"
								onPress={() => select(candidate)}
								style={{
									paddingVertical: 12,
									paddingHorizontal: 12,
									borderRadius: 10,
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.surface,
									marginBottom: 8,
								}}
							>
								<Text
									numberOfLines={2}
									style={{
										color: theme.colors.textPrimary,
										fontSize: 14,
										fontWeight: '600',
									}}
								>
									{candidate.display}
								</Text>
								<Text
									numberOfLines={1}
									style={{
										color: theme.colors.textSecondary,
										fontSize: 12,
										marginTop: 3,
									}}
								>
									{getDetectedOpenCandidateSubtitle(candidate)}
								</Text>
							</Pressable>
						))}
					</ScrollView>
				</View>
			</Pressable>
		</Modal>
	);
}
```

- [ ] **Step 5: Run picker controller tests**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/detected-open-picker-modal-controller.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit picker component**

Run:

```bash
cd /home/muly/fressh
git add apps/mobile/src/app/shell/components/DetectedOpenPickerModal.tsx apps/mobile/src/app/shell/components/detected-open-picker-modal-controller.ts apps/mobile/test/integration/detected-open-picker-modal-controller.test.ts
git commit -m "feat(mobile): add detected open picker modal"
```

Expected: commit succeeds.

## Task 5: Wire Picker State Into Shell Modals

**Files:**
- Modify: `/home/muly/fressh/apps/mobile/src/lib/shell-modals.tsx`
- Modify: `/home/muly/fressh/apps/mobile/src/app/shell/detail.tsx`
- Test: existing focused tests from Tasks 3 and 4 plus mobile typecheck.

- [ ] **Step 1: Remove temporary debug instrumentation from shell modal and host router**

Remove every `// #region debug log` block from:

- `/home/muly/fressh/apps/mobile/src/lib/shell-modals.tsx`
- `/home/muly/fressh/apps/mobile/src/lib/host-command-router.ts`

After cleanup, `openAndroidUrl` in `shell-modals.tsx` must be:

```ts
	const openAndroidUrl = useCallback(
		async (url: string) => {
			try {
				await Linking.openURL(url);
			} catch (error) {
				throw new Error(
					`Android could not open ${url}: ${getErrorMessage(error)}`,
				);
			}
		},
		[getErrorMessage],
	);
```

After cleanup, `runHostCommandWithBoundary` in `host-command-router.ts` must return the trimmed output directly after the side channel succeeds:

```ts
	if (!result.success) {
		throw new Error(result.error || result.output || 'Remote command failed.');
	}
	return result.output.trim();
```

- [ ] **Step 2: Add shell modal types and state for detected picker**

In `/home/muly/fressh/apps/mobile/src/lib/shell-modals.tsx`, add this import:

```ts
import {
	runDetectedOpenControllerRequest,
	runDetectedOpenPickerSelectionRequest,
	type DetectedOpenCandidate,
} from '@/lib/detected-open-actions';
```

Replace the current `runDetectedOpenControllerRequest` import with the block above.

Add these types after `HostUrlModalProps`:

```ts
export type DetectedOpenPickerModalProps = {
	open: boolean;
	candidates: readonly DetectedOpenCandidate[];
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
};
```

Update `BrowserActionsControllerHandle`:

```ts
export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	detectedOpenPickerProps: DetectedOpenPickerModalProps;
	open: () => void;
	close: () => void;
	resolveHostBrowserPaneContext: () => Promise<TmuxPaneContext>;
	resolveHostBrowserPanePath: () => Promise<string>;
	resolveHostBrowserWorkspace: () => Promise<BrowserActionsWorkspace>;
	resolveCurrentGitHubRepository: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	invalidateHostUrlReads: () => void;
	invalidateAll: () => void;
};
```

Inside `useBrowserActionsController`, add state near `hostUrlModalError`:

```ts
	const [detectedOpenPickerState, setDetectedOpenPickerState] = useState<{
		context: TmuxPaneContext;
		candidates: DetectedOpenCandidate[];
	} | null>(null);
```

- [ ] **Step 3: Wire Pick loading and selection**

In `handleOpenDetected`, add these arguments to `runDetectedOpenControllerRequest`:

```ts
				openUrl: openAndroidUrl,
				setPickerCandidates: (candidates, context) => {
					setDetectedOpenPickerState({ candidates, context });
				},
```

Add `openAndroidUrl` to the `handleOpenDetected` dependency array.

Add these callbacks after `handleOpenDetectedPick`:

```ts
	const handleCloseDetectedOpenPicker = useCallback(() => {
		setDetectedOpenPickerState(null);
	}, []);

	const handleSelectDetectedOpenCandidate = useCallback(
		(candidate: DetectedOpenCandidate) => {
			const state = detectedOpenPickerState;
			if (!state) return;
			setDetectedOpenPickerState(null);
			void runDetectedOpenPickerSelectionRequest({
				candidate,
				context: state.context,
				runHostBrowserCommand,
				openUrl: openAndroidUrl,
			}).catch((error) => {
				showError({
					action: 'Pick',
					title: 'Pick failed',
					message: getErrorMessage(error),
					panePath: state.context.panePath,
				});
			});
		},
		[
			detectedOpenPickerState,
			getErrorMessage,
			openAndroidUrl,
			runHostBrowserCommand,
			showError,
		],
	);
```

In `invalidateAll`, add:

```ts
		setDetectedOpenPickerState(null);
```

Add a memoized prop object before the return:

```ts
	const detectedOpenPickerProps = useMemo<DetectedOpenPickerModalProps>(
		() => ({
			open: detectedOpenPickerState != null,
			candidates: detectedOpenPickerState?.candidates ?? [],
			onClose: handleCloseDetectedOpenPicker,
			onSelect: handleSelectDetectedOpenCandidate,
		}),
		[
			detectedOpenPickerState,
			handleCloseDetectedOpenPicker,
			handleSelectDetectedOpenCandidate,
		],
	);
```

Include `detectedOpenPickerProps` in the returned handle:

```ts
			detectedOpenPickerProps,
```

and include it in the `useMemo` dependency array.

- [ ] **Step 4: Render picker modal in shell detail**

In `/home/muly/fressh/apps/mobile/src/app/shell/detail.tsx`, add this import beside the other shell component imports:

```ts
import { DetectedOpenPickerModal } from './components/DetectedOpenPickerModal';
```

Render it after `BrowserActionsModal`:

```tsx
				<DetectedOpenPickerModal
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					{...browserActions.detectedOpenPickerProps}
				/>
```

- [ ] **Step 5: Run focused shell/modal tests**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration -- test/integration/detected-open-actions.test.ts test/integration/detected-open-picker-modal-controller.test.ts test/integration/host-command-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit shell wiring**

Run:

```bash
cd /home/muly/fressh
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/lib/host-command-router.ts apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): wire detected open native picker"
```

Expected: commit succeeds.

## Task 6: End-To-End Verification And Delivery

**Files:**
- Verify only unless tests expose failures.

- [ ] **Step 1: Run full mobile integration tests**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS.

- [ ] **Step 2: Run Fressh formatting and type checks for touched package**

Run:

```bash
cd /home/muly/fressh
pnpm --filter @fressh/mobile fmt:check
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile typecheck
```

Expected: all PASS. If `fmt:check` fails only due to formatting, run `pnpm --filter @fressh/mobile fmt`, then rerun `fmt:check`, `lint:check`, and `typecheck`.

- [ ] **Step 3: Verify no debug instrumentation remains**

Run:

```bash
cd /home/muly/fressh
rg -n "debug-agent|detected-open-initial|#region debug log|127\\.0\\.0\\.1:36409" apps/mobile/src
```

Expected: no output.

- [ ] **Step 4: Publish remote `mdev` update using the repository's normal process**

Run the repository-specific `mdev` delivery flow from `/home/muly/skills` that is normally used for the remote machine. At minimum, verify the command exists locally:

```bash
cd /home/muly/skills/dev-env/mdev
bun src/cli.ts open --help
```

Expected output contains:

```text
mdev open auto [--print-url]
mdev open bridge <candidate> [--emit|--print-url]
```

- [ ] **Step 5: Publish Fressh preview OTA**

Run:

```bash
cd /home/muly/fressh/apps/mobile
EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas update --channel preview --message "mobile detected open native picker"
```

Expected: EAS publishes an Android update on branch `preview`.

- [ ] **Step 6: Manual verification on Android**

Use the device workflow from `AGENTS.md`:

```bash
adb connect 100.113.210.6:5555
```

If the active transport uses a dynamic port, use `adb devices` and target that serial.

Manual checks:

1. Fully close and reopen Fressh so it loads the preview OTA.
2. Connect to a Workmux-enabled shell that has updated `mdev`.
3. Put `https://example.com` in the visible pane.
4. Tap `Browser -> Open`.
5. Expected: Android opens `https://example.com`.
6. Return to Fressh.
7. Tap `Browser -> Pick`.
8. Expected: Fressh shows a native picker containing `https://example.com`.
9. Select `https://example.com`.
10. Expected: Android opens `https://example.com`.
11. Put `localhost:3000` or another loopback URL in the visible pane.
12. Tap `Browser -> Pick`, select the local URL.
13. Expected: Android opens the final Tailscale Serve HTTPS URL returned by `mdev`.

- [ ] **Step 7: Final status check**

Run:

```bash
cd /home/muly/fressh
git status --short
cd /home/muly/skills
git status --short
```

Expected: only intentional uncommitted release artifacts, if any. No debug instrumentation files remain modified.

## Self-Review Notes

Spec coverage:

- URL-returning `mdev` commands: Task 1.
- Native Fressh picker: Task 4 and Task 5.
- Mobile Open uses `--print-url` and `Linking.openURL`: Task 2, Task 3, Task 5.
- Mobile Pick uses `detect --json`, native picker, `bridge --print-url`, and `Linking.openURL`: Task 2 through Task 5.
- Existing OSC behavior remains: Task 1 tests.
- Temporary debug cleanup: Task 3, Task 5, Task 6.
- Verification and rollout: Task 6.

Completeness scan: every task names concrete files, code snippets, commands, expected results, and commit steps.

Type consistency:

- Candidate type is `DetectedOpenCandidate`.
- Picker prop type is `DetectedOpenPickerModalProps`.
- Final URL parser is `parsePrintedOpenUrl`.
- Candidate parser is `parseDetectedOpenCandidates`.
- Selection runner is `runDetectedOpenPickerSelectionRequest`.
