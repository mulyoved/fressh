import React, { useCallback, useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	buildKeyedDetectedOpenCandidates,
	type DetectedOpenCandidate,
} from '@/lib/detected-open-actions';
import { useTheme } from '@/lib/theme';
import { handleDetectedOpenPickerSelection } from './detected-open-picker-selection';

export function DetectedOpenPickerModal({
	open,
	bottomOffset,
	candidates,
	onClose,
	onSelect,
}: {
	open: boolean;
	bottomOffset: number;
	candidates: readonly DetectedOpenCandidate[];
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
}) {
	const theme = useTheme();
	const keyedCandidates = useMemo(
		() => buildKeyedDetectedOpenCandidates(candidates),
		[candidates],
	);
	const close = useCallback(() => {
		onClose();
	}, [onClose]);
	const select = useCallback(
		(candidate: DetectedOpenCandidate) => {
			handleDetectedOpenPickerSelection(candidate, { onSelect });
		},
		[onSelect],
	);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={close}
		>
			<Pressable
				onPress={close}
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
							Pick
						</Text>
						<Pressable
							accessibilityRole="button"
							onPress={close}
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
						{keyedCandidates.map(({ candidate, key }) => (
							<Pressable
								key={key}
								accessibilityRole="button"
								onPress={() => select(candidate)}
								style={{
									paddingVertical: 12,
									paddingHorizontal: 12,
									borderRadius: 10,
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.surface,
									marginBottom: 8,
								}}
							>
								<Text
									numberOfLines={2}
									style={{
										color: theme.colors.textPrimary,
										fontSize: 14,
										fontWeight: '600',
									}}
								>
									{candidate.display}
								</Text>
								<Text
									numberOfLines={1}
									style={{
										color: theme.colors.textSecondary,
										fontSize: 12,
										marginTop: 3,
									}}
								>
									{getDetectedOpenCandidateSubtitle(candidate)}
								</Text>
							</Pressable>
						))}
					</ScrollView>
				</View>
			</Pressable>
		</Modal>
	);
}

function getDetectedOpenCandidateSubtitle(
	candidate: DetectedOpenCandidate,
): string {
	switch (candidate.kind) {
		case 'remote-url':
			return 'Remote URL';
		case 'local-url':
			return 'Local URL';
		case 'file':
			return 'File';
	}
}
