import { Pressable, Text, View } from 'react-native';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { useTheme } from '@/lib/theme';

const SCOPE_SEGMENTS: readonly { scope: WorkmuxNavScope; label: string }[] = [
	{ scope: 'active', label: 'Active' },
	{ scope: 'visible', label: '+Busy' },
	{ scope: 'all', label: 'All' },
];

export function WorkmuxScopeToggleKey({
	scope,
	span,
	keyHeight,
	onPress,
}: {
	scope: WorkmuxNavScope;
	span: number;
	keyHeight: number;
	onPress: () => void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Cycle window nav scope (currently ${scope})`}
			onPress={onPress}
			style={{
				flex: span,
				margin: 2,
				height: keyHeight,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				flexDirection: 'row',
				overflow: 'hidden',
			}}
		>
			{SCOPE_SEGMENTS.map((segment, index) => {
				const active = segment.scope === scope;
				return (
					<View
						key={segment.scope}
						accessible={false}
						style={{
							flex: 1,
							alignItems: 'center',
							justifyContent: 'center',
							backgroundColor: active
								? theme.colors.primary
								: 'transparent',
							borderLeftWidth: index === 0 ? 0 : 1,
							borderLeftColor: theme.colors.border,
						}}
					>
						<Text
							numberOfLines={1}
							style={{ color: theme.colors.textPrimary, fontSize: 10, lineHeight: 12 }}
						>
							{segment.label}
						</Text>
					</View>
				);
			})}
		</Pressable>
	);
}
