import React from 'react';
import { Text, View } from 'react-native';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { type AppTheme } from '@/lib/theme';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import {
	getTerminalKeyboardLongPressPopupItems,
	type LongPressPopupRenderState,
} from './TerminalKeyboardLongPressPopupModel';

export function TerminalKeyboardLongPressPopup({
	popup,
	navScope,
	theme,
}: {
	popup: LongPressPopupRenderState;
	navScope: WorkmuxNavScope;
	theme: AppTheme;
}) {
	const items = getTerminalKeyboardLongPressPopupItems({ popup, navScope });

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
			{items.map((item) => {
				const OptionIcon = resolveLucideIcon(item.icon);
				return (
					<View
						key={item.key}
						style={{
							width: item.width,
							alignItems: 'center',
							justifyContent: 'center',
							paddingHorizontal: 6,
							backgroundColor: item.highlighted
								? theme.colors.primary
								: item.isCurrentScope
									? theme.colors.border
									: 'transparent',
						}}
					>
						{item.badgeLabel ? (
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
									{item.badgeLabel}
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
							{item.label}
						</Text>
					</View>
				);
			})}
		</View>
	);
}
