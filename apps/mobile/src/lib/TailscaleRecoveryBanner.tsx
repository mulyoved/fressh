import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
	getTailscaleRecoveryBannerPresentation,
	type TailscaleRecoveryBannerState,
} from './TailscaleRecoveryBannerPresentation';
import { useTheme } from './theme';

export type { TailscaleRecoveryBannerState };

export function TailscaleRecoveryBanner(props: {
	state: TailscaleRecoveryBannerState;
	onOpenTailscale: () => void;
	onRetry: () => void;
	onReset: () => void;
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const presentation = getTailscaleRecoveryBannerPresentation(
		props.state,
		theme.colors,
	);

	if (!presentation.visible) return null;
	const [openAction, retryAction, resetAction] = presentation.actions;

	return (
		<View
			pointerEvents="box-none"
			style={[styles.root, { paddingTop: insets.top + 8 }]}
		>
			<View
				style={[
					styles.banner,
					{
						backgroundColor: theme.colors.surface,
						borderColor: theme.colors.border,
						shadowColor: theme.colors.shadow,
					},
				]}
			>
				<Text style={[styles.title, { color: theme.colors.textPrimary }]}>
					{presentation.title}
				</Text>
				<Text style={[styles.message, { color: theme.colors.textSecondary }]}>
					{presentation.message}
				</Text>
				<View style={styles.actions}>
					<Pressable
						accessibilityRole="button"
						disabled={openAction.disabled}
						onPress={props.onOpenTailscale}
						style={[
							styles.button,
							styles.primaryButton,
							{
								backgroundColor: presentation.primaryBackgroundColor,
							},
							openAction.disabled && styles.disabledButton,
						]}
					>
						<Text
							style={[
								styles.buttonText,
								{ color: theme.colors.buttonTextOnPrimary },
							]}
						>
							{openAction.label}
						</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						disabled={retryAction.disabled}
						onPress={props.onRetry}
						style={[
							styles.button,
							styles.secondaryButton,
							{
								backgroundColor: theme.colors.surface,
								borderColor: theme.colors.border,
							},
							retryAction.disabled && styles.disabledButton,
						]}
					>
						<Text
							style={[styles.buttonText, { color: theme.colors.textPrimary }]}
						>
							{retryAction.label}
						</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						disabled={resetAction.disabled}
						onPress={props.onReset}
						style={[
							styles.button,
							styles.secondaryButton,
							{
								backgroundColor: theme.colors.surface,
								borderColor: theme.colors.border,
							},
							resetAction.disabled && styles.disabledButton,
						]}
					>
						<Text
							style={[styles.buttonText, { color: theme.colors.textPrimary }]}
						>
							{resetAction.label}
						</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		zIndex: 1000,
		paddingHorizontal: 12,
	},
	banner: {
		borderRadius: 8,
		borderWidth: 1,
		padding: 12,
		gap: 8,
		shadowOpacity: 0.18,
		shadowRadius: 10,
		shadowOffset: { width: 0, height: 3 },
		elevation: 5,
	},
	title: {
		fontSize: 14,
		fontWeight: '700',
	},
	message: {
		fontSize: 12,
		lineHeight: 17,
	},
	actions: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 8,
	},
	button: {
		minHeight: 44,
		borderRadius: 6,
		paddingHorizontal: 12,
		paddingVertical: 8,
		alignItems: 'center',
		justifyContent: 'center',
	},
	primaryButton: {
		borderWidth: 0,
	},
	secondaryButton: {
		borderWidth: 1,
	},
	disabledButton: {
		opacity: 0.75,
	},
	buttonText: {
		fontSize: 12,
		fontWeight: '700',
	},
});
