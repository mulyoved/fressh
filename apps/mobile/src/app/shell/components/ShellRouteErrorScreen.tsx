import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { type ShellRouteError } from '../shell-route';

export function ShellRouteErrorScreen({
	error,
	onBack,
}: {
	error: ShellRouteError;
	onBack(): void;
}) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				alignItems: 'center',
				justifyContent: 'center',
				gap: 16,
				padding: 24,
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Shell link unavailable
			</Text>
			<Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
				{error.message}
			</Text>
			<Pressable onPress={onBack} accessibilityRole="button">
				<Text style={{ color: theme.colors.primary, fontSize: 16 }}>Back</Text>
			</Pressable>
		</View>
	);
}
