import assert from 'node:assert/strict';
import test from 'node:test';
import { type DetectedOpenCandidate } from '../../src/lib/detected-open-actions';
import { createBrowserActionsModalProps } from '../../src/lib/shell-controllers/browser-actions-modal-props';

const candidate: DetectedOpenCandidate = {
	kind: 'remote-url',
	raw: 'https://example.test',
	normalized: 'https://example.test',
	display: 'Example',
	path: null,
	line: null,
	url: 'https://example.test',
};

void test('browser snapshot and commands map to all modal props', () => {
	const events: string[] = [];
	const callbacks = {
		close: () => events.push('close'),
		openDiff: () => events.push('diff'),
		openGitHubIssues: () => events.push('issues'),
		openGitHubPulls: () => events.push('pulls'),
		openDetectedAuto: () => {
			events.push('auto');
			return true;
		},
		openDetectedPick: () => {
			events.push('pick');
			return false;
		},
		openUrlSlot: (slot: string) => events.push(`open:${slot}`),
		editUrlSlot: (slot: string) => events.push(`edit:${slot}`),
		closeHostUrl: () => events.push('close-url'),
		submitHostUrl: (value: string) => events.push(`submit:${value}`),
		closeDetectedPicker: () => events.push('close-picker'),
		selectDetected: (selected: DetectedOpenCandidate) => {
			assert.equal(selected, candidate);
			events.push('select');
		},
	};
	const props = createBrowserActionsModalProps(
		{
			open: true,
			hostUrl: {
				mode: 'open-missing',
				slot: 'window-url',
				panePath: '/repo',
				initialValue: 'https://saved.test',
			},
			hostUrlSubmitting: true,
			hostUrlError: 'failed',
			detectedOpenPicker: {
				context: {
					paneId: '%1',
					paneTty: '/dev/pts/1',
					panePath: '/repo',
				},
				candidates: [candidate],
			},
		},
		callbacks,
	);

	assert.deepEqual(
		{
			open: props.browserActionsProps.open,
			hostOpen: props.hostUrlProps.open,
			slot: props.hostUrlProps.slot,
			slotLabel: props.hostUrlProps.slotLabel,
			initialValue: props.hostUrlProps.initialValue,
			mode: props.hostUrlProps.mode,
			isSubmitting: props.hostUrlProps.isSubmitting,
			error: props.hostUrlProps.error,
			pickerOpen: props.detectedOpenPickerProps.open,
			candidates: props.detectedOpenPickerProps.candidates,
		},
		{
			open: true,
			hostOpen: true,
			slot: 'window-url',
			slotLabel: 'URL',
			initialValue: 'https://saved.test',
			mode: 'open-missing',
			isSubmitting: true,
			error: 'failed',
			pickerOpen: true,
			candidates: [candidate],
		},
	);

	props.browserActionsProps.onClose();
	props.browserActionsProps.onOpenDiff();
	props.browserActionsProps.onOpenGitHubIssues();
	props.browserActionsProps.onOpenGitHubPulls();
	assert.equal(props.browserActionsProps.onOpenDetectedAuto(), true);
	assert.equal(props.browserActionsProps.onOpenDetectedPick(), false);
	props.browserActionsProps.onOpenUrlSlot('window-url');
	props.browserActionsProps.onEditUrlSlot('app-url');
	props.hostUrlProps.onClose();
	props.hostUrlProps.onSubmit('https://new.test');
	props.detectedOpenPickerProps.onClose();
	props.detectedOpenPickerProps.onSelect(candidate);
	assert.deepEqual(events, [
		'close',
		'diff',
		'issues',
		'pulls',
		'auto',
		'pick',
		'open:window-url',
		'edit:app-url',
		'close-url',
		'submit:https://new.test',
		'close-picker',
		'select',
	]);
});

void test('browser modal props use closed defaults', () => {
	const noop = () => {};
	const props = createBrowserActionsModalProps(
		{
			open: false,
			hostUrl: null,
			hostUrlSubmitting: false,
			hostUrlError: null,
			detectedOpenPicker: null,
		},
		{
			close: noop,
			openDiff: noop,
			openGitHubIssues: noop,
			openGitHubPulls: noop,
			openDetectedAuto: () => false,
			openDetectedPick: () => false,
			openUrlSlot: noop,
			editUrlSlot: noop,
			closeHostUrl: noop,
			submitHostUrl: noop,
			closeDetectedPicker: noop,
			selectDetected: noop,
		},
	);

	assert.equal(props.hostUrlProps.slot, null);
	assert.equal(props.hostUrlProps.slotLabel, 'URL');
	assert.equal(props.hostUrlProps.initialValue, '');
	assert.equal(props.hostUrlProps.mode, 'edit');
	assert.deepEqual(props.detectedOpenPickerProps.candidates, []);
});
