import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { findRawNativeDiagnosticInvocations } from '../helpers/raw-native-diagnostic-ownership';

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...collectSourceFiles(path));
			continue;
		}
		if (/\.(ts|tsx)$/.test(path)) files.push(path);
	}
	return files;
}

void test('mobile app command code does not call direct tmux helpers', () => {
	const root = resolve(import.meta.dirname, '../../src');
	const directMuxBoundary = 'lib/workmux-direct-tmux-control.ts';
	const forbidden = [
		{ pattern: /\btmux\s+display-message\b/, boundaryAllowed: false },
		{ pattern: /\btmux\s+send-keys\b/, boundaryAllowed: true },
		{ pattern: /\btmux\s+copy-mode\b/, boundaryAllowed: true },
		{ pattern: /\binvoke-rc\.bash\b/, boundaryAllowed: false },
	];
	const offenders: string[] = [];

	for (const file of collectSourceFiles(root)) {
		const source = readFileSync(file, 'utf8');
		const relativePath = relative(root, file);
		for (const { pattern, boundaryAllowed } of forbidden) {
			if (!pattern.test(source)) continue;
			if (boundaryAllowed && relativePath === directMuxBoundary) continue;
			offenders.push(`${file}: ${pattern}`);
		}
	}

	assert.deepEqual(offenders, []);
});

void test('raw Workmux factory and diagnostic ownership stay confined to the session boundary', () => {
	const root = resolve(import.meta.dirname, '../../src');
	const allowed = new Set([
		'lib/auto-connect-store.ts',
		'lib/shell-controllers/session-workmux.ts',
		'lib/shell-controllers/session.tsx',
		'lib/workmux-control-channel.ts',
	]);
	const patterns = [
		/\bcreateWorkmuxControlChannel\b/,
		/\bactiveDiagnosticTrace\b/,
	];
	const offenders: string[] = [];
	for (const file of collectSourceFiles(root)) {
		const relativePath = relative(root, file);
		if (allowed.has(relativePath)) continue;
		const source = readFileSync(file, 'utf8');
		if (patterns.some((pattern) => pattern.test(source))) {
			offenders.push(relativePath);
		}
	}
	assert.deepEqual(offenders, []);
});

void test('raw native output diagnostic calls stay confined to the session adapter', () => {
	const root = resolve(import.meta.dirname, '../../src');
	const offenders: string[] = [];
	for (const file of collectSourceFiles(root)) {
		const relativePath = relative(root, file);
		if (relativePath === 'lib/shell-controllers/session-terminal-source.ts') {
			continue;
		}
		for (const invocation of findRawNativeDiagnosticInvocations(
			readFileSync(file, 'utf8'),
		)) {
			offenders.push(`${relativePath}:${invocation}`);
		}
	}
	assert.deepEqual(offenders, []);
});

void test('raw native diagnostic ownership matcher detects calls but ignores definitions and types', () => {
	const fixture = readFileSync(
		resolve(
			import.meta.dirname,
			'../fixtures/architecture/raw-native-diagnostic-offender.ts.txt',
		),
		'utf8',
	);
	assert.deepEqual(findRawNativeDiagnosticInvocations(fixture), [
		'bufferStats',
		'currentSeq',
	]);
});

void test('public shell contracts expose typed final ports without raw compatibility vocabulary', () => {
	const root = resolve(import.meta.dirname, '../../src/lib/shell-controllers');
	const sessionContracts = readFileSync(
		join(root, 'session-contracts.ts'),
		'utf8',
	);
	const keyboardContracts = readFileSync(
		join(root, 'keyboard-remote-contracts.ts'),
		'utf8',
	);
	const terminalContracts = readFileSync(
		join(root, 'terminal-contracts.ts'),
		'utf8',
	);
	assert.doesNotMatch(
		sessionContracts,
		/WorkmuxControl(?:Channel|CommandResult|Connection)/,
	);
	assert.doesNotMatch(sessionContracts, /ShellSessionWorkmuxInput/);
	assert.match(keyboardContracts, /workmux: ShellWorkmuxPort/);
	assert.doesNotMatch(keyboardContracts, /workmuxControlChannel/);
	assert.match(terminalContracts, /export type ShellTerminalViewPort = \{/);
	assert.doesNotMatch(terminalContracts, /terminal-hook-runtime/);
});

void test('typed outcome consumers use the shared exhaustive decoder', () => {
	const root = resolve(import.meta.dirname, '../../src/lib');
	for (const [file, importPattern] of [
		[
			'host-command-router.ts',
			/from '.\/shell-controllers\/controller-outcome'/,
		],
		[
			'shell-controllers/browser-actions-adapter.ts',
			/from '.\/controller-outcome'/,
		],
		[
			'shell-controllers/feature-request-core.ts',
			/from '.\/controller-outcome'/,
		],
		['shell-controllers/notifications-core.ts', /from '.\/controller-outcome'/],
		[
			'keyboard-actions.ts',
			/from '@\/lib\/shell-controllers\/controller-outcome'/,
		],
		[
			'shell-controllers/keyboard-remote-core.ts',
			/from '.\/controller-outcome'/,
		],
		[
			'shell-controllers/skill-selector-adapter.ts',
			/from '.\/controller-outcome'/,
		],
		[
			'shell-controllers/skill-selector-core.ts',
			/from '.\/controller-outcome'/,
		],
		[
			'shell-controllers/worktree-workspace-adapter.ts',
			/from '.\/controller-outcome'/,
		],
		[
			'terminal-fit-runner.ts',
			/from '.\/shell-controllers\/controller-outcome'/,
		],
		[
			'workmux-scrollback-executor.ts',
			/from '.\/shell-controllers\/controller-outcome'/,
		],
	] as const) {
		assert.match(readFileSync(join(root, file), 'utf8'), importPattern, file);
	}
});

void test('Workmux scrollback uses only the typed session scroll port', () => {
	const root = resolve(import.meta.dirname, '../../src/lib');
	const executor = readFileSync(
		join(root, 'workmux-scrollback-executor.ts'),
		'utf8',
	);
	const core = readFileSync(
		join(root, 'shell-controllers/scrollback-core.ts'),
		'utf8',
	);
	const sessionWorkmux = readFileSync(
		join(root, 'shell-controllers/session-workmux.ts'),
		'utf8',
	);
	assert.match(executor, /scrollTransport: ShellWorkmuxScrollPort/);
	assert.doesNotMatch(executor, /WorkmuxControlChannel\['scroll'\]/);
	assert.doesNotMatch(executor, /WorkmuxScrollbackCommandResult/);
	assert.doesNotMatch(core, /toExecutorResult/);
	assert.doesNotMatch(sessionWorkmux, /runScroll/);
});

void test('keyboard modules use canonical terminal views and exhaustive decoders', () => {
	const root = resolve(import.meta.dirname, '../../src/lib');
	for (const file of collectSourceFiles(join(root, 'shell-controllers'))) {
		const relativePath = relative(root, file);
		if (!relativePath.includes('keyboard')) continue;
		const source = readFileSync(file, 'utf8');
		assert.doesNotMatch(
			source,
			/from '.\/terminal-hook-runtime'/,
			relativePath,
		);
		assert.doesNotMatch(source, /ShellTerminalRuntimeView/, relativePath);
	}
	for (const file of [
		'keyboard-actions.ts',
		'shell-controllers/keyboard-remote-core.ts',
	]) {
		const source = readFileSync(join(root, file), 'utf8');
		assert.match(source, /matchControllerOutcome/);
		assert.doesNotMatch(source, /switch \((?:outcome|result)\.status\)/);
	}
});
