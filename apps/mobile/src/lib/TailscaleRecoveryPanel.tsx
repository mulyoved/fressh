import React from 'react';
import type {
	TextStyle,
	ViewStyle,
	PressableProps,
	TextProps,
	ViewProps,
} from 'react-native';
import {
	getTailscaleRecoveryBannerPresentation,
	type TailscaleRecoveryBannerState,
} from './TailscaleRecoveryBannerPresentation';
import { type TailscaleRecoveryUiActions } from './tailscale-recovery-ui-store';

export type TailscaleRecoveryPanelHandlers = {
	openTailscale?: () => void;
	retry?: () => void;
	reset?: () => void;
};

type TailscaleRecoveryPanelPresentation = Exclude<
	ReturnType<typeof getTailscaleRecoveryBannerPresentation>,
	{ visible: false }
>;

type ReactNativeModule = {
	Pressable: React.ComponentType<PressableProps>;
	Text: React.ComponentType<TextProps>;
	View: React.ComponentType<ViewProps>;
};

const getReactNative = () => require('react-native') as ReactNativeModule;

export type TailscaleRecoveryPanelModel =
	| { visible: false }
	| {
			visible: true;
			presentation: TailscaleRecoveryPanelPresentation;
			handlers?: TailscaleRecoveryPanelHandlers;
	  };

export function getTailscaleRecoveryPanelModel(input: {
	state: TailscaleRecoveryBannerState;
	colors: Parameters<typeof getTailscaleRecoveryBannerPresentation>[1];
	actions: TailscaleRecoveryUiActions | null;
}): TailscaleRecoveryPanelModel {
	const presentation = getTailscaleRecoveryBannerPresentation(
		input.state,
		input.colors,
		{ actionsAvailable: input.actions !== null },
	);

	if (!presentation.visible) return { visible: false };

	return {
		visible: true,
		presentation,
		handlers: input.actions
			? {
					openTailscale: input.actions.openTailscale,
					retry: input.actions.retry,
					reset: input.actions.reset,
				}
			: undefined,
	};
}

export function TailscaleRecoveryPanel(props: {
	state: TailscaleRecoveryBannerState;
	actions: TailscaleRecoveryUiActions | null;
}): React.ReactElement | null {
	const { useTheme } = require('./theme') as typeof import('./theme');
	const theme = useTheme();
	const { Pressable, Text, View } = getReactNative();
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

const styles: {
	panel: ViewStyle;
	title: TextStyle;
	message: TextStyle;
	actions: ViewStyle;
	button: ViewStyle;
	primaryButton: ViewStyle;
	secondaryButton: ViewStyle;
	disabledButton: ViewStyle;
	buttonText: TextStyle;
} = {
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
};
