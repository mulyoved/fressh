import React, { useCallback } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	type FeatureRequestTargetSelection,
	type PinnedFeatureRequestRepo,
} from '@/lib/repo-feature-request';
import { useTheme } from '@/lib/theme';

export function FeatureRequestTargetPicker({
	open,
	bottomOffset,
	currentRepository,
	isResolvingCurrent,
	selection,
	pinned,
	onClose,
	onSelect,
}: {
	open: boolean;
	bottomOffset: number;
	currentRepository: string | null;
	isResolvingCurrent: boolean;
	selection: FeatureRequestTargetSelection;
	pinned: readonly PinnedFeatureRequestRepo[];
	onClose: () => void;
	onSelect: (selection: FeatureRequestTargetSelection) => void;
}) {
	const theme = useTheme();

	const handleClose = useCallback(() => {
		onClose();
	}, [onClose]);

	const currentSubtitle = isResolvingCurrent
		? 'Resolving…'
		: (currentRepository ?? 'Unavailable');

	const isCurrentSelected = selection.kind === 'current';
	const pinnedSelectedRepository =
		selection.kind === 'pinned' ? selection.repository : null;

	return (
		<Modal
			transparent
			visible={open}
			animationType="fade"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
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
						maxHeight: '70%',
						width: '78%',
						maxWidth: 380,
						minWidth: 280,
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
							Pick Target Project
						</Text>
						<Pressable
							accessibilityRole="button"
							onPress={handleClose}
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

					<ScrollView>
						<TargetRow
							label="Current"
							subtitle={currentSubtitle}
							selected={isCurrentSelected}
							onPress={() => onSelect({ kind: 'current' })}
							theme={theme}
						/>
						{pinned.map((entry) => (
							<TargetRow
								key={entry.repository}
								label={entry.label}
								subtitle={entry.repository}
								selected={pinnedSelectedRepository === entry.repository}
								onPress={() =>
									onSelect({ kind: 'pinned', repository: entry.repository })
								}
								theme={theme}
							/>
						))}
					</ScrollView>
				</View>
			</Pressable>
		</Modal>
	);
}

function TargetRow({
	label,
	subtitle,
	selected,
	onPress,
	theme,
}: {
	label: string;
	subtitle: string;
	selected: boolean;
	onPress: () => void;
	theme: ReturnType<typeof useTheme>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected }}
			onPress={onPress}
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				paddingVertical: 12,
				paddingHorizontal: 12,
				borderRadius: 10,
				borderWidth: 1,
				borderColor: selected ? theme.colors.primary : theme.colors.border,
				backgroundColor: theme.colors.surface,
				marginBottom: 8,
			}}
		>
			<View
				style={{
					width: 14,
					height: 14,
					borderRadius: 7,
					borderWidth: 2,
					borderColor: selected ? theme.colors.primary : theme.colors.border,
					backgroundColor: selected ? theme.colors.primary : 'transparent',
					marginRight: 10,
				}}
			/>
			<View style={{ flex: 1 }}>
				<Text
					numberOfLines={1}
					style={{
						color: theme.colors.textPrimary,
						fontSize: 14,
						fontWeight: selected ? '700' : '600',
					}}
				>
					{label}
				</Text>
				<Text
					numberOfLines={1}
					style={{
						color: theme.colors.textSecondary,
						fontSize: 12,
						marginTop: 3,
					}}
				>
					{subtitle}
				</Text>
			</View>
		</Pressable>
	);
}
