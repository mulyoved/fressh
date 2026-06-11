# Browser Action Error Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Copy Error` button to all Browser action error alerts and copy a paste-friendly debug report with action context.

**Architecture:** Add a pure formatter module for Browser action error reports, then add a small alert helper that wires formatted reports to `Alert.alert` and clipboard copy. Update Diffity plumbing to return command context, then update `useBrowserActionsController` so each Browser action failure calls the shared copy-capable error path.

**Tech Stack:** Expo React Native, TypeScript, `expo-clipboard`, React Native `Alert`, Node `node:test` integration tests, pnpm workspace scripts.

---

## File Structure

- Create `apps/mobile/src/lib/browser-action-error-report.ts`
  - Owns Browser action error report types, tmux target normalization, and stable plain-text formatting.
  - Has no React Native imports.
- Create `apps/mobile/src/lib/browser-action-error-alert.ts`
  - Owns alert button wiring and best-effort copy behavior.
  - Accepts injected `alert`, `copyText`, and `warn` functions for easy tests.
- Create `apps/mobile/test/integration/browser-action-error-report.test.ts`
  - Covers line-oriented report formatting and omitted unavailable fields.
- Create `apps/mobile/test/integration/browser-action-error-alert.test.ts`
  - Covers `Copy Error`/`OK` buttons, clipboard copy payload, and logged copy failure.
- Modify `apps/mobile/src/lib/browser-actions-controller-actions.ts`
  - Change `runBrowserActionsDiffityShare` to return `output`, `panePath`, and `command`.
- Modify `apps/mobile/src/lib/host-diffity-open-request.ts`
  - Preserve stale request behavior while surfacing Diff-specific error context.
- Modify `apps/mobile/test/integration/shell-modals.test.ts`
  - Update Diffity runner tests for the richer `showError` payload.
- Modify `apps/mobile/src/lib/shell-modals.tsx`
  - Import clipboard/logger/helpers and route every Browser action error through the shared report alert.
- Modify `apps/mobile/test/integration/detected-open-actions.test.ts`
  - No production change is required here, but verify these tests still pass after the controller wraps detected-open `showError`.

## Task 1: Browser Action Error Report Formatter

**Files:**
- Create: `apps/mobile/src/lib/browser-action-error-report.ts`
- Test: `apps/mobile/test/integration/browser-action-error-report.test.ts`

- [ ] **Step 1: Write the failing formatter tests**

Create `apps/mobile/test/integration/browser-action-error-report.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatBrowserActionErrorReport,
	normalizeBrowserActionTmuxTarget,
	type BrowserActionErrorReport,
} from '../../src/lib/browser-action-error-report';

void test('browser action error report formatter emits stable line-oriented text', () => {
	const report: BrowserActionErrorReport = {
		action: 'Diff',
		title: 'Diffity failed',
		message: 'mdev diffity share did not return an HTTPS URL.',
		connectionState: 'connected',
		tmuxEnabled: true,
		tmuxTarget: 'main',
		panePath: '/home/muly/fressh',
		command: "cd '/home/muly/fressh' && mdev diffity share",
		output: 'line one\nline two\n',
		url: 'https://diffity.example/current',
		details: 'Android could not open URL.',
	};

	assert.equal(
		formatBrowserActionErrorReport(report),
		[
			'Fressh Browser Action Error',
			'Action: Diff',
			'Title: Diffity failed',
			'Message: mdev diffity share did not return an HTTPS URL.',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: main',
			'Pane path: /home/muly/fressh',
			"Command: cd '/home/muly/fressh' && mdev diffity share",
			'URL: https://diffity.example/current',
			'Details: Android could not open URL.',
			'Output:',
			'line one',
			'line two',
		].join('\n'),
	);
});

void test('browser action error report formatter omits unavailable optional fields', () => {
	const report: BrowserActionErrorReport = {
		action: 'Open',
		title: 'Open failed',
		message: 'Remote command failed.',
		connectionState: 'missing',
		tmuxEnabled: false,
		tmuxTarget: 'main',
		output: '',
	};

	assert.equal(
		formatBrowserActionErrorReport(report),
		[
			'Fressh Browser Action Error',
			'Action: Open',
			'Title: Open failed',
			'Message: Remote command failed.',
			'Connection: missing',
			'Workmux enabled: false',
			'Tmux target: main',
		].join('\n'),
	);
});

void test('browser action tmux target normalization trims and defaults to main', () => {
	assert.equal(normalizeBrowserActionTmuxTarget('  work  '), 'work');
	assert.equal(normalizeBrowserActionTmuxTarget('  '), 'main');
});
```

- [ ] **Step 2: Run the formatter tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-action-error-report.test.ts
```

Expected: FAIL with a module resolution error for `browser-action-error-report`.

- [ ] **Step 3: Add the formatter implementation**

Create `apps/mobile/src/lib/browser-action-error-report.ts`:

```ts
export type BrowserActionErrorConnectionState = 'connected' | 'missing';

export type BrowserActionErrorReport = {
	action: string;
	title: string;
	message: string;
	connectionState: BrowserActionErrorConnectionState;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	panePath?: string;
	command?: string;
	output?: string;
	url?: string;
	details?: string;
};

export type BrowserActionErrorReportInput = {
	action: string;
	title: string;
	message: string;
	connectionPresent: boolean;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	panePath?: string;
	command?: string;
	output?: string;
	url?: string;
	details?: string;
};

function hasValue(value: string | undefined): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function appendOptionalLine(
	lines: string[],
	label: string,
	value: string | undefined,
) {
	if (!hasValue(value)) return;
	lines.push(`${label}: ${value}`);
}

export function normalizeBrowserActionTmuxTarget(tmuxTarget: string): string {
	return tmuxTarget.trim() || 'main';
}

export function createBrowserActionErrorReport({
	action,
	title,
	message,
	connectionPresent,
	tmuxEnabled,
	tmuxTarget,
	panePath,
	command,
	output,
	url,
	details,
}: BrowserActionErrorReportInput): BrowserActionErrorReport {
	return {
		action,
		title,
		message,
		connectionState: connectionPresent ? 'connected' : 'missing',
		tmuxEnabled,
		tmuxTarget: normalizeBrowserActionTmuxTarget(tmuxTarget),
		panePath,
		command,
		output,
		url,
		details,
	};
}

export function formatBrowserActionErrorReport(
	report: BrowserActionErrorReport,
): string {
	const lines = [
		'Fressh Browser Action Error',
		`Action: ${report.action}`,
		`Title: ${report.title}`,
		`Message: ${report.message}`,
		`Connection: ${report.connectionState}`,
		`Workmux enabled: ${String(report.tmuxEnabled)}`,
		`Tmux target: ${normalizeBrowserActionTmuxTarget(report.tmuxTarget)}`,
	];

	appendOptionalLine(lines, 'Pane path', report.panePath);
	appendOptionalLine(lines, 'Command', report.command);
	appendOptionalLine(lines, 'URL', report.url);
	appendOptionalLine(lines, 'Details', report.details);

	if (hasValue(report.output)) {
		lines.push('Output:');
		lines.push(report.output.trimEnd());
	}

	return lines.join('\n');
}
```

- [ ] **Step 4: Run the formatter tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-action-error-report.test.ts
```

Expected: PASS with 3 tests passing.

- [ ] **Step 5: Commit the formatter**

Run:

```bash
git add apps/mobile/src/lib/browser-action-error-report.ts apps/mobile/test/integration/browser-action-error-report.test.ts
git commit -m "feat(mobile): format browser action error reports"
```

## Task 2: Copy-Capable Browser Action Error Alert

**Files:**
- Create: `apps/mobile/src/lib/browser-action-error-alert.ts`
- Test: `apps/mobile/test/integration/browser-action-error-alert.test.ts`

- [ ] **Step 1: Write the failing alert helper tests**

Create `apps/mobile/test/integration/browser-action-error-alert.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	showBrowserActionErrorReport,
	type BrowserActionErrorAlertButton,
} from '../../src/lib/browser-action-error-alert';
import { type BrowserActionErrorReport } from '../../src/lib/browser-action-error-report';

function createReport(): BrowserActionErrorReport {
	return {
		action: 'Diff',
		title: 'Diffity failed',
		message: 'no url here',
		connectionState: 'connected',
		tmuxEnabled: true,
		tmuxTarget: 'main',
		panePath: '/tmp/project',
		command: "cd '/tmp/project' && mdev diffity share",
		output: 'no url here',
	};
}

void test('browser action error alert includes copy and OK buttons', () => {
	const alerts: {
		title: string;
		message: string;
		buttons: BrowserActionErrorAlertButton[];
	}[] = [];

	showBrowserActionErrorReport(createReport(), {
		alert: (title, message, buttons) => {
			alerts.push({ title, message, buttons });
		},
		copyText: async () => {},
		warn: () => {},
	});

	assert.equal(alerts.length, 1);
	assert.equal(alerts[0]?.title, 'Diffity failed');
	assert.equal(alerts[0]?.message, 'no url here');
	assert.deepEqual(
		alerts[0]?.buttons.map((button) => button.text),
		['Copy Error', 'OK'],
	);
});

void test('browser action error alert copies formatted report when Copy Error is pressed', async () => {
	let buttons: BrowserActionErrorAlertButton[] = [];
	const copied: string[] = [];

	showBrowserActionErrorReport(createReport(), {
		alert: (_title, _message, alertButtons) => {
			buttons = alertButtons;
		},
		copyText: async (text) => {
			copied.push(text);
		},
		warn: () => {},
	});

	buttons[0]?.onPress?.();
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(copied, [
		[
			'Fressh Browser Action Error',
			'Action: Diff',
			'Title: Diffity failed',
			'Message: no url here',
			'Connection: connected',
			'Workmux enabled: true',
			'Tmux target: main',
			'Pane path: /tmp/project',
			"Command: cd '/tmp/project' && mdev diffity share",
			'Output:',
			'no url here',
		].join('\n'),
	]);
});

void test('browser action error alert logs copy failures without throwing', async () => {
	let buttons: BrowserActionErrorAlertButton[] = [];
	const warnings: string[] = [];
	const copyError = new Error('clipboard unavailable');

	showBrowserActionErrorReport(createReport(), {
		alert: (_title, _message, alertButtons) => {
			buttons = alertButtons;
		},
		copyText: async () => {
			throw copyError;
		},
		warn: (message, error) => {
			warnings.push(`${message}: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	buttons[0]?.onPress?.();
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(warnings, [
		'copy Browser action error failed: clipboard unavailable',
	]);
});
```

- [ ] **Step 2: Run the alert helper tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-action-error-alert.test.ts
```

Expected: FAIL with a module resolution error for `browser-action-error-alert`.

- [ ] **Step 3: Add the alert helper implementation**

Create `apps/mobile/src/lib/browser-action-error-alert.ts`:

```ts
import {
	formatBrowserActionErrorReport,
	type BrowserActionErrorReport,
} from './browser-action-error-report';
import { type AlertButton } from 'react-native';

export type BrowserActionErrorAlertButton = Pick<
	AlertButton,
	'text' | 'onPress'
>;

export type BrowserActionErrorAlertDeps = {
	alert: (
		title: string,
		message: string,
		buttons: BrowserActionErrorAlertButton[],
	) => void;
	copyText: (text: string) => Promise<void>;
	warn: (message: string, error: unknown) => void;
};

export function showBrowserActionErrorReport(
	report: BrowserActionErrorReport,
	deps: BrowserActionErrorAlertDeps,
) {
	const copyText = formatBrowserActionErrorReport(report);
	deps.alert(report.title, report.message, [
		{
			text: 'Copy Error',
			onPress: () => {
				void deps
					.copyText(copyText)
					.catch((error: unknown) =>
						deps.warn('copy Browser action error failed', error),
					);
			},
		},
		{ text: 'OK' },
	]);
}
```

- [ ] **Step 4: Run the alert helper tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-action-error-alert.test.ts
```

Expected: PASS with 3 tests passing.

- [ ] **Step 5: Commit the alert helper**

Run:

```bash
git add apps/mobile/src/lib/browser-action-error-alert.ts apps/mobile/test/integration/browser-action-error-alert.test.ts
git commit -m "feat(mobile): add copyable browser action error alert"
```

## Task 3: Diffity Context Plumbing

**Files:**
- Modify: `apps/mobile/src/lib/browser-actions-controller-actions.ts`
- Modify: `apps/mobile/src/lib/host-diffity-open-request.ts`
- Modify: `apps/mobile/test/integration/shell-modals.test.ts`

- [ ] **Step 1: Update the Diffity runner tests for enriched error payloads**

In `apps/mobile/test/integration/shell-modals.test.ts`, update the import and add the local error type near the top:

```ts
import {
	runHostDiffityOpenRequest,
	type HostDiffityOpenErrorReport,
	type HostDiffityShareResult,
} from '../../src/lib/host-diffity-open-request';
```

Replace the `errors` declarations and `showError` callbacks in the Diffity tests with typed report collection. For the stale request tests, use:

```ts
const errors: HostDiffityOpenErrorReport[] = [];
```

and:

```ts
showError: (report) => {
	errors.push(report);
},
```

Also update stale test share values from strings to `HostDiffityShareResult`
objects. In `stale Diffity completion does not clear newer in-flight request`,
replace:

```ts
const firstShare = deferred<string>();
const secondShare = deferred<string>();
```

with:

```ts
const firstShare = deferred<HostDiffityShareResult>();
const secondShare = deferred<HostDiffityShareResult>();
```

Replace:

```ts
firstShare.resolve('https://diffity.example/old');
```

with:

```ts
firstShare.resolve({ output: 'https://diffity.example/old' });
```

Replace:

```ts
secondShare.resolve('https://diffity.example/new');
```

with:

```ts
secondShare.resolve({ output: 'https://diffity.example/new' });
```

In `browser action cleanup suppresses pending Diffity completion`, replace:

```ts
const share = deferred<string>();
```

with:

```ts
const share = deferred<HostDiffityShareResult>();
```

Replace:

```ts
share.resolve('https://diffity.example/backgrounded');
```

with:

```ts
share.resolve({ output: 'https://diffity.example/backgrounded' });
```

Replace the missing HTTPS URL test body with this version:

```ts
void test('current Diffity request reports missing HTTPS URL output with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	const shareResult: HostDiffityShareResult = {
		output: 'no url here',
		panePath: '/tmp/project',
		command: "cd '/tmp/project' && mdev diffity share",
	};

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => shareResult,
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'no url here',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: 'no url here',
		},
	]);
});
```

Replace the Android URL open failure test body with this version:

```ts
void test('current Diffity request reports Android URL open failures with extracted URL', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => ({
				output: 'created https://diffity.example/current',
				panePath: '/tmp/project',
				command: "cd '/tmp/project' && mdev diffity share",
			}),
			openAndroidUrl: async () => {
				throw new Error('cannot open URL');
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'cannot open URL',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			url: 'https://diffity.example/current',
		},
	]);
});
```

- [ ] **Step 2: Run the Diffity tests and verify they fail**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modals.test.ts
```

Expected: FAIL with TypeScript errors because `HostDiffityOpenErrorReport` and `HostDiffityShareResult` are not exported yet.

- [ ] **Step 3: Return Diffity command context from Browser action controller actions**

In `apps/mobile/src/lib/browser-actions-controller-actions.ts`, add this exported type after `BrowserActionsWorkspace`:

```ts
export type BrowserActionsDiffityShareResult = {
	output: string;
	panePath: string;
	command: string;
};
```

Replace `runBrowserActionsDiffityShare` with:

```ts
export async function runBrowserActionsDiffityShare(
	deps: BrowserActionsContextDeps,
): Promise<BrowserActionsDiffityShareResult> {
	const panePath = await resolveBrowserActionsPanePath(deps);
	const command = buildDiffityShareCommand(panePath);
	return {
		output: await deps.runHostBrowserCommand(command, 60_000),
		panePath,
		command,
	};
}
```

- [ ] **Step 4: Update the host Diffity request runner**

Replace the contents of `apps/mobile/src/lib/host-diffity-open-request.ts` with:

```ts
import { extractLastHttpsUrl } from './host-browser-actions';

export type HostDiffityShareResult = {
	output: string;
	panePath?: string;
	command?: string;
};

export type HostDiffityOpenErrorReport = {
	title: string;
	message: string;
	panePath?: string;
	command?: string;
	output?: string;
	url?: string;
};

export function runHostDiffityOpenRequest({
	hostDiffityInFlightRef,
	hostDiffityRequestId,
	runDiffityShare,
	openAndroidUrl,
	showError,
	getErrorMessage,
}: {
	hostDiffityInFlightRef: { current: boolean };
	hostDiffityRequestId: {
		next: () => number;
		isCurrent: (id: number) => boolean;
	};
	runDiffityShare: () => Promise<HostDiffityShareResult>;
	openAndroidUrl: (url: string) => Promise<void>;
	showError: (report: HostDiffityOpenErrorReport) => void;
	getErrorMessage: (error: unknown) => string;
}): boolean {
	if (hostDiffityInFlightRef.current) return false;
	const id = hostDiffityRequestId.next();
	hostDiffityInFlightRef.current = true;
	void (async () => {
		let shareResult: HostDiffityShareResult | null = null;
		let url: string | null = null;
		try {
			shareResult = await runDiffityShare();
			url = extractLastHttpsUrl(shareResult.output);
			if (!url) {
				if (!hostDiffityRequestId.isCurrent(id)) return;
				showError({
					title: 'Diffity failed',
					message:
						shareResult.output ||
						'mdev diffity share did not return an HTTPS URL.',
					panePath: shareResult.panePath,
					command: shareResult.command,
					output: shareResult.output,
				});
				return;
			}
			if (!hostDiffityRequestId.isCurrent(id)) return;
			await openAndroidUrl(url);
		} catch (err) {
			if (!hostDiffityRequestId.isCurrent(id)) return;
			showError({
				title: 'Diffity failed',
				message: getErrorMessage(err),
				panePath: shareResult?.panePath,
				command: shareResult?.command,
				url: url ?? undefined,
			});
		} finally {
			if (hostDiffityRequestId.isCurrent(id)) {
				hostDiffityInFlightRef.current = false;
			}
		}
	})();
	return true;
}
```

- [ ] **Step 5: Run the Diffity tests and verify they pass**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-modals.test.ts
```

Expected: PASS with existing stale request behavior still covered.

- [ ] **Step 6: Commit Diffity context plumbing**

Run:

```bash
git add apps/mobile/src/lib/browser-actions-controller-actions.ts apps/mobile/src/lib/host-diffity-open-request.ts apps/mobile/test/integration/shell-modals.test.ts
git commit -m "feat(mobile): include Diffity context in browser action errors"
```

## Task 4: Wire Copyable Error Reports Into Browser Actions

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Test: `apps/mobile/test/integration/browser-action-error-alert.test.ts`
- Test: `apps/mobile/test/integration/browser-action-error-report.test.ts`
- Test: `apps/mobile/test/integration/shell-modals.test.ts`
- Test: `apps/mobile/test/integration/detected-open-actions.test.ts`

- [ ] **Step 1: Update imports in `shell-modals.tsx`**

At the top of `apps/mobile/src/lib/shell-modals.tsx`, add `expo-clipboard`, the alert helper, the report helper, and logger imports.

The import block should include these new imports:

```ts
import * as Clipboard from 'expo-clipboard';
import { showBrowserActionErrorReport } from './browser-action-error-alert';
import {
	createBrowserActionErrorReport,
	type BrowserActionErrorReportInput,
} from './browser-action-error-report';
import { rootLogger } from './logger';
```

After the imports, add this logger:

```ts
const logger = rootLogger.extend('ShellModals');
```

- [ ] **Step 2: Replace the local `showError` helper**

In `useBrowserActionsController`, replace:

```ts
const showError = useCallback((title: string, message: string) => {
	Alert.alert(title, message);
}, []);
```

with:

```ts
type BrowserActionErrorInput = Omit<
	BrowserActionErrorReportInput,
	'connectionPresent' | 'tmuxEnabled' | 'tmuxTarget'
>;

const showError = useCallback(
	(input: BrowserActionErrorInput) => {
		showBrowserActionErrorReport(
			createBrowserActionErrorReport({
				...input,
				connectionPresent: Boolean(connection),
				tmuxEnabled,
				tmuxTarget,
			}),
			{
				alert: (title, message, buttons) =>
					Alert.alert(title, message, buttons),
				copyText: Clipboard.setStringAsync,
				warn: (message, error) => logger.warn(message, error),
			},
		);
	},
	[connection, tmuxEnabled, tmuxTarget],
);
```

- [ ] **Step 3: Update GitHub Browser action failures**

In `handleOpenGitHubTarget`, replace:

```ts
showError(title, getErrorMessage(err));
```

with:

```ts
showError({
	action: target === 'issues' ? 'GitHub Issues' : 'GitHub Pull Requests',
	title,
	message: getErrorMessage(err),
});
```

Keep the existing `useCallback` dependency on `showError`.

- [ ] **Step 4: Update Diff Browser action failures**

In `handleOpenHostDiffity`, replace the `showError` property passed to `runHostDiffityOpenRequest` with:

```ts
showError: (report) =>
	showError({
		action: 'Diff',
		title: report.title,
		message: report.message,
		panePath: report.panePath,
		command: report.command,
		output: report.output,
		url: report.url,
	}),
```

The surrounding `runDiffityShare` callback should keep calling `runBrowserActionsDiffityShare`, which now returns the richer result.

- [ ] **Step 5: Update detected Open and Pick Browser action failures**

In `handleOpenDetected`, replace the `showError` property passed to `runDetectedOpenControllerRequest` with:

```ts
showError: (title, message) =>
	showError({
		action: mode === 'pick' ? 'Pick' : 'Open',
		title,
		message,
	}),
```

Keep `runDetectedOpenControllerRequest` unchanged.

- [ ] **Step 6: Update saved URL Browser action failures**

In `handleOpenHostUrlSlot`, introduce a pane path variable before the async `try` block:

```ts
let resolvedPanePath: string | undefined;
```

Inside the `try`, immediately after resolving the pane path, assign it:

```ts
const panePath = await resolveHostBrowserPanePath();
resolvedPanePath = panePath;
```

Replace the catch block call:

```ts
showError(
	`${getHostBrowserUrlSlotLabel(slot)} failed`,
	getErrorMessage(err),
);
```

with:

```ts
showError({
	action: getHostBrowserUrlSlotLabel(slot),
	title: `${getHostBrowserUrlSlotLabel(slot)} failed`,
	message: getErrorMessage(err),
	panePath: resolvedPanePath,
});
```

In `handleEditHostUrlSlot`, make the same `resolvedPanePath` change and replace:

```ts
showError(
	`Edit ${getHostBrowserUrlSlotLabel(slot)} failed`,
	getErrorMessage(err),
);
```

with:

```ts
showError({
	action: getHostBrowserUrlSlotLabel(slot),
	title: `Edit ${getHostBrowserUrlSlotLabel(slot)} failed`,
	message: getErrorMessage(err),
	panePath: resolvedPanePath,
});
```

- [ ] **Step 7: Run focused Browser action tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-action-error-report.test.ts test/integration/browser-action-error-alert.test.ts test/integration/shell-modals.test.ts test/integration/detected-open-actions.test.ts
```

Expected: PASS for formatter, alert helper, Diffity request runner, and detected-open controller tests.

- [ ] **Step 8: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 9: Commit Browser action wiring**

Run:

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/test/integration/browser-action-error-alert.test.ts apps/mobile/test/integration/browser-action-error-report.test.ts apps/mobile/test/integration/shell-modals.test.ts apps/mobile/src/lib/browser-action-error-alert.ts apps/mobile/src/lib/browser-action-error-report.ts
git commit -m "feat(mobile): copy browser action error reports"
```

## Task 5: Final Verification

**Files:**
- Verify: `apps/mobile/src/lib/browser-action-error-report.ts`
- Verify: `apps/mobile/src/lib/browser-action-error-alert.ts`
- Verify: `apps/mobile/src/lib/browser-actions-controller-actions.ts`
- Verify: `apps/mobile/src/lib/host-diffity-open-request.ts`
- Verify: `apps/mobile/src/lib/shell-modals.tsx`
- Verify: `apps/mobile/test/integration/browser-action-error-report.test.ts`
- Verify: `apps/mobile/test/integration/browser-action-error-alert.test.ts`
- Verify: `apps/mobile/test/integration/shell-modals.test.ts`

- [ ] **Step 1: Run all mobile integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS for the full integration test suite.

- [ ] **Step 2: Run mobile lint check**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS with no ESLint warnings or errors.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Review the final diff for scope**

Run:

```bash
git diff --stat HEAD
git diff -- apps/mobile/src/lib/browser-action-error-report.ts apps/mobile/src/lib/browser-action-error-alert.ts apps/mobile/src/lib/browser-actions-controller-actions.ts apps/mobile/src/lib/host-diffity-open-request.ts apps/mobile/src/lib/shell-modals.tsx apps/mobile/test/integration/browser-action-error-report.test.ts apps/mobile/test/integration/browser-action-error-alert.test.ts apps/mobile/test/integration/shell-modals.test.ts
```

Expected:

- Production changes are limited to Browser action error formatting, alert copy behavior, Diffity context, and controller error wiring.
- Test changes cover the new formatter, alert helper, and Diffity context.
- No generated files are changed.
- The existing unrelated `apps/mobile/android/app/src/main/res/values/strings.xml` worktree change is not included in these commits.

- [ ] **Step 5: Commit any verification-only fixes**

If Step 1, Step 2, or Step 3 required small fixes, commit only those files:

```bash
git add apps/mobile/src/lib apps/mobile/test/integration
git commit -m "fix(mobile): stabilize browser action error copy"
```

Expected: If no fixes were needed, skip this commit.
