import assert from 'node:assert/strict';
import test from 'node:test';
import { getTerminalKeyboardLongPressPopupItems } from '../../src/app/shell/components/TerminalKeyboardLongPressPopupModel';
import { getLongPressPopupLayout } from '../../src/lib/keyboard-long-press';
import { type KeyboardSlot } from '../../src/lib/shell-config';
import { getWorkKeyLongPressOptions } from '../../src/lib/work-key-long-press-options';

const workSlot: KeyboardSlot = {
	type: 'action',
	actionId: 'WORKMUX_NAV_NEXT',
	label: 'Work',
	icon: 'AppWindow',
	span: 2,
	longPress: {
		options: [
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_PREV',
				label: 'Prev',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_NEXT',
				label: 'Next',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
				label: 'Active',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
				label: '+Busy',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_SCOPE_ALL',
				label: 'All',
				icon: null,
			},
		],
	},
};

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
