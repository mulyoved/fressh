import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTerminalKeyboardLongPressPopup } from '../../src/app/shell/components/TerminalKeyboardLongPressController';
import { getTerminalKeyboardLongPressPopupItems } from '../../src/app/shell/components/TerminalKeyboardLongPressPopupModel';
import { getLongPressPopupLayout } from '../../src/lib/keyboard-long-press';
import { getWorkKeyLongPressOptions } from '../../src/lib/work-key-long-press-options';
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

void test('Work long-press open path uses latest nav scope at popup build time', () => {
	let currentNavScope: 'active' | 'visible' = 'active';
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
