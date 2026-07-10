import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	buildKeyedDetectedOpenCandidates,
	type DetectedOpenCandidate,
} from '../../src/lib/detected-open-actions';

const browserActionsHookSourcePath = join(
	process.cwd(),
	'src/lib/shell-controllers/browser-actions.tsx',
);
const browserActionsCoreSourcePath = join(
	process.cwd(),
	'src/lib/shell-controllers/browser-actions-core.ts',
);
const shellDetailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');

function assertCallBefore(
	source: string,
	startPattern: string,
	callPattern: string,
	nextPattern: string,
) {
	const startIndex = source.indexOf(startPattern);
	const callIndex = source.indexOf(callPattern, startIndex);
	const nextIndex = source.indexOf(nextPattern, startIndex);
	assert.notEqual(startIndex, -1);
	assert.notEqual(callIndex, -1);
	assert.notEqual(nextIndex, -1);
	assert.ok(callIndex < nextIndex);
}

void test('browser actions controller exposes detected open picker modal props', () => {
	const hookSource = readFileSync(browserActionsHookSourcePath, 'utf8');
	const coreSource = readFileSync(browserActionsCoreSourcePath, 'utf8');

	assert.match(
		hookSource,
		/export type \{[\s\S]*DetectedOpenPickerModalProps,[\s\S]*\} from '\.\/browser-actions-modal-props';/,
	);
	assert.match(
		hookSource,
		/detectedOpenPickerProps: DetectedOpenPickerModalProps;/,
	);
	assert.match(
		coreSource,
		/patch\(\{ detectedOpenPicker: \{ candidates, context \} \}\)/,
	);
	assert.match(
		hookSource,
		/const detectedOpenPickerProps = useMemo<DetectedOpenPickerModalProps>/,
	);
	assert.match(coreSource, /runGuardedDetectedOpenPickerSelectionRequest\(\{/);
	assert.match(
		coreSource,
		/hostDetectedOpenPickerSelectionRequestId\.next\(\)/,
	);
	const handleOpenDetectedIndex = coreSource.indexOf('openDetected: (mode)');
	const pickerInvalidationIndex = coreSource.indexOf(
		'hostDetectedOpenPickerSelectionRequestId.invalidate();',
		handleOpenDetectedIndex,
	);
	const pickerClearIndex = coreSource.indexOf(
		'patch({ detectedOpenPicker: null });',
		handleOpenDetectedIndex,
	);
	const controllerRequestIndex = coreSource.indexOf(
		'const result = runDetectedOpenControllerRequest({',
		handleOpenDetectedIndex,
	);
	assert.notEqual(handleOpenDetectedIndex, -1);
	assert.notEqual(pickerInvalidationIndex, -1);
	assert.notEqual(pickerClearIndex, -1);
	assert.notEqual(controllerRequestIndex, -1);
	assert.ok(pickerInvalidationIndex < controllerRequestIndex);
	assert.ok(pickerClearIndex < controllerRequestIndex);
});

void test('browser actions hook keeps its public open command void-returning', () => {
	const source = readFileSync(browserActionsHookSourcePath, 'utf8');

	assert.match(
		source,
		/export type BrowserActionsControllerHandle = \{[\s\S]*?open: \(\) => void;/,
	);
	assert.match(
		source,
		/const open = useCallback\(\(\) => void core\.open\(\), \[core\]\);/,
	);
});

void test('browser actions controller cancels detected open work before other browser actions', () => {
	const source = readFileSync(browserActionsCoreSourcePath, 'utf8');

	assert.match(source, /const resetDetectedOpen = \(\) =>/);
	assert.match(source, /hostDetectedOpenRequestId\.invalidate\(\);/);
	assert.match(source, /hostDetectedOpenInFlightRef\.current = false;/);
	assert.match(
		source,
		/hostDetectedOpenPickerSelectionRequestId\.invalidate\(\);/,
	);

	assertCallBefore(
		source,
		'openGitHubTarget: (target)',
		'resetDetectedOpen();',
		'runGitHubTargetOpenRequest({',
	);
	assertCallBefore(
		source,
		'openDiffity: ()',
		'resetDetectedOpen();',
		'runHostDiffityOpenRequest({',
	);
	assertCallBefore(
		source,
		"const readUrlSlot = (mode: 'open' | 'edit'",
		'resetDetectedOpen();',
		'runHostUrlReadRequest({',
	);
});

void test('shell detail renders detected open picker modal with browser action props', () => {
	const source = readFileSync(shellDetailSourcePath, 'utf8');

	assert.match(source, /import \{ BrowserActionsModal \}/);
	assert.match(source, /import \{ DetectedOpenPickerModal \}/);
	assert.match(source, /<DetectedOpenPickerModal/);
	assert.match(source, /\{\.\.\.browserActions\.detectedOpenPickerProps\}/);
});

void test('detected open picker keys stay unique for duplicate candidates', () => {
	const duplicate = {
		kind: 'remote-url',
		raw: 'remote-url:https://example.test:1',
		normalized: 'https://example.test',
		display: 'Example',
		path: null,
		line: null,
		url: 'https://example.test',
	} satisfies DetectedOpenCandidate;
	const candidates = [
		duplicate,
		duplicate,
		{
			kind: 'remote-url',
			raw: 'https://example.test',
			normalized: 'https://example.test',
			display: 'Example collision candidate',
			path: null,
			line: null,
			url: 'https://example.test',
		},
	] satisfies readonly DetectedOpenCandidate[];

	const keyedCandidates = buildKeyedDetectedOpenCandidates(candidates);
	const keys = keyedCandidates.map((candidate) => candidate.key);

	assert.equal(new Set(keys).size, candidates.length);
	assert.deepEqual(
		keyedCandidates.map((candidate) => candidate.candidate),
		candidates,
	);
});
