import {
	type KeyboardLongPressOption,
	type KeyboardSlot,
} from '@/lib/shell-config';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';

const WORKMUX_NAV_SCOPE_OVERRIDE_KEY = 'workmuxNavScopeOverride';
const WORKMUX_LONG_PRESS_SCOPE_BADGE_KEY = 'workmuxLongPressScopeBadge';

export const WORKMUX_NAV_SCOPE_LABEL: Record<WorkmuxNavScope, string> = {
	active: 'Active',
	visible: '+Busy',
	all: 'All',
};

export const WORKMUX_NAV_SCOPE_BADGE_LABEL: Record<WorkmuxNavScope, string> = {
	active: 'A',
	visible: '+B',
	all: '\u2200',
};

export type ResolvedKeyboardLongPressOption = KeyboardLongPressOption & {
	readonly [WORKMUX_NAV_SCOPE_OVERRIDE_KEY]?: WorkmuxNavScope;
	readonly [WORKMUX_LONG_PRESS_SCOPE_BADGE_KEY]?: WorkmuxNavScope;
};

type WorkmuxScopeActionId =
	| 'WORKMUX_NAV_SCOPE_ACTIVE'
	| 'WORKMUX_NAV_SCOPE_VISIBLE'
	| 'WORKMUX_NAV_SCOPE_ALL';

const WORKMUX_NAV_SCOPE_ACTION_IDS: readonly WorkmuxScopeActionId[] = [
	'WORKMUX_NAV_SCOPE_ACTIVE',
	'WORKMUX_NAV_SCOPE_VISIBLE',
	'WORKMUX_NAV_SCOPE_ALL',
];

export function widenWorkmuxNavScope(
	navScope: WorkmuxNavScope,
): WorkmuxNavScope {
	if (navScope === 'active') return 'visible';
	if (navScope === 'visible') return 'all';
	return 'all';
}

export function isWorkKeyNavSlot(slot: KeyboardSlot): boolean {
	return (
		slot.type === 'action' &&
		slot.actionId === 'WORKMUX_NAV_NEXT' &&
		slot.label === 'Work' &&
		slot.icon === 'AppWindow' &&
		slot.span === 2 &&
		hasRequiredScopeOptions(slot)
	);
}

export function getWorkKeyLongPressOptions(
	slot: KeyboardSlot,
	navScope: WorkmuxNavScope,
): readonly ResolvedKeyboardLongPressOption[] | null {
	if (!isWorkKeyNavSlot(slot)) return null;

	const widenedScope = widenWorkmuxNavScope(navScope);
	const configuredScopeOptions = getConfiguredScopeOptions(slot);

	return [
		createScopedNavOption('WORKMUX_NAV_PREV', 'Prev', navScope),
		createScopedNavOption('WORKMUX_NAV_PREV', 'Prev', widenedScope),
		createScopedNavOption('WORKMUX_NAV_NEXT', 'Next', widenedScope),
		...configuredScopeOptions,
	];
}

export function getWorkmuxNavScopeOverride(
	option: KeyboardLongPressOption,
): WorkmuxNavScope | undefined {
	const override = getMetadataValue(option, WORKMUX_NAV_SCOPE_OVERRIDE_KEY);
	return isWorkmuxNavScopeValue(override) ? override : undefined;
}

export function getWorkmuxLongPressScopeBadge(
	option: KeyboardLongPressOption,
): WorkmuxNavScope | null {
	const badge = getMetadataValue(option, WORKMUX_LONG_PRESS_SCOPE_BADGE_KEY);
	return isWorkmuxNavScopeValue(badge) ? badge : null;
}

function createScopedNavOption(
	actionId: 'WORKMUX_NAV_PREV' | 'WORKMUX_NAV_NEXT',
	directionLabel: 'Prev' | 'Next',
	navScope: WorkmuxNavScope,
): ResolvedKeyboardLongPressOption {
	return {
		type: 'action',
		actionId,
		label: `${directionLabel} ${WORKMUX_NAV_SCOPE_LABEL[navScope]}`,
		icon: null,
		[WORKMUX_NAV_SCOPE_OVERRIDE_KEY]: navScope,
		[WORKMUX_LONG_PRESS_SCOPE_BADGE_KEY]: navScope,
	};
}

function getConfiguredScopeOptions(
	slot: KeyboardSlot,
): readonly ResolvedKeyboardLongPressOption[] {
	const options = slot.longPress?.options ?? [];
	const scopeActionIds = new Set<string>(WORKMUX_NAV_SCOPE_ACTION_IDS);

	return options.filter(
		(option): option is ResolvedKeyboardLongPressOption =>
			option.type === 'action' && scopeActionIds.has(option.actionId),
	);
}

function hasRequiredScopeOptions(slot: KeyboardSlot): boolean {
	const configuredScopeActionIds = new Set(
		(slot.longPress?.options ?? [])
			.filter((option) => option.type === 'action')
			.map((option) => option.actionId),
	);

	return WORKMUX_NAV_SCOPE_ACTION_IDS.every((actionId) =>
		configuredScopeActionIds.has(actionId),
	);
}

function getMetadataValue(
	option: KeyboardLongPressOption,
	key: typeof WORKMUX_NAV_SCOPE_OVERRIDE_KEY | typeof WORKMUX_LONG_PRESS_SCOPE_BADGE_KEY,
): unknown {
	return (option as Record<string, unknown>)[key];
}

function isWorkmuxNavScopeValue(value: unknown): value is WorkmuxNavScope {
	return value === 'active' || value === 'visible' || value === 'all';
}
