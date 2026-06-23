import { type LongPressPopupLayout } from '@/lib/keyboard-long-press';
import {
	getWorkmuxLongPressScopeBadge,
	getWorkmuxScopeForActionId,
	WORKMUX_NAV_SCOPE_BADGE_LABEL,
	type ResolvedKeyboardLongPressOption,
} from '@/lib/work-key-long-press-options';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';

export type LongPressPopupRenderState = {
	options: readonly ResolvedKeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};

export type TerminalKeyboardLongPressPopupItem = {
	key: string;
	label: string;
	icon: string | null;
	width: number;
	highlighted: boolean;
	badgeLabel: string | null;
	isCurrentScope: boolean;
};

export function getTerminalKeyboardLongPressPopupItems({
	popup,
	navScope,
}: {
	popup: LongPressPopupRenderState;
	navScope: WorkmuxNavScope;
}): TerminalKeyboardLongPressPopupItem[] {
	return popup.options.map((option, index) => {
		const scopeBadge = getWorkmuxLongPressScopeBadge(option);
		const optionScope =
			option.type === 'action'
				? getWorkmuxScopeForActionId(option.actionId)
				: null;

		return {
			key: `${option.type}-${option.label}-${index.toString()}`,
			label: option.label,
			icon: option.icon,
			width: popup.layout.optionWidth,
			highlighted: popup.highlightedIndex === index,
			badgeLabel: scopeBadge
				? WORKMUX_NAV_SCOPE_BADGE_LABEL[scopeBadge]
				: null,
			isCurrentScope: optionScope !== null && optionScope === navScope,
		};
	});
}
