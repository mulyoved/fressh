import React, { useCallback, useEffect, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
	canSubmitFeatureRequest,
	PINNED_FEATURE_REQUEST_REPOS,
	selectFeatureRequestRepository,
	type FeatureRequestTargetSelection,
} from '@/lib/repo-feature-request';
import { useTheme } from '@/lib/theme';

export function FeatureRequestModal({
	open,
	bottomOffset,
	onClose,
	onSubmit,
	targetRepository,
	isResolvingTarget = false,
	isSubmitting = false,
	error,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => boolean | void;
	onSubmit: (description: string, repository: string) => void;
	targetRepository?: string | null;
	isResolvingTarget?: boolean;
	isSubmitting?: boolean;
	error?: string;
}) {
	const theme = useTheme();
	const [description, setDescription] = useState('');
	const [selection, setSelection] = useState<FeatureRequestTargetSelection>({
		kind: 'current',
	});

	useEffect(() => {
		if (!open) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset draft text and selection when parent closes the modal.
			setDescription('');
			setSelection({ kind: 'current' });
		}
	}, [open]);

	const handleClose = useCallback(() => {
		if (isSubmitting) return;
		const didClose = onClose();
		if (didClose === false) return;
		setDescription('');
		setSelection({ kind: 'current' });
	}, [isSubmitting, onClose]);

	const effectiveRepository = selectFeatureRequestRepository(
		selection,
		targetRepository ?? null,
	);

	const handleSubmit = useCallback(() => {
		if (!effectiveRepository) return;
		if (!description.trim() || isSubmitting) return;
		onSubmit(description.trim(), effectiveRepository);
	}, [description, effectiveRepository, isSubmitting, onSubmit]);

	const canSubmit = canSubmitFeatureRequest({
		description,
		selection,
		autoResolvedRepository: targetRepository ?? null,
		isSubmitting,
		isResolvingCurrent: isResolvingTarget,
	});

	const pickerValue =
		selection.kind === 'pinned' ? selection.repository : 'current';

	const handlePickerChange = useCallback((value: string) => {
		if (value === 'current') {
			setSelection({ kind: 'current' });
		} else {
			setSelection({ kind: 'pinned', repository: value });
		}
	}, []);

	const currentItemLabel = isResolvingTarget
		? 'Current — Resolving…'
		: targetRepository
			? `Current — ${targetRepository}`
			: 'Current — Unavailable';

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{
						flex: 1,
						justifyContent: 'center',
						paddingBottom: bottomOffset,
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
							maxHeight: '85%',
							width: '85%',
							maxWidth: 400,
							minWidth: 280,
							alignSelf: 'flex-end',
							marginRight: 8,
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
								Request a Feature
							</Text>
							<Pressable
								onPress={handleClose}
								disabled={isSubmitting}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text
									style={{
										color: isSubmitting
											? theme.colors.muted
											: theme.colors.textSecondary,
									}}
								>
									Cancel
								</Text>
							</Pressable>
						</View>
						<ScrollView keyboardShouldPersistTaps="handled">
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Target
							</Text>
							<View
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									borderRadius: 10,
									marginBottom: 16,
									overflow: 'hidden',
								}}
							>
								<Picker
									mode="dropdown"
									selectedValue={pickerValue}
									onValueChange={handlePickerChange}
									enabled={!isSubmitting}
									dropdownIconColor={theme.colors.textSecondary}
									style={{ color: theme.colors.textPrimary }}
								>
									<Picker.Item label={currentItemLabel} value="current" />
									{PINNED_FEATURE_REQUEST_REPOS.map((entry) => (
										<Picker.Item
											key={entry.repository}
											label={`${entry.label} — ${entry.repository}`}
											value={entry.repository}
										/>
									))}
								</Picker>
							</View>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Description
							</Text>
							<TextInput
								value={description}
								onChangeText={setDescription}
								placeholder="Describe the feature or feedback in detail..."
								placeholderTextColor={theme.colors.muted}
								editable={!isSubmitting}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									minHeight: 120,
									textAlignVertical: 'top',
									marginBottom: 16,
								}}
								multiline
							/>
							{error && (
								<View
									style={{
										backgroundColor: theme.colors.danger + '20',
										borderWidth: 1,
										borderColor: theme.colors.danger,
										borderRadius: 8,
										padding: 12,
										marginBottom: 16,
									}}
								>
									<Text
										style={{
											color: theme.colors.danger,
											fontSize: 13,
											fontWeight: '600',
											marginBottom: 4,
										}}
									>
										Submission failed
									</Text>
									<Text
										style={{
											color: theme.colors.danger,
											fontSize: 12,
										}}
									>
										{error}
									</Text>
								</View>
							)}
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
									marginBottom: 16,
								}}
							>
								The title is generated automatically from your description.
								Creates a GitHub issue via the remote server. Requires gh and
								claude CLIs installed and authenticated on the server (gh auth
								login).
							</Text>
							<Pressable
								onPress={handleSubmit}
								disabled={!canSubmit}
								style={{
									backgroundColor: canSubmit
										? theme.colors.primary
										: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									flexDirection: 'row',
									justifyContent: 'center',
								}}
							>
								{(isSubmitting ||
									(selection.kind === 'current' && isResolvingTarget)) && (
									<ActivityIndicator
										size="small"
										color={theme.colors.buttonTextOnPrimary}
										style={{ marginRight: 8 }}
									/>
								)}
								<Text
									style={{
										color: canSubmit
											? theme.colors.buttonTextOnPrimary
											: theme.colors.textSecondary,
										fontWeight: '700',
									}}
								>
									{isSubmitting
										? 'Submitting...'
										: selection.kind === 'current' && isResolvingTarget
											? 'Resolving repository...'
											: 'Submit Feature Request'}
								</Text>
							</Pressable>
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
