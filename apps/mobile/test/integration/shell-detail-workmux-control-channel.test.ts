import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const readSource = (path: string) =>
	readFileSync(join(process.cwd(), path), 'utf8');

const detail = readSource('src/app/shell/detail.tsx');
const session = readSource('src/lib/shell-controllers/session.tsx');
const sessionWorkmux = readSource(
	'src/lib/shell-controllers/session-workmux.ts',
);
const scrollbackRetirement = readSource(
	'src/lib/shell-controllers/scrollback-retirement-registration.ts',
);

void describe('shell detail typed Workmux ownership', () => {
	void test('delegates raw Workmux creation, diagnostics, and disposal to the session owner', () => {
		assert.match(detail, /useShellSessionController\(\{/);
		assert.match(detail, /const workmuxControlChannel = ports\.workmux/);
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
		assert.match(session, /workmuxOwner\.replace\(/);
		assert.ok(
			session.indexOf('useLayoutEffect(() => lifecycle.setup()') <
				session.indexOf('workmuxOwner.activate()'),
			'lifecycle disposal authority must register before Workmux activation',
		);
		assert.doesNotMatch(session, /useEffect\(\(\) => lifecycle\.setup\(\)/);
	});

	void test('routes scrollback through the typed Workmux port and retirement registration', () => {
		assert.match(
			detail,
			/useShellScrollbackController\(\{[\s\S]*?workmux: workmuxControlChannel,/,
		);
		assert.match(
			scrollbackRetirement,
			/context\.workmux\.registerBeforeDispose\(/,
		);
		assert.doesNotMatch(detail, /executeWorkmuxScrollbackRemoteCommand/);
		assert.doesNotMatch(
			detail,
			/buildWorkmuxAppScroll(?:Enter|Exit|Line|Page)Command/,
		);
	});

	void test('shares the typed session ports with notifications, browser actions, keyboard, and Worktree', () => {
		assert.match(
			detail,
			/useShellNotificationsController\(\{[\s\S]*?workmux: workmuxControlChannel,/,
		);
		assert.match(
			detail,
			/useBrowserActionsController\(\{[\s\S]*?workmux: workmuxControlChannel,/,
		);
		assert.match(
			detail,
			/remote: \{[\s\S]*?workmux: workmuxControlChannel,[\s\S]*?hostCommands: connection,/,
		);
		assert.match(
			detail,
			/useWorktreeWorkspaceController\(\{[\s\S]*?workmux: workmuxControlChannel,/,
		);
	});

	void test('retains touch-scroll policy, diagnostic UI actions, and Worktree modal composition', () => {
		assert.match(detail, /resolveShellTouchScrollPolicy\(\{/);
		assert.match(
			detail,
			/scrollback:\s*remoteTouchScrollPolicy\.xtermScrollback/,
		);
		assert.match(
			detail,
			/touchScrollConfig=\{remoteTouchScrollPolicy\.touchScrollConfig\}/,
		);
		assert.match(detail, /useConnectionDebugCommand\(\{/);
		assert.match(detail, /\{\.\.\.keyboard\.commandMenuProps\}/);
		assert.equal(detail.match(/useWorktreeWorkspaceController\(/g)?.length, 1);
		assert.equal(detail.match(/<WorktreeWorkspaceModal\b/g)?.length, 1);
	});
});
