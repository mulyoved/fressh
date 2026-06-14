import React from 'react';
import { Text, View } from 'react-native';
import type { LongPressPopupLayout } from '@/lib/keyboard-long-press';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import type { KeyboardSlot } from '@/lib/shell-config';
import type { AppTheme } from '@/lib/theme';
import {
	getWorkmuxLongPressScopeBadge,
	WORKMUX_NAV_SCOPE_BADGE_LABEL,
	type ResolvedKeyboardLongPressOption,
} from '@/lib/work-key-long-press-options';
import type { WorkmuxNavScope } from '@/lib/workmux-app-commands';

type LongPressPopupRenderState = {
	slot: KeyboardSlot;
	options: readonly ResolvedKeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};

const NAV_SCOPE_ACTION_TO_SCOPE: Record<string, WorkmuxNavScope> = {
	WORKMUX_NAV_SCOPE_ACTIVE: 'active',
	WORKMUX_NAV_SCOPE_VISIBLE: 'visible',
	WORKMUX_NAV_SCOPE_ALL: 'all',
};

export function TerminalKeyboardLongPressPopup({
	popup,
	navScope,
	theme,
}: {
	popup: LongPressPopupRenderState;
	navScope: WorkmuxNavScope;
	theme: AppTheme;
}) {
	return (
		<View
			pointerEvents="none"
			style={{
				position: 'absolute',
				left: popup.layout.left,
				top: popup.layout.top,
				width: popup.layout.width,
				height: popup.layout.height,
				flexDirection: 'row',
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.borderStrong,
				backgroundColor: theme.colors.surface,
				overflow: 'hidden',
				shadowColor: '#000',
				shadowOpacity: 0.25,
				shadowRadius: 8,
				shadowOffset: { width: 0, height: 3 },
				elevation: 6,
			}}
		>
			{popup.options.map((option, index) => {
				const OptionIcon = resolveLucideIcon(option.icon);
				const highlighted = popup.highlightedIndex === index;
				const scopeBadge = getWorkmuxLongPressScopeBadge(option);
				const optionScope =
					option.type === 'action'
						? NAV_SCOPE_ACTION_TO_SCOPE[option.actionId]
						: undefined;
				const isCurrentScope =
					optionScope !== undefined && optionScope === navScope;
				return (
					<View
						key={`${option.type}-${option.label}-${index.toString()}`}
						style={{
							width: popup.layout.optionWidth,
							alignItems: 'center',
							justifyContent: 'center',
							paddingHorizontal: 6,
							backgroundColor: highlighted
								? theme.colors.primary
								: isCurrentScope
									? theme.colors.border
									: 'transparent',
						}}
					>
						{scopeBadge ? (
							<View
								style={{
									position: 'absolute',
									top: 4,
									left: 4,
									paddingHorizontal: 3,
									borderRadius: 4,
									backgroundColor: theme.colors.primary,
								}}
							>
								<Text
									style={{
										color: theme.colors.textPrimary,
										fontSize: 8,
										lineHeight: 10,
										fontWeight: '700',
									}}
								>
									{WORKMUX_NAV_SCOPE_BADGE_LABEL[scopeBadge]}
								</Text>
							</View>
						) : null}
						{OptionIcon ? (
							<OptionIcon color={theme.colors.textPrimary} size={16} />
						) : null}
						<Text
							numberOfLines={1}
							style={{
								color: theme.colors.textPrimary,
								fontSize: 10,
								lineHeight: 12,
								marginTop: OptionIcon ? 2 : 0,
							}}
						>
							{option.label}
						</Text>
					</View>
				);
			})}
		</View>
	);
}
