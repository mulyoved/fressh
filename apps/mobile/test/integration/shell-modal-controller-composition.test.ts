import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function extractBlock(source: string, start: string, end: string): string {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `missing block start: ${start}`);
	const endIndex = source.indexOf(end, startIndex);
	assert.notEqual(endIndex, -1, `missing block end: ${end}`);
	return source.slice(startIndex, endIndex);
}

void test('shell detail composes focused modal controllers without shell-modals', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	const browserBlock = extractBlock(
		source,
		'const browserActions = useBrowserActionsController',
		'const manualTerminalFitRunner',
	);
	const featureBlock = extractBlock(
		source,
		'const featureRequest = useFeatureRequestController',
		'const markFeatureRequestSourceStale',
	);
	const skillBlock = extractBlock(
		source,
		'const skillSelector = useSkillSelectorController',
		'const pendingKeyboardLatePublication',
	);
	assert.match(source, /shell-controllers\/browser-actions/);
	assert.match(source, /shell-controllers\/feature-request/);
	assert.match(source, /shell-controllers\/skill-selector/);
	assert.match(source, /shell-controllers\/simple-modals/);
	assert.match(source, /createShellModalArbiter/);
	assert.match(source, /createShellTransportKey\(connectionId, channelId\)/);
	assert.match(source, /createShellTargetKey\(transportKey, tmuxTarget\)/);
	assert.match(source, /useShellSimpleModals\(modalArbiter\)/);
	assert.match(browserBlock, /sourceKey: targetKey/);
	assert.match(browserBlock, /arbiter: modalArbiter/);
	assert.match(featureBlock, /arbiter: modalArbiter/);
	assert.match(skillBlock, /tmuxEnabled/);
	assert.match(skillBlock, /sourceKey: targetKey/);
	assert.match(skillBlock, /arbiter: modalArbiter/);
	assert.match(
		skillBlock,
		/sendTextRaw: keyboard\.commanderProps\.onPasteText/,
	);
	assert.match(
		source,
		/\(\) => modalArbiter\.register\('text-entry', handleCloseTextEntry\)/,
	);
	assert.doesNotMatch(source, /from '@\/lib\/shell-modals'/);
	assert.match(
		source,
		/keyboardPublication\.prepareLateBindings\(\{\s*skillSelector,/,
	);
	assert.doesNotMatch(
		source,
		/featureRequestCloseRef|close\w+OtherModals|sourceKeyChangeTrackerRef|skillSelectorSourceKey/,
	);
	assert.equal(
		existsSync(join(process.cwd(), 'src/lib/shell-modals.tsx')),
		false,
	);
});

void test('shell detail tracks tmux-only lifecycle changes separately from target identity', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/app/shell/detail.tsx'),
		'utf8',
	);
	const skillSource = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/skill-selector.tsx'),
		'utf8',
	);
	const browserSource = readFileSync(
		join(process.cwd(), 'src/lib/shell-controllers/browser-actions.tsx'),
		'utf8',
	);

	assert.match(
		skillSource,
		/syncControllerSource\(\{[\s\S]*?dependencies: deps,[\s\S]*?core,[\s\S]*?\}\)/,
	);
	assert.match(
		browserSource,
		/syncControllerSource\(\{[\s\S]*?dependencies: deps,[\s\S]*?core,[\s\S]*?\}\)/,
	);
	assert.match(
		source,
		/markFeatureRequestSourceStale\(\);\s*\}, \[connection, markFeatureRequestSourceStale, targetKey, tmuxEnabled\]\)/,
	);
	assert.match(source, /^\s*targetKey,\s*$/m);
	assert.match(source, /^\s*tmuxEnabled,\s*$/m);
	assert.match(source, /^\s*source: connection,\s*$/m);
	assert.match(source, /remote:\s*\{[\s\S]*?source: connection,/);
	assert.doesNotMatch(
		source,
		/syncShellCommandLifecycle|workmuxKeyboardCommandRunner/,
	);
	assert.equal(
		existsSync(
			join(
				process.cwd(),
				'src/lib/shell-controllers/browser-actions-lifecycle.ts',
			),
		),
		false,
	);
	assert.equal(
		existsSync(
			join(
				process.cwd(),
				'src/lib/shell-controllers/skill-selector-lifecycle.ts',
			),
		),
		false,
	);
});
