# Terminal Listener Current-Handle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep live terminal output flowing when a normal React render replaces
the xterm imperative-handle object.

**Architecture:** Preserve the strict captured-handle check for the asynchronous
attachment transaction, but give the committed live listener its own
runtime/shell/generation freshness check. Each accepted live event resolves the
current xterm handle and writes to it once, so harmless handle-object
replacement no longer strands an otherwise valid native listener.

**Tech Stack:** TypeScript, React Native hooks/imperative refs, Node test
runner, Expo/EAS local Android preview build, ADB/logcat.

## Global Constraints

- Do not reconnect SSH, replay terminal output, flush, resize, or reattach the
  native listener as part of the fix.
- Preserve runtime revision and generation as the authority for WebView loads,
  shell replacement, detach, and disposal.
- Preserve byte order and write every accepted live event at most once.
- Do not log terminal contents, keystrokes, private keys, command arguments, or
  raw SSH data.
- Keep the existing diagnostic counters for final tablet verification.
- Build Android only through the local `preview` EAS lane in `AGENTS.md`.
- Install over `com.finalapp.vibe2`; never uninstall, clear app data, or restart
  the remote tmux session.
- Use only the user-authorized tablet ADB endpoint `100.113.210.6:41631`; if it
  changes or refuses connections, stop and request the new endpoint.

---

### Task 1: Route committed listener events to the current xterm handle

**Files:**

- Modify: `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts`
- Test:
  `apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts`

**Interfaces:**

- Consumes:
  `CreateTerminalLifecycleControllerInput.getXterm(): LifecycleXterm | null`.
- Preserves: strict `isAttemptCurrent(..., attemptXterm)` behavior until
  listener ownership commits.
- Produces: a listener callback that uses strict captured-handle freshness until
  ownership commits, then checks runtime/shell/generation freshness, resolves
  `getXterm()` at event-delivery time, and writes once to that current handle.

- [ ] **Step 1: Add the post-attachment handle-replacement regression test**

Add this focused test beside the existing attachment lifecycle tests:

```ts
void test('attached listener writes to the current xterm after a benign handle replacement', async () => {
	const harness = createHarness();
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	await harness.core.attach();

	const listener = harness.shellA.listeners.get(1n);
	assert.ok(listener);
	listener({
		seq: 10n,
		tMs: 1,
		stream: 'stdout',
		bytes: new Uint8Array([3]).buffer,
	});

	const replacementWrites: number[][] = [];
	harness.setXterm({
		...harness.xterm,
		write: (bytes: Uint8Array) => {
			replacementWrites.push(Array.from(bytes));
		},
	});
	listener({
		seq: 11n,
		tMs: 2,
		stream: 'stdout',
		bytes: new Uint8Array([4, 5]).buffer,
	});

	assert.equal(harness.core.isAttached(), true);
	assert.deepEqual(
		harness.calls.filter((call) => call.startsWith('write:')),
		['write:3'],
	);
	assert.deepEqual(replacementWrites, [[4, 5]]);
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 2,
		bytes: 3,
		lastSeq: '11',
		droppedEvents: 0,
	});
});
```

Add this characterization test beside the existing deferred-attachment tests to
lock the strict pre-commit invariant:

```ts
void test('listener keeps strict xterm identity until attachment ownership commits', async () => {
	const harness = createHarness();
	const listenerId = deferred<bigint>();
	let pendingListener:
		| Parameters<TerminalLifecycleShell['addListener']>[0]
		| undefined;
	harness.shellA.addListener = (listener, options) => {
		pendingListener = listener;
		harness.shellA.listenerCursors.push(options.cursor);
		return listenerId.promise;
	};
	harness.core.setShell(
		createShellTransportKey('connection-a', 7),
		harness.shellA,
	);
	harness.core.handleInitialized('instance-1');
	const attaching = harness.core.attach();
	await Promise.resolve();
	assert.ok(pendingListener);

	harness.setXterm({ ...harness.xterm });
	pendingListener({
		seq: 10n,
		tMs: 1,
		stream: 'stdout',
		bytes: new Uint8Array([6]).buffer,
	});
	assert.deepEqual(harness.core.getOutputDiagnostics()?.listener, {
		events: 0,
		bytes: 0,
		lastSeq: null,
		droppedEvents: 0,
	});

	listenerId.resolve(93n);
	await attaching;
	assert.deepEqual(harness.shellA.removedListenerIds, [93n]);
	assert.equal(harness.core.isAttached(), false);
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
  --test-name-pattern='attached listener writes to the current xterm' \
  test/integration/shell-terminal-lifecycle-controller.test.ts
```

Expected: FAIL because `replacementWrites` is empty and the listener snapshot
contains only the control event. The existing listener still compares
`xtermRef.current` with the handle captured during `attach()`.

- [ ] **Step 3: Separate attach-attempt freshness from committed-listener
      freshness**

In `createTerminalLifecycleController`, add a runtime freshness predicate and
make the existing attach predicate build on it:

```ts
const isRuntimeCurrent = (
	attemptGeneration: number,
	attemptShell: TerminalLifecycleShell,
	attemptRuntimeRevision: number,
): boolean =>
	!disposed &&
	generation === attemptGeneration &&
	shell === attemptShell &&
	runtimeRevision === attemptRuntimeRevision &&
	publisher.getSnapshot().ready;

const isAttemptCurrent = (
	attemptGeneration: number,
	attemptShell: TerminalLifecycleShell,
	attemptRuntimeRevision: number,
	attemptXterm: LifecycleXterm,
): boolean =>
	isRuntimeCurrent(attemptGeneration, attemptShell, attemptRuntimeRevision) &&
	isCurrentXterm(attemptXterm);
```

Keep every existing asynchronous replay/registration call to `isCurrent()`
unchanged so an unfinished attempt still requires the captured xterm handle.

- [ ] **Step 4: Resolve the current handle inside the committed listener**

Add a local commit flag before the listener. While it is false, callbacks keep
the existing strict attach-attempt predicate and captured xterm target. Only
after ownership commits does the callback use runtime freshness and resolve the
current handle:

```ts
let listenerCommitted = false;
const listener = (event: ListenerEvent): void => {
	let currentXterm: LifecycleXterm | null;
	if (!listenerCommitted) {
		if (!isCurrent()) return;
		currentXterm = xterm;
	} else {
		if (
			!isRuntimeCurrent(attemptGeneration, attemptShell, attemptRuntimeRevision)
		)
			return;
		try {
			currentXterm = getXterm();
		} catch {
			return;
		}
	}
	if (!currentXterm) return;
	if ('kind' in event) {
		listenerProgress.droppedEvents += 1;
		safeWarn('listener.dropped', {
			kind: event.kind,
			fromSeq: event.fromSeq.toString(),
			toSeq: event.toSeq.toString(),
		});
		return;
	}
	listenerProgress.events += 1;
	listenerProgress.bytes += event.bytes.byteLength;
	listenerProgress.lastSeq = event.seq.toString();
	try {
		currentXterm.write(new Uint8Array(event.bytes));
	} catch (error) {
		safeWarn('Failed to write shell output', error);
	}
};
```

After `addListener` resolves and the existing strict `isCurrent()` check passes,
assign attachment ownership first and then commit the listener in the same
synchronous continuation:

```ts
attachment = {
	id,
	owner: attemptShell,
	runtimeRevision: attemptRuntimeRevision,
};
listenerCommitted = true;
```

Do not alter listener registration, cursor selection, replay, attachment
ownership, WebView resize, or xterm package behavior.

- [ ] **Step 5: Run focused lifecycle tests and verify GREEN**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/shell-terminal-hook-runtime.test.ts
```

Expected: all focused tests pass, including both new handle-replacement tests
and the existing unfinished-attach stale-handle tests.

- [ ] **Step 6: Run mobile regression checks**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
pnpm --filter @fressh/react-native-xtermjs-webview test
```

Expected: TypeScript and lint exit successfully; all mobile integration and
xterm package tests pass.

- [ ] **Step 7: Commit the listener fix**

```bash
git add apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts \
  apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts
git commit -m "Fix terminal listener after xterm handle refresh"
```

### Task 2: Verify live Work output on the tablet

**Files:**

- Create:
  `docs/debugging/2026-07-13-terminal-listener-current-handle-fix-evidence.md`

**Interfaces:**

- Consumes: Task 1 committed-listener routing and the existing
  `Terminal output diagnostics` before/after Work records.
- Produces: exact counter evidence that native, listener, RN sender, WebView,
  and xterm completion all advance in one runtime.

- [ ] **Step 1: Verify the source tree and focused tests before building**

Run:

```bash
git status --short
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/shell-terminal-hook-runtime.test.ts
```

Expected: clean worktree and focused tests pass.

- [ ] **Step 2: Build the Android preview APK locally**

Run:

```bash
cd apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android
```

Expected: EAS completes successfully and prints a local APK path.

- [ ] **Step 3: Install the APK in place without clearing data**

Run:

```bash
adb connect 100.113.210.6:41631
apk_path=$(find /home/muly/wt/fressh/fix1 -type f -name '*.apk' \
  -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
test -n "$apk_path" && test -f "$apk_path"
adb -s 100.113.210.6:41631 install -r -d "$apk_path"
adb -s 100.113.210.6:41631 shell dumpsys package com.finalapp.vibe2 \
  | rg 'versionName=|versionCode=|lastUpdateTime='
```

Expected: installation prints `Success`; package remains `com.finalapp.vibe2`;
no uninstall or data-clear command is used.

- [ ] **Step 4: Capture one controlled Work switch**

Launch the app through its resolved activity, allow the existing saved
connection to open, and inspect the Android UI hierarchy. Proceed only if it
contains exactly one enabled accessibility button labeled `Work`.

Clear logcat, tap the verified button once, wait for the matching `after`
diagnostic snapshot, and confirm the workspace changed visually without
recording terminal text. Capture only the app process and content-free
diagnostic/attachment markers:

```bash
adb -s 100.113.210.6:41631 logcat -c
pid=$(adb -s 100.113.210.6:41631 shell pidof -s com.finalapp.vibe2)
adb -s 100.113.210.6:41631 logcat -d -v raw --pid="$pid" \
  | node -e '
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8");
const marker = "Terminal output diagnostics";
const snapshots = [];
let cursor = 0;

while (true) {
	const markerAt = input.indexOf(marker, cursor);
	if (markerAt < 0) break;
	const objectAt = input.indexOf("{", markerAt + marker.length);
	if (objectAt < 0) throw new Error("diagnostic object missing");
	let depth = 0;
	let inString = false;
	let escaped = false;
	let objectEnd = -1;
	for (let index = objectAt; index < input.length; index += 1) {
		const character = input[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === "\"") inString = false;
			continue;
		}
		if (character === "\"") inString = true;
		else if (character === "{") depth += 1;
		else if (character === "}" && --depth === 0) {
			objectEnd = index + 1;
			break;
		}
	}
	if (objectEnd < 0) throw new Error("diagnostic object incomplete");
	const diagnostic = JSON.parse(input.slice(objectAt, objectEnd));
	const rejectForbiddenKeys = (value) => {
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			if (["argv", "bStr", "chunks"].includes(key)) {
				throw new Error(`forbidden diagnostic key: ${key}`);
			}
			rejectForbiddenKeys(child);
		}
	};
	rejectForbiddenKeys(diagnostic);
	snapshots.push(diagnostic);
	cursor = objectEnd;
}

if (snapshots.length !== 2) {
	throw new Error(`expected 2 diagnostic snapshots, got ${snapshots.length}`);
}
const listenerAttachments = (
	input.match(/shell listener attached/g) ?? []
).length;
process.stdout.write(
	JSON.stringify({ snapshots, listenerAttachments }, null, 2),
);
' \
  > /tmp/fressh-terminal-current-handle-fix.log
```

Expected: one matching before/after pair and no `shell listener attached` record
during the Work operation. The extractor reads logcat through standard input,
selects only the two structured diagnostic objects, rejects prohibited keys, and
writes only its safe JSON result. It never writes the complete Work command
record to disk. Verify the saved file contains neither command/result records
nor terminal payload fields before using it as evidence:

```bash
if rg -n 'Workmux keyboard command|"argv"|"bStr"|"chunks"' \
  /tmp/fressh-terminal-current-handle-fix.log; then
	exit 1
fi
```

- [ ] **Step 5: Record exact proof that every output boundary advanced**

Create
`docs/debugging/2026-07-13-terminal-listener-current-handle-fix-evidence.md`
with the title `Terminal listener current-handle fix evidence`. Its
`Reproduction` section must record the installed package version and update time
and stable connection/channel/runtime/WebView identities. It must state that app
data and tmux state were preserved and that no terminal content was recorded. It
must also state that no listener reattachment was logged during the Work
operation and record only the yes/no result of the visual workspace-change
check, not terminal text.

Add a `Boundary counters` table with columns `Boundary`, `Before`, `After`, and
`Advanced?`. Copy the exact captured decimal values into rows named
`Native tail sequence`, `Listener bytes`, `RN sent bytes`,
`WebView received bytes`, and `xterm completed writes`. Every `Advanced?` cell
must be derived from its two recorded values.

When every row advances and the tablet visibly changes workspace, end with:

```text
Result: live Work output crossed every measured boundary after a benign xterm
handle replacement. The mobile terminal visibly changed to the selected
workspace without reconnecting SSH or reattaching the native listener.
```

If any row does not advance, do not claim success or add another fix. Preserve
the captured counter-only evidence and return to systematic debugging.

- [ ] **Step 6: Commit the tablet verification evidence**

```bash
git add docs/debugging/2026-07-13-terminal-listener-current-handle-fix-evidence.md
git commit -m "Verify terminal output after handle refresh"
```
