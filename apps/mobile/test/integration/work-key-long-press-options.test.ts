import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getKeyboardActionRunOptions,
	runKeyboardActionSlot,
} from '../../src/lib/keyboard-action-run-options';
import {
	type KeyboardLongPressOption,
	type KeyboardSlot,
} from '../../src/lib/shell-config';
import {
	getWorkKeyLongPressOptions,
	getWorkmuxLongPressScopeBadge,
	getWorkmuxNavScopeOverride,
	getWorkmuxScopeForActionId,
	isWorkKeyNavSlot,
	widenWorkmuxNavScope,
} from '../../src/lib/work-key-long-press-options';
import { createWorkNavigationSlot } from './helpers/work-key-fixtures';

const workSlot = createWorkNavigationSlot();

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

void test('getWorkmuxScopeForActionId resolves only scope setter actions', () => {
	assert.equal(getWorkmuxScopeForActionId('WORKMUX_NAV_SCOPE_ACTIVE'), 'active');
	assert.equal(getWorkmuxScopeForActionId('WORKMUX_NAV_SCOPE_VISIBLE'), 'visible');
	assert.equal(getWorkmuxScopeForActionId('WORKMUX_NAV_SCOPE_ALL'), 'all');
	assert.equal(getWorkmuxScopeForActionId('WORKMUX_NAV_NEXT'), null);
	assert.equal(getWorkmuxScopeForActionId('OPEN_ADVANCED_KEYBOARD'), null);
	assert.equal(getWorkmuxScopeForActionId('toString'), null);
});

void test('isWorkKeyNavSlot matches the Work nav behavior and ignores presentation', () => {
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
	assert.equal(
		isWorkKeyNavSlot({
			...workSlot,
			icon: null,
			span: 1,
		}),
		true,
	);
});

void test('Work-shaped slots missing required scope setters do not resolve dynamic options', () => {
	const partialScopeWorkSlot: KeyboardSlot = {
		...workSlot,
		longPress: {
			options: workSlot.longPress!.options.filter(
				(option) =>
					option.type !== 'action' ||
					option.actionId !== 'WORKMUX_NAV_SCOPE_ALL',
			),
		},
	};

	assert.equal(isWorkKeyNavSlot(partialScopeWorkSlot), false);
	assert.equal(getWorkKeyLongPressOptions(partialScopeWorkSlot, 'active'), null);
});

void test('Work key options for active mode include previous active and widened busy nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'active');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev',
			override: 'active',
			badge: 'active',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next',
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
			label: 'Prev',
			override: 'visible',
			badge: 'visible',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next',
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

void test('keyboard action run options forward Work long-press scope metadata', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'visible');
	assert.ok(options);

	assert.deepEqual(getKeyboardActionRunOptions(options[1]!), {
		workmuxNavScopeOverride: 'all',
	});
	assert.deepEqual(getKeyboardActionRunOptions(options[3]!), {
		workmuxNavScopeOverride: undefined,
	});
});

void test('keyboard action slot runner forwards action id and Work scope metadata together', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'visible');
	assert.ok(options);
	const option = options[1]!;
	assert.equal(option.type, 'action');
	const handled: { actionId: string; override: unknown }[] = [];

	runKeyboardActionSlot(option, (actionId, runOptions) => {
		handled.push({
			actionId,
			override: runOptions.workmuxNavScopeOverride,
		});
	});

	assert.deepEqual(handled, [
		{
			actionId: 'WORKMUX_NAV_PREV',
			override: 'all',
		},
	]);
});

void test('Work key options for all mode repeat all for widened nav', () => {
	const options = getWorkKeyLongPressOptions(workSlot, 'all');
	assert.ok(options);
	assert.deepEqual(summarize(options), [
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_PREV',
			label: 'Prev',
			override: 'all',
			badge: 'all',
		},
		{
			actionId: 'WORKMUX_NAV_NEXT',
			label: 'Next',
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
