# Terminal Output Stall Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify the first in-app boundary that stops advancing when a tmux workspace redraw is written to the mobile client.

**Architecture:** Add cumulative, content-free counters to the WebView write handler, the React Native xterm sender, and the mobile shell listener. Expose one immutable snapshot through the existing terminal controller and record snapshots immediately before and after Workmux commands. This plan stops after a tablet run identifies the failed boundary; the production behavior fix will get a separate failing regression test and focused plan based on that evidence.

**Tech Stack:** TypeScript, React Native, react-native-webview, xterm.js 5.5, Node test runner, Expo/EAS local Android preview build, ADB.

## Global Constraints

- Do not log terminal contents, keystrokes, private keys, or raw SSH data.
- Diagnostics must not retry, replay, flush, reconnect, resize, or otherwise change terminal behavior.
- Every diagnostic snapshot must include connection, channel, runtime instance, and bridge instance identity where available.
- Install over `com.finalapp.vibe2`; never uninstall, clear app data, or restart the remote tmux session.
- Use the local Android preview build lane from `AGENTS.md`.
- Preserve byte order and convert native `bigint` values to decimal strings before logging.

---

### Task 1: Count WebView xterm writes and completions

**Files:**
- Create: `packages/react-native-xtermjs-webview/src-internal/write-progress.ts`
- Modify: `packages/react-native-xtermjs-webview/src/bridge.ts`
- Modify: `packages/react-native-xtermjs-webview/src-internal/webview-message-handler.ts`
- Test: `packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts`

**Interfaces:**
- Produces: `OutputProgressBridgeMessage` with `receivedMessages`, `receivedBytes`, `completedWrites`, and `instanceId`.
- Produces: `createWriteProgressReporter({ instanceId, now, sendToRn, minIntervalMs })` with `received(byteCount)` and `completed()` methods.
- Consumes: xterm `Terminal.write(data, callback)` so completion means xterm accepted and parsed that queued write.

- [ ] **Step 1: Write the failing reporter and handler tests**

Add tests that use a fake clock and a terminal whose write callback is controlled by the test:

```ts
void test('write progress reports received bytes and completed xterm writes without content', () => {
	let nowMs = 1_000;
	const messages: BridgeInboundDraftMessage[] = [];
	const reporter = createWriteProgressReporter({
		instanceId: 'instance-1',
		now: () => nowMs,
		sendToRn: (message) => messages.push(message),
		minIntervalMs: 250,
	});

	reporter.received(12);
	reporter.completed();
	nowMs += 300;
	reporter.received(7);
	reporter.completed();

	assert.deepEqual(messages, [
		{
			type: 'outputProgress',
			instanceId: 'instance-1',
			receivedMessages: 1,
			receivedBytes: 12,
			completedWrites: 1,
		},
		{
			type: 'outputProgress',
			instanceId: 'instance-1',
			receivedMessages: 2,
			receivedBytes: 19,
			completedWrites: 2,
		},
	]);
});

void test('webview write progress advances only after the xterm callback', () => {
	let complete: (() => void) | undefined;
	const messages: BridgeInboundDraftMessage[] = [];
	const handler = createXtermWebViewMessageHandler({
		instanceId: 'instance-1',
		term: {
			cols: 80,
			rows: 24,
			options: {},
			write: (_bytes, callback) => {
				complete = callback;
			},
			resize: () => {},
			getSelection: () => '',
			clear: () => {},
			focus: () => {},
		},
		fitAddon: { fit: () => {} },
		selectionHandles: { applySelectionMode: () => {} },
		touchScrollController: {
			setConfig: () => {},
			exitScrollback: () => {},
			handleEnterAck: () => {},
		},
		sendToRn: (message) => messages.push(message),
		applyFontFamily: () => {},
		now: () => 1_000,
	});

	handler(new MessageEvent('message', { data: { type: 'write', bStr: 'abc' } }));
	assert.equal(messages.some((message) => message.type === 'outputProgress'), false);
	complete?.();
	assert.equal(messages.at(-1)?.type, 'outputProgress');
});
```

- [ ] **Step 2: Run the package tests and verify RED**

Run:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview test
```

Expected: FAIL because `createWriteProgressReporter`, the `outputProgress` bridge message, and the handler `now` dependency do not exist.

- [ ] **Step 3: Implement the cumulative rate-limited reporter**

Create the reporter with no payload content:

```ts
export type WriteProgressReporter = {
	received(byteCount: number): void;
	completed(): void;
};

export function createWriteProgressReporter(input: {
	instanceId: string;
	now(): number;
	sendToRn(message: BridgeInboundDraftMessage): void;
	minIntervalMs?: number;
}): WriteProgressReporter {
	const minIntervalMs = input.minIntervalMs ?? 250;
	let receivedMessages = 0;
	let receivedBytes = 0;
	let completedWrites = 0;
	let lastReportAt = Number.NEGATIVE_INFINITY;
	return {
		received: (byteCount) => {
			receivedMessages += 1;
			receivedBytes += byteCount;
		},
		completed: () => {
			completedWrites += 1;
			const reportAt = input.now();
			if (reportAt - lastReportAt < minIntervalMs) return;
			lastReportAt = reportAt;
			input.sendToRn({
				type: 'outputProgress',
				instanceId: input.instanceId,
				receivedMessages,
				receivedBytes,
				completedWrites,
			});
		},
	};
}
```

Extend `BridgeInboundMessage` with the exact `outputProgress` fields. In `createXtermWebViewMessageHandler`, call `reporter.received(bytes.byteLength)` before `term.write(bytes, reporter.completed)` for both `write` and every `writeMany` chunk. Default `now` to `performance.now()`.

- [ ] **Step 4: Run tests, typecheck, and verify GREEN**

Run:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview test
pnpm --filter @fressh/react-native-xtermjs-webview typecheck
```

Expected: all package tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/react-native-xtermjs-webview/src/bridge.ts \
  packages/react-native-xtermjs-webview/src-internal/write-progress.ts \
  packages/react-native-xtermjs-webview/src-internal/webview-message-handler.ts \
  packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts
git commit -m "Add WebView terminal write progress diagnostics"
```

### Task 2: Count React Native sends and expose xterm diagnostics

**Files:**
- Create: `packages/react-native-xtermjs-webview/src/output-diagnostics.ts`
- Modify: `packages/react-native-xtermjs-webview/src/index.tsx`
- Modify: `packages/react-native-xtermjs-webview/src/xterm-message-handler.ts`
- Modify: `packages/react-native-xtermjs-webview/src/xterm-webview-handle.ts`
- Test: `packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts`

**Interfaces:**
- Produces: `XtermOutputDiagnostics` containing RN queued/sent counts and the latest WebView progress counts.
- Produces: `XtermWebViewHandle.getOutputDiagnostics(): XtermOutputDiagnostics`.
- Consumes: Task 1 `outputProgress` messages after normal bridge generation checks.

- [ ] **Step 1: Write failing counter and bridge tests**

Add tests for this API:

```ts
void test('xterm output diagnostics separate queued, sent, and completed bytes', () => {
	const diagnostics = createXtermOutputDiagnostics();
	diagnostics.recordQueued(10);
	diagnostics.recordFlush();
	diagnostics.recordSent(10);
	diagnostics.recordWebViewProgress({
		instanceId: 'instance-1',
		receivedMessages: 1,
		receivedBytes: 10,
		completedWrites: 1,
	});
	assert.deepEqual(diagnostics.getSnapshot(), {
		webViewInstanceId: 'instance-1',
		rnQueuedMessages: 1,
		rnQueuedBytes: 10,
		rnFlushes: 1,
		rnSentMessages: 1,
		rnSentBytes: 10,
		webViewReceivedMessages: 1,
		webViewReceivedBytes: 10,
		webViewCompletedWrites: 1,
	});
});
```

Extend the existing inbound-message harness to assert that a current-generation `outputProgress` message calls `onOutputProgress`, while a stale instance message is dropped.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview test
```

Expected: FAIL because the diagnostics counter, callback, and handle getter do not exist.

- [ ] **Step 3: Implement the RN diagnostic counter and wiring**

Use this public snapshot shape:

```ts
export type XtermOutputDiagnostics = {
	webViewInstanceId: string | null;
	rnQueuedMessages: number;
	rnQueuedBytes: number;
	rnFlushes: number;
	rnSentMessages: number;
	rnSentBytes: number;
	webViewReceivedMessages: number;
	webViewReceivedBytes: number;
	webViewCompletedWrites: number;
};
```

Record queued bytes in `write` and `writeMany`, increment `rnFlushes` whenever
`flush` sends a non-empty buffer, record sent bytes in `flush` and `writeMany`,
and update WebView fields only after `handleXtermBridgeInboundMessage` accepts a
current `outputProgress` message, including that message's `instanceId` as
`webViewInstanceId`. Add `getOutputDiagnostics` to
`XtermWebViewHandle` and return a copied snapshot so callers cannot mutate
counters.

- [ ] **Step 4: Run tests, typecheck, and verify GREEN**

Run:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview test
pnpm --filter @fressh/react-native-xtermjs-webview typecheck
```

Expected: all tests pass with no TypeScript errors.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/react-native-xtermjs-webview/src/output-diagnostics.ts \
  packages/react-native-xtermjs-webview/src/index.tsx \
  packages/react-native-xtermjs-webview/src/xterm-message-handler.ts \
  packages/react-native-xtermjs-webview/src/xterm-webview-handle.ts \
  packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts
git commit -m "Expose React Native terminal output counters"
```

### Task 3: Snapshot native ring and listener progress around Work commands

**Files:**
- Create: `apps/mobile/src/lib/shell-controllers/terminal-output-diagnostics.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/terminal-hook-runtime.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-remote-contracts.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard-remote-core.ts`
- Modify: `apps/mobile/src/lib/shell-controllers/keyboard.tsx`
- Test: `apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts`
- Test: `apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts`

**Interfaces:**
- Produces: `TerminalOutputDiagnosticSnapshot` with native, listener, RN sender, and WebView counters.
- Produces: `TerminalLifecycleController.getOutputDiagnostics()` and `ShellTerminalRuntimeView.getOutputDiagnostics()`.
- Consumes: Task 2 `XtermWebViewHandle.getOutputDiagnostics()`.
- Consumes: existing `SshShell.bufferStats()` and `SshShell.currentSeq()`.

- [ ] **Step 1: Write the failing lifecycle snapshot test**

Extend the lifecycle harness shell with deterministic stats and emit two live chunks:

```ts
shell.bufferStats = () => ({
	ringBytesCount: 1_000n,
	usedBytes: 20n,
	headSeq: 4n,
	tailSeq: 8n,
	droppedBytesTotal: 0n,
	chunksCount: 5n,
});
shell.currentSeq = () => 9;

listener({ seq: 8n, tMs: 1, stream: 'stdout', bytes: new Uint8Array([1, 2]).buffer });
listener({ seq: 9n, tMs: 2, stream: 'stdout', bytes: new Uint8Array([3]).buffer });

assert.deepEqual(harness.core.getOutputDiagnostics(), {
	connectionId: 'connection-a',
	channelId: 7,
	runtimeInstanceId: 'instance-1',
	native: {
		currentSeq: '9',
		ringBytesCount: '1000',
		usedBytes: '20',
		headSeq: '4',
		tailSeq: '8',
		droppedBytesTotal: '0',
		chunksCount: '5',
	},
	listener: { events: 2, bytes: 3, lastSeq: '9', droppedEvents: 0 },
	xterm: harness.xterm.getOutputDiagnostics(),
});
```

- [ ] **Step 2: Write the failing Work-command snapshot test**

Pass `readTerminalOutputDiagnostics` into the remote-core harness and assert that the logger receives `phase: 'before'` before the control command and `phase: 'after'` after its result:

```ts
assert.deepEqual(
	info.filter((entry) => entry.message === 'Terminal output diagnostics'),
	[
		{ message: 'Terminal output diagnostics', details: { phase: 'before', snapshot: before } },
		{ message: 'Terminal output diagnostics', details: { phase: 'after', snapshot: after } },
	],
);
```

The sampler must be best-effort: a thrown `bufferStats()` call logs `Failed to read terminal output diagnostics` and does not alter the Work result.

Add a second lifecycle assertion that replaces the shell/runtime and verifies
listener counts reset to zero. Serialize the snapshot with a sentinel byte
payload in the emitted listener event and assert the serialized diagnostic text
contains counts but not the sentinel content.

- [ ] **Step 3: Run focused mobile tests and verify RED**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/shell-keyboard-remote-controller.test.ts
```

Expected: FAIL because the snapshot types, getters, listener counters, and Work sampler do not exist.

- [ ] **Step 4: Implement immutable native/listener snapshots**

Use decimal strings for every native `bigint`:

```ts
export type TerminalOutputDiagnosticSnapshot = {
	connectionId: string;
	channelId: number;
	runtimeInstanceId: string | null;
	native: {
		currentSeq: string;
		ringBytesCount: string;
		usedBytes: string;
		headSeq: string;
		tailSeq: string;
		droppedBytesTotal: string;
		chunksCount: string;
	};
	listener: {
		events: number;
		bytes: number;
		lastSeq: string | null;
		droppedEvents: number;
	};
	xterm: XtermOutputDiagnostics | null;
};
```

Increment listener counters before calling `xterm.write`. Reset them only when the lifecycle runtime revision changes. Read current shell and xterm counters synchronously in `getOutputDiagnostics()` without changing either component.

- [ ] **Step 5: Wire snapshots into Work command logging**

Add `readTerminalOutputDiagnostics(): TerminalOutputDiagnosticSnapshot | null`
to `CreateShellKeyboardRemoteCoreOptions`. In `keyboard.tsx`, pass
`() => committedDeps.current.terminalView.getOutputDiagnostics()`. In
`keyboard-remote-core.ts`, sample immediately before
`workmuxControlChannel.command` and immediately after it resolves or rejects.
Log only the structured snapshot and phase.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/shell-keyboard-remote-controller.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: focused tests pass and TypeScript reports no errors.

- [ ] **Step 7: Run package regression checks**

Run:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview test
pnpm --filter @fressh/mobile test:integration
pnpm --filter @fressh/react-native-xtermjs-webview lint:check
pnpm --filter @fressh/mobile lint:check
```

Expected: all tests and lint checks pass without new warnings or errors.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/mobile/src/lib/shell-controllers/terminal-output-diagnostics.ts \
  apps/mobile/src/lib/shell-controllers/terminal-lifecycle-core.ts \
  apps/mobile/src/lib/shell-controllers/terminal-hook-runtime.ts \
  apps/mobile/src/lib/shell-controllers/keyboard-remote-contracts.ts \
  apps/mobile/src/lib/shell-controllers/keyboard-remote-core.ts \
  apps/mobile/src/lib/shell-controllers/keyboard.tsx \
  apps/mobile/test/integration/shell-terminal-lifecycle-controller.test.ts \
  apps/mobile/test/integration/shell-keyboard-remote-controller.test.ts
git commit -m "Trace terminal output across Work switches"
```

### Task 4: Build, install, reproduce, and identify the failed boundary

**Files:**
- Create: `docs/debugging/2026-07-12-terminal-output-stall-evidence.md`

**Interfaces:**
- Consumes: Task 3 `Terminal output diagnostics` log records.
- Produces: one evidence table naming the first counter that fails to advance.

- [ ] **Step 1: Verify the final source tree before building**

Run:

```bash
git status --short
pnpm --filter @fressh/react-native-xtermjs-webview test
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/shell-terminal-lifecycle-controller.test.ts \
  test/integration/shell-keyboard-remote-controller.test.ts
```

Expected: clean worktree and all focused tests pass.

- [ ] **Step 2: Build the Android preview APK locally**

Run:

```bash
cd apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android
```

Expected: EAS finishes successfully and prints the local APK path.

- [ ] **Step 3: Install without clearing data and reconnect ADB**

Run:

```bash
adb connect 100.113.210.6:43239
apk_path=$(find /home/muly/wt/fressh/fix1 -type f -name '*.apk' \
  -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
test -n "$apk_path" && test -f "$apk_path"
adb -s 100.113.210.6:43239 install -r -d "$apk_path"
adb -s 100.113.210.6:43239 shell dumpsys package com.finalapp.vibe2 \
  | rg 'versionName=|versionCode=|lastUpdateTime='
```

Expected: `Success`; package remains `com.finalapp.vibe2`; no uninstall or data-clear command is used.

- [ ] **Step 4: Capture one controlled Work switch**

Clear logcat, launch the app, connect using the existing saved connection, and tap Work once. Capture only the app process:

```bash
adb -s 100.113.210.6:43239 logcat -c
pid=$(adb -s 100.113.210.6:43239 shell pidof -s com.finalapp.vibe2)
adb -s 100.113.210.6:43239 logcat -d -v threadtime --pid="$pid" \
  | rg 'Terminal output diagnostics|Workmux keyboard command' \
  > /tmp/fressh-terminal-output-diagnostics.log
```

Expected: matching `before` and `after` snapshots around one successful Workmux result.

- [ ] **Step 5: Record the root-cause boundary**

Create the evidence document with a four-column table named `Boundary`,
`Before`, `After`, and `Advanced?`. Add rows for native tail sequence,
listener bytes, RN sent bytes, WebView received bytes, and xterm completed
writes. Copy the exact decimal values from the captured snapshots, then add a
`First failed boundary` sentence naming the earliest row whose value did not
advance.

Do not select or implement a production fix in this task. Return to systematic-debugging hypothesis testing with the first failed boundary as evidence.

- [ ] **Step 6: Commit the evidence**

```bash
git add docs/debugging/2026-07-12-terminal-output-stall-evidence.md
git commit -m "Document terminal output stall boundary"
```
