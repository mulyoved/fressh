import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

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
	const root = resolve(import.meta.dirname, '../../src/lib/shell-controllers');
	for (const file of [
		'browser-actions-adapter.ts',
		'feature-request-core.ts',
		'notifications-core.ts',
		'scrollback-core.ts',
		'skill-selector-adapter.ts',
		'skill-selector-core.ts',
	]) {
		assert.match(
			readFileSync(join(root, file), 'utf8'),
			/from '.\/controller-outcome'/,
			file,
		);
	}
});
