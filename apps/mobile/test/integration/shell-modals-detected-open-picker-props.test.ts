import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const shellModalsSourcePath = join(process.cwd(), 'src/lib/shell-modals.tsx');
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
	const source = readFileSync(shellModalsSourcePath, 'utf8');

	assert.match(source, /export type DetectedOpenPickerModalProps = \{/);
	assert.match(
		source,
		/detectedOpenPickerProps: DetectedOpenPickerModalProps;/,
	);
	assert.match(
		source,
		/setDetectedOpenPickerState\(\{ candidates, context \}\);/,
	);
	assert.match(
		source,
		/const detectedOpenPickerProps = useMemo<DetectedOpenPickerModalProps>/,
	);
	assert.match(source, /runGuardedDetectedOpenPickerSelectionRequest\(\{/);
	assert.match(source, /hostDetectedOpenPickerSelectionRequestId\.next\(\)/);
	const handleOpenDetectedIndex = source.indexOf('const handleOpenDetected');
	const pickerInvalidationIndex = source.indexOf(
		'hostDetectedOpenPickerSelectionRequestId.invalidate();',
		handleOpenDetectedIndex,
	);
	const pickerClearIndex = source.indexOf(
		'setDetectedOpenPickerState(null);',
		handleOpenDetectedIndex,
	);
	const controllerRequestIndex = source.indexOf(
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

void test('browser actions controller cancels detected open work before other browser actions', () => {
	const source = readFileSync(shellModalsSourcePath, 'utf8');

	assert.match(source, /const resetDetectedOpenRequests = useCallback/);
	assert.match(source, /hostDetectedOpenRequestId\.invalidate\(\);/);
	assert.match(source, /hostDetectedOpenInFlightRef\.current = false;/);
	assert.match(
		source,
		/hostDetectedOpenPickerSelectionRequestId\.invalidate\(\);/,
	);

	assertCallBefore(
		source,
		'const handleOpenGitHubTarget = useCallback',
		'resetDetectedOpenRequests();',
		'runGitHubTargetOpenRequest({',
	);
	assertCallBefore(
		source,
		'const handleOpenHostDiffity = useCallback',
		'resetDetectedOpenRequests();',
		'runHostDiffityOpenRequest({',
	);
	assertCallBefore(
		source,
		'const handleOpenHostUrlSlot = useCallback',
		'resetDetectedOpenRequests();',
		'runHostUrlReadRequest({',
	);
	assertCallBefore(
		source,
		'const handleEditHostUrlSlot = useCallback',
		'resetDetectedOpenRequests();',
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
