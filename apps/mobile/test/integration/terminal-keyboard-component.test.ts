import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activateTerminalKeyboardLongPressMount,
	buildTerminalKeyboardLongPressPopup,
	createTerminalKeyboardLongPressMeasureCallback,
	deactivateTerminalKeyboardLongPressMount,
	type TerminalKeyboardLongPressPopupState,
} from '../../src/app/shell/components/TerminalKeyboardLongPressController';
import { getTerminalKeyboardLongPressPopupItems } from '../../src/app/shell/components/TerminalKeyboardLongPressPopupModel';
import { getLongPressPopupLayout } from '../../src/lib/keyboard-long-press';
import { getWorkKeyLongPressOptions } from '../../src/lib/work-key-long-press-options';
import { type WorkmuxNavScope } from '../../src/lib/workmux-app-commands';
import { createWorkNavigationSlot } from './helpers/work-key-fixtures';

const workSlot = createWorkNavigationSlot();

void test('Work long-press popup items render dynamic visible-scope labels and badges', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'visible');
	assert.ok(options);

	const items = getTerminalKeyboardLongPressPopupItems({
		popup: {
			options,
			layout: getLongPressPopupLayout({
				keyboardWidth: 360,
				anchorX: 160,
				anchorY: 200,
				anchorWidth: 40,
				optionCount: options.length,
			}),
			highlightedIndex: null,
		},
		navScope: 'visible',
	});

	assert.deepEqual(
		items.map((item) => ({
			label: item.label,
			badgeLabel: item.badgeLabel,
			isCurrentScope: item.isCurrentScope,
		})),
		[
			{ label: 'Prev +Busy', badgeLabel: '+B', isCurrentScope: false },
			{ label: 'Prev All', badgeLabel: '\u2200', isCurrentScope: false },
			{ label: 'Next All', badgeLabel: '\u2200', isCurrentScope: false },
			{ label: 'Active', badgeLabel: null, isCurrentScope: false },
			{ label: '+Busy', badgeLabel: null, isCurrentScope: true },
			{ label: 'All', badgeLabel: null, isCurrentScope: false },
		],
	);
});

void test('Work long-press popup builder uses latest nav scope callback value', () => {
	let currentNavScope: WorkmuxNavScope = 'active';
	const getNavScope = () => currentNavScope;
	const openAfterLongPressDelay = () => buildTerminalKeyboardLongPressPopup({
		slot: workSlot,
		getNavScope,
		keyboardWidth: 525,
		keyboardBounds: { left: 0, top: 0, width: 525, height: 180 },
		anchorX: 200,
		anchorY: 120,
		anchorWidth: 80,
		pointerLocalX: 240,
		pointerLocalY: 130,
	});

	currentNavScope = 'visible';
	const popup = openAfterLongPressDelay();

	assert.ok(popup);
	assert.deepEqual(
		popup.options.slice(0, 3).map((option) => option.label),
		['Prev +Busy', 'Prev All', 'Next All'],
	);
});

void test('long-press popup builder preserves configured non-Work options', () => {
	const popup = buildTerminalKeyboardLongPressPopup({
		slot: {
			type: 'bytes',
			bytes: [27, 91, 68],
			label: 'ARROW_LEFT',
			icon: 'ArrowLeft',
			longPress: {
				options: [
					{
						type: 'bytes',
						bytes: [27, 91, 53, 126],
						label: 'PAGE_UP',
						icon: 'ChevronsUp',
					},
					{
						type: 'action',
						actionId: 'WORKMUX_NAV_PREV_ALL',
						label: 'Prev all',
						icon: null,
					},
				],
			},
		},
		getNavScope: () => 'visible',
		keyboardWidth: 360,
		keyboardBounds: { left: 0, top: 0, width: 360, height: 180 },
		anchorX: 120,
		anchorY: 120,
		anchorWidth: 48,
		pointerLocalX: 140,
		pointerLocalY: 130,
	});

	assert.ok(popup);
	assert.deepEqual(
		popup.options.map((option) => option.label),
		['PAGE_UP', 'Prev all'],
	);
});

void test('TerminalKeyboard measured open callback reads latest nav scope ref', () => {
	const keyRef = { current: null };
	const generation = 2;
	const navScopeRef: { current: WorkmuxNavScope } = { current: 'active' };
	const openedPopupRef: {
		current: TerminalKeyboardLongPressPopupState | null;
	} = { current: null };

	const openMeasuredKeyPopup = createTerminalKeyboardLongPressMeasureCallback({
		slot: workSlot,
		keyRef,
		generation,
		isMountedRef: { current: true },
		longPressGenerationRef: { current: generation },
		longPressGestureRef: {
			current: {
				slot: workSlot,
				keyRef,
				generation,
				currentPageX: 240,
				currentPageY: 130,
				longPressFired: true,
			},
		},
		keyboardRootWindowRef: { current: { x: 0, y: 0 } },
		keyboardBoundsRef: {
			current: { left: 0, top: 0, width: 525, height: 180 },
		},
		keyboardWidthRef: { current: 525 },
		navScopeRef,
		setLongPressPopup: (popup) => {
			openedPopupRef.current = popup;
		},
	});

	navScopeRef.current = 'visible';
	openMeasuredKeyPopup(200, 120, 80);

	const openedPopup = openedPopupRef.current;
	assert.ok(openedPopup);
	assert.deepEqual(
		openedPopup.options.slice(0, 3).map((option) => option.label),
		['Prev +Busy', 'Prev All', 'Next All'],
	);
});

void test('TerminalKeyboard measured open callback ignores stale generation while mounted', () => {
	const keyRef = { current: null };
	const generation = 3;
	const openedPopups: TerminalKeyboardLongPressPopupState[] = [];
	const openMeasuredKeyPopup = createTerminalKeyboardLongPressMeasureCallback({
		slot: workSlot,
		keyRef,
		generation,
		isMountedRef: { current: true },
		longPressGenerationRef: { current: generation + 1 },
		longPressGestureRef: {
			current: {
				slot: workSlot,
				keyRef,
				generation,
				currentPageX: 240,
				currentPageY: 130,
				longPressFired: true,
			},
		},
		keyboardRootWindowRef: { current: { x: 0, y: 0 } },
		keyboardBoundsRef: {
			current: { left: 0, top: 0, width: 525, height: 180 },
		},
		keyboardWidthRef: { current: 525 },
		navScopeRef: { current: 'visible' },
		setLongPressPopup: (popup) => {
			openedPopups.push(popup);
		},
	});

	openMeasuredKeyPopup(200, 120, 80);

	assert.deepEqual(openedPopups, []);
});

void test('TerminalKeyboard measured open callback resumes after mount ref is restored', () => {
	const keyRef = { current: null };
	const generation = 4;
	const isMountedRef = { current: false };
	const longPressGenerationRef = { current: generation - 1 };
	const longPressGestureRef = {
		current: null as {
			slot: typeof workSlot;
			keyRef: typeof keyRef;
			generation: number;
			currentPageX: number;
			currentPageY: number;
			longPressFired: boolean;
		} | null,
	};
	const openedPopups: TerminalKeyboardLongPressPopupState[] = [];
	const createOpenMeasuredKeyPopup = () =>
		createTerminalKeyboardLongPressMeasureCallback({
			slot: workSlot,
			keyRef,
			generation,
			isMountedRef,
			longPressGenerationRef,
			longPressGestureRef,
			keyboardRootWindowRef: { current: { x: 0, y: 0 } },
			keyboardBoundsRef: {
				current: { left: 0, top: 0, width: 525, height: 180 },
			},
			keyboardWidthRef: { current: 525 },
			navScopeRef: { current: 'visible' },
			setLongPressPopup: (popup) => {
				openedPopups.push(popup);
			},
		});

	createOpenMeasuredKeyPopup()(200, 120, 80);
	assert.equal(openedPopups.length, 0);

	activateTerminalKeyboardLongPressMount({ isMountedRef });
	longPressGenerationRef.current = generation;
	longPressGestureRef.current = {
		slot: workSlot,
		keyRef,
		generation,
		currentPageX: 240,
		currentPageY: 130,
		longPressFired: true,
	};
	createOpenMeasuredKeyPopup()(200, 120, 80);
	assert.equal(openedPopups.length, 1);
	assert.deepEqual(
		openedPopups[0]!.options.slice(0, 3).map((option) => option.label),
		['Prev +Busy', 'Prev All', 'Next All'],
	);

	deactivateTerminalKeyboardLongPressMount({
		isMountedRef,
		longPressGenerationRef,
		longPressGestureRef,
		clearPopup: () => {
			openedPopups.length = 0;
		},
	});
	assert.equal(isMountedRef.current, false);
	assert.equal(longPressGenerationRef.current, generation + 1);
	assert.equal(longPressGestureRef.current, null);
	assert.equal(openedPopups.length, 0);
});
