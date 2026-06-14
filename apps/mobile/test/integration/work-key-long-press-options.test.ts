import assert from 'node:assert/strict';
import test from 'node:test';
import {
	type KeyboardLongPressOption,
	type KeyboardSlot,
} from '../../src/lib/shell-config';
import {
	getWorkKeyLongPressOptions,
	getWorkmuxLongPressScopeBadge,
	getWorkmuxNavScopeOverride,
	isWorkKeyNavSlot,
	widenWorkmuxNavScope,
} from '../../src/lib/work-key-long-press-options';

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

function summarize(options: readonly KeyboardLongPressOption[]) {
	return options.map((option) => {
		assert.equal(option.type, 'action');
		return {
			actionId: option.actionId,
			label: option.label,
			override: getWorkmuxNavScopeOverride(option),
			badge: getWorkmuxLongPressScopeBadge(option),
		};
	});
}

void test('widenWorkmuxNavScope caps the mode ladder at all', () => {
	assert.equal(widenWorkmuxNavScope('active'), 'visible');
	assert.equal(widenWorkmuxNavScope('visible'), 'all');
	assert.equal(widenWorkmuxNavScope('all'), 'all');
});

void test('isWorkKeyNavSlot only matches the actual Work nav slot shape', () => {
	assert.equal(isWorkKeyNavSlot(workSlot), true);
	assert.equal(
		isWorkKeyNavSlot({
			...workSlot,
			label: 'Next',
		}),
		false,
	);
	assert.equal(
		isWorkKeyNavSlot({
			...workSlot,
			actionId: 'WORKMUX_NAV_PREV',
		}),
		false,
	);
});

void test('Work key options for active mode include previous active and widened busy nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'active');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev Active',
			override: 'active',
			badge: 'active',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev +Busy',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next +Busy',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: 'Active',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: '+Busy',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: 'All',
			override: undefined,
			badge: null,
		},
	]);
});

void test('Work key options for visible mode include previous busy and widened all nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'visible');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev +Busy',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: 'Active',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: '+Busy',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: 'All',
			override: undefined,
			badge: null,
		},
	]);
});

void test('Work key options for all mode repeat all for widened nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'all');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next All',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
			label: 'Active',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
			label: '+Busy',
			override: undefined,
			badge: null,
		},
		{
			actionId: 'WORKMUX_NAV_SCOPE_ALL',
			label: 'All',
			override: undefined,
			badge: null,
		},
	]);
});

void test('non-Work long-press menus are left to their configured options', () => {
	const options = getWorkKeyLongPressOptions(
		{
			type: 'bytes',
			bytes: [27, 91, 68],
			label: 'ARROW_LEFT',
			icon: 'ArrowLeft',
			longPress: {
				options: [
					{
						type: 'bytes',
						bytes: [27, 91, 68],
						label: 'ARROW_LEFT',
						icon: 'ArrowLeft',
					},
				],
			},
		},
		'active',
	);

	assert.equal(options, null);
});
