import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const readSource = (path: string) =>
	readFileSync(join(process.cwd(), path), 'utf8');

const detail = readSource('src/app/shell/detail.tsx');
const session = readSource('src/lib/shell-controllers/session.tsx');
const sessionTarget = readSource(
	'src/lib/shell-controllers/session-target-owner.ts',
);
const sessionWorkmux = readSource(
	'src/lib/shell-controllers/session-workmux.ts',
);
const remoteCopyModeOwner = readSource(
	'src/lib/shell-controllers/scrollback-remote-copy-mode-owner.ts',
);
const terminalViewPolicy = readSource(
	'src/app/shell/use-shell-terminal-view-policy.ts',
);
const view = readSource('src/app/shell/ShellScreenView.tsx');

void describe('shell detail typed Workmux ownership', () => {
	void test('delegates raw Workmux creation, diagnostics, and disposal to the session owners', () => {
		assert.match(detail, /useShellSessionController\(\{/);
		assert.match(detail, /const \{ snapshot, ports, identity, tmux,/);
		assert.doesNotMatch(detail, /createWorkmuxControlChannel/);
		assert.doesNotMatch(detail, /disposeWorkmuxControlChannelAfterCleanup/);
		assert.doesNotMatch(detail, /useSshStore|useAutoConnectStore/);

		assert.match(sessionWorkmux, /createWorkmuxControlChannel/);
		assert.match(
			sessionWorkmux,
			/owned\.channel\.prepareDispose\(\{ reason \}\)/,
		);
		assert.match(
			sessionWorkmux,
			/await owned\.channel\?\.dispose\(\{ reason \}\)/,
		);
		assert.match(session, /createShellDiagnosticPort\(\{/);
		assert.match(session, /createShellTargetOwner\(\{/);
		assert.match(sessionTarget, /workmuxOwner\.replace\(/);
		assert.ok(
			session.indexOf('useLayoutEffect(() => lifecycle.setup()') <
				session.indexOf('targetOwner.activate()'),
			'lifecycle disposal authority must register before Workmux activation',
		);
		assert.doesNotMatch(session, /useEffect\(\(\) => lifecycle\.setup\(\)/);
	});

	void test('routes scrollback through the typed Workmux port and remote copy owner', () => {
		assert.match(
			detail,
			/useShellScrollbackController\(\{[\s\S]*?workmux: ports\.workmux,/,
		);
		assert.match(
			remoteCopyModeOwner,
			/desiredContext\.workmux\.registerBeforeDispose\(/,
		);
		assert.doesNotMatch(detail, /executeWorkmuxScrollbackRemoteCommand/);
		assert.doesNotMatch(
			detail,
			/buildWorkmuxAppScroll(?:Enter|Exit|Line|Page)Command/,
		);
	});

	void test('shares typed session ports with notifications, browser actions, keyboard, and Worktree', () => {
		assert.match(
			detail,
			/useShellNotificationsController\(\{[\s\S]*?workmux: ports\.workmux,/,
		);
		assert.match(
			detail,
			/useBrowserActionsController\(\{[\s\S]*?workmux: ports\.workmux,/,
		);
		assert.match(
			detail,
			/remoteTarget: \{[\s\S]*?workmux: ports\.workmux,[\s\S]*?hostCommands: connection,/,
		);
		assert.match(
			detail,
			/useWorktreeWorkspaceController\(\{[\s\S]*?workmux: session\.ports\.workmux,/,
		);
	});

	void test('retains touch-scroll policy, diagnostic UI actions, and view-owned Worktree modal composition', () => {
		assert.match(terminalViewPolicy, /resolveShellTouchScrollPolicy\(\{/);
		assert.match(
			view,
			/touchScrollConfig=\{terminal\.policy\.touchScrollConfig\}/,
		);
		assert.match(detail, /useConnectionDebugCommand\(\{/);
		assert.match(detail, /props: keyboard\.commandMenuProps/);
		assert.equal(detail.match(/useWorktreeWorkspaceController\(/g)?.length, 1);
		assert.equal(view.match(/<WorktreeWorkspaceModal\b/g)?.length, 1);
	});
});
