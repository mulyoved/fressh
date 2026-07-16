import React from 'react';
import { ActivityIndicator, Animated, Text, View } from 'react-native';
import { type ShellKeyboardControllerHandle } from '@/lib/shell-controllers/keyboard';
import { useTheme } from '@/lib/theme';

export function ReconnectOverlay() {
	const theme = useTheme();
	return (
		<View
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: theme.colors.overlay,
			}}
		>
			<View
				style={{
					paddingHorizontal: 20,
					paddingVertical: 16,
					borderRadius: 12,
					backgroundColor: theme.colors.surface,
					borderWidth: 1,
					borderColor: theme.colors.border,
					alignItems: 'center',
				}}
			>
				<ActivityIndicator color={theme.colors.textPrimary} />
				<Text
					style={{
						marginTop: 8,
						color: theme.colors.textPrimary,
						fontSize: 16,
						fontWeight: '600',
					}}
				>
					Reconnecting...
				</Text>
				<Text
					style={{
						marginTop: 4,
						color: theme.colors.textSecondary,
						fontSize: 12,
					}}
				>
					Keeping your session ready
				</Text>
			</View>
		</View>
	);
}

export function KeyboardFlash({
	flash,
}: {
	flash: ShellKeyboardControllerHandle['flash'];
}) {
	return (
		<Animated.View
			pointerEvents="none"
			style={{
				position: 'absolute',
				top: '40%',
				left: 0,
				right: 0,
				alignItems: 'center',
				opacity: flash.opacity,
			}}
		>
			<View
				style={{
					backgroundColor: 'rgba(0, 0, 0, 0.75)',
					paddingHorizontal: 20,
					paddingVertical: 10,
					borderRadius: 8,
				}}
			>
				<Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
					{flash.name}
				</Text>
			</View>
		</Animated.View>
	);
}
