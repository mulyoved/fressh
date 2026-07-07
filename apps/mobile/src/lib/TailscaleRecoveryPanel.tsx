import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getTailscaleRecoveryPanelModel } from './tailscale-recovery-panel-model';
import { type TailscaleRecoveryUiActions } from './tailscale-recovery-ui-store';
import { type TailscaleRecoveryBannerState } from './TailscaleRecoveryBannerPresentation';

import { useTheme } from './theme';

export function TailscaleRecoveryPanel(props: {
	state: TailscaleRecoveryBannerState;
	actions: TailscaleRecoveryUiActions | null;
}) {
	const theme = useTheme();
	const model = getTailscaleRecoveryPanelModel({
		state: props.state,
		colors: theme.colors,
		actions: props.actions,
	});

	if (!model.visible) return null;
	const { presentation, handlers } = model;
	const [openAction, retryAction, resetAction] = presentation.actions;

	return (
		<View
			style={[
				styles.panel,
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
					onPress={handlers?.openTailscale}
					style={[
						styles.button,
						styles.primaryButton,
						{ backgroundColor: presentation.primaryBackgroundColor },
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
					onPress={handlers?.retry}
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
					<Text style={[styles.buttonText, { color: theme.colors.textPrimary }]}>
						{retryAction.label}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={resetAction.disabled}
					onPress={handlers?.reset}
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
					<Text style={[styles.buttonText, { color: theme.colors.textPrimary }]}>
						{resetAction.label}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	panel: {
		borderRadius: 8,
		borderWidth: 1,
		padding: 12,
		gap: 8,
		marginBottom: 16,
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
