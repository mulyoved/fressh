import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

interface ConfigOption {
	label: string;
	description?: string;
	onPress: () => void;
}

export function ConfigureModal({
	open,
	bottomOffset,
	onClose,
	onKeyboardConfig,
	onDevServer,
	onHostConfig,
	onRequestFeature,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onKeyboardConfig: () => void;
	onDevServer: () => void;
	onHostConfig: () => void;
	onRequestFeature: () => void;
}) {
	const theme = useTheme();

	const options: ConfigOption[] = [
		{
			label: 'Keyboard config',
			description: 'Open keyboard configurator',
			onPress: onKeyboardConfig,
		},
		{
			label: 'Dev server',
			description: 'Handle dev server',
			onPress: onDevServer,
		},
		{
			label: 'Host config',
			description: 'Edit connection settings',
			onPress: onHostConfig,
		},
		{
			label: 'Request a Feature',
			description: 'Submit feedback or feature request',
			onPress: onRequestFeature,
		},
	];

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '80%',
						width: '70%',
						maxWidth: 320,
						minWidth: 240,
						marginRight: 8,
						marginBottom: bottomOffset,
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
							}}
						>
							Configure
						</Text>
						<Pressable
							onPress={onClose}
							style={{
								paddingHorizontal: 10,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
							}}
						>
							<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
						</Pressable>
					</View>
					{options.map((option, index) => (
						<Pressable
							key={option.label}
							onPress={option.onPress}
							style={{
								paddingVertical: 12,
								paddingHorizontal: 12,
								borderRadius: 10,
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.surface,
								marginBottom: index < options.length - 1 ? 8 : 0,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 14,
									fontWeight: '600',
								}}
							>
								{option.label}
							</Text>
							{option.description && (
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontSize: 12,
										marginTop: 2,
									}}
								>
									{option.description}
								</Text>
							)}
						</Pressable>
					))}
				</View>
			</Pressable>
		</Modal>
	);
}
