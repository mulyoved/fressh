import React, { useCallback, useState } from 'react';
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
import {
	getWorktreeWorkspaceDraftResetKey,
	type WorktreeWorkspaceModalProps,
} from '@/lib/shell-controllers/worktree-workspace-modal-props';
import { useTheme } from '@/lib/theme';

export function WorktreeWorkspaceModal(props: WorktreeWorkspaceModalProps) {
	const theme = useTheme();
	const busy = props.open && props.phase === 'submitting';
	const close = props.open ? props.onClose : null;
	const onDismiss = useCallback(() => {
		if (busy) return;
		void close?.();
	}, [busy, close]);
	const draftResetKey = getWorktreeWorkspaceDraftResetKey(props);

	if (!props.open) return null;

	const title =
		props.mode === 'new'
			? 'New Worktree Workspace'
			: 'Close Worktree Workspace';

	return (
		<Modal transparent visible animationType="slide" onRequestClose={onDismiss}>
			<Pressable
				testID="worktree-workspace-backdrop"
				onPress={onDismiss}
				disabled={busy}
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
						paddingBottom: props.bottomOffset,
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
							width: '85%',
							maxWidth: 400,
							minWidth: 280,
							maxHeight: '85%',
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
								{title}
							</Text>
							<Pressable
								accessibilityRole="button"
								onPress={onDismiss}
								disabled={busy}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
									opacity: busy ? 0.5 : 1,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>
									Cancel
								</Text>
							</Pressable>
						</View>

						<ScrollView
							keyboardShouldPersistTaps="handled"
							style={{ flexShrink: 1 }}
						>
							{props.mode === 'new' ? (
								props.preparation === null ? (
									<PreparationContent
										error={props.error}
										onRetry={props.onRetry}
									/>
								) : (
									<NewWorkspaceContent
										key={draftResetKey}
										repositoryName={props.preparation.repositoryName}
										suggestedBranch={props.preparation.suggestedBranch}
										error={props.error}
										busy={busy}
										onCreate={props.onCreate}
									/>
								)
							) : props.preview === null ? (
								<PreparationContent
									error={props.error}
									onRetry={props.onRetry}
								/>
							) : (
								<CloseWorkspaceContent
									preview={props.preview}
									error={props.error}
									busy={busy}
									onConfirm={props.onConfirm}
								/>
							)}
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}

function PreparationContent({
	error,
	onRetry,
}: Readonly<{ error: string | null; onRetry(): void }>) {
	const theme = useTheme();
	return (
		<View style={{ alignItems: 'center', paddingVertical: 16 }}>
			<ActivityIndicator size="small" color={theme.colors.primary} />
			<Text
				style={{
					color: theme.colors.textSecondary,
					marginTop: 10,
				}}
			>
				Preparing workspace…
			</Text>
			{error ? (
				<>
					<ErrorText error={error} />
					<Pressable
						accessibilityRole="button"
						onPress={onRetry}
						style={{
							marginTop: 12,
							borderRadius: 10,
							paddingHorizontal: 18,
							paddingVertical: 10,
							backgroundColor: theme.colors.primary,
						}}
					>
						<Text
							style={{
								color: theme.colors.buttonTextOnPrimary,
								fontWeight: '700',
							}}
						>
							Retry
						</Text>
					</Pressable>
				</>
			) : null}
		</View>
	);
}

function NewWorkspaceContent({
	repositoryName,
	suggestedBranch,
	error,
	busy,
	onCreate,
}: Readonly<{
	repositoryName: string;
	suggestedBranch: string;
	error: string | null;
	busy: boolean;
	onCreate(branch: string): void;
}>) {
	const theme = useTheme();
	const [draft, setDraft] = useState(suggestedBranch);
	const submit = useCallback(() => {
		if (busy) return;
		onCreate(draft);
	}, [busy, draft, onCreate]);

	return (
		<View>
			<Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
				Repository
			</Text>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontWeight: '600',
					marginTop: 3,
					marginBottom: 12,
				}}
			>
				{repositoryName}
			</Text>
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 14,
					fontWeight: '600',
					marginBottom: 6,
				}}
			>
				Task branch
			</Text>
			<TextInput
				value={draft}
				onChangeText={setDraft}
				autoCapitalize="none"
				autoCorrect={false}
				editable={!busy}
				style={{
					borderWidth: 1,
					borderColor: theme.colors.border,
					backgroundColor: theme.colors.inputBackground,
					color: theme.colors.textPrimary,
					borderRadius: 10,
					paddingHorizontal: 12,
					paddingVertical: 10,
				}}
			/>
			{error ? <ErrorText error={error} /> : null}
			<Pressable
				accessibilityRole="button"
				onPress={submit}
				disabled={busy}
				style={{
					backgroundColor: busy
						? theme.colors.primaryDisabled
						: theme.colors.primary,
					borderRadius: 10,
					paddingVertical: 12,
					marginTop: 12,
					alignItems: 'center',
					flexDirection: 'row',
					justifyContent: 'center',
				}}
			>
				{busy ? (
					<ActivityIndicator
						size="small"
						color={theme.colors.buttonTextOnPrimary}
						style={{ marginRight: 8 }}
					/>
				) : null}
				<Text
					style={{
						color: theme.colors.buttonTextOnPrimary,
						fontWeight: '700',
					}}
				>
					{busy ? 'Creating…' : 'Create'}
				</Text>
			</Pressable>
		</View>
	);
}

function CloseWorkspaceContent({
	preview,
	error,
	busy,
	onConfirm,
}: Readonly<{
	preview: NonNullable<
		Extract<WorktreeWorkspaceModalProps, { mode: 'close' }>['preview']
	>;
	error: string | null;
	busy: boolean;
	onConfirm(): void;
}>) {
	const theme = useTheme();
	const submit = useCallback(() => {
		if (busy) return;
		onConfirm();
	}, [busy, onConfirm]);

	return (
		<View>
			<PreviewField label="Workspace" value={preview.workspaceLabel} />
			<PreviewField label="Worktree path" value={preview.worktreePath} />
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 12,
					marginBottom: 6,
				}}
			>
				{preview.windows.length}{' '}
				{preview.windows.length === 1 ? 'window' : 'windows'}
			</Text>
			{preview.windows.map((window) => (
				<Text
					key={window.id}
					style={{
						color: theme.colors.textPrimary,
						paddingVertical: 3,
					}}
				>
					{window.name}
				</Text>
			))}
			{error ? <ErrorText error={error} /> : null}
			<Pressable
				accessibilityRole="button"
				onPress={submit}
				disabled={busy}
				style={{
					backgroundColor: busy ? theme.colors.border : theme.colors.danger,
					borderRadius: 10,
					paddingVertical: 12,
					marginTop: 12,
					alignItems: 'center',
					flexDirection: 'row',
					justifyContent: 'center',
				}}
			>
				{busy ? (
					<ActivityIndicator
						size="small"
						color={theme.colors.buttonTextOnPrimary}
						style={{ marginRight: 8 }}
					/>
				) : null}
				<Text
					style={{
						color: theme.colors.buttonTextOnPrimary,
						fontWeight: '700',
					}}
				>
					{busy ? 'Removing…' : 'Remove Worktree'}
				</Text>
			</Pressable>
		</View>
	);
}

function PreviewField({
	label,
	value,
}: Readonly<{ label: string; value: string }>) {
	const theme = useTheme();
	return (
		<View style={{ marginBottom: 12 }}>
			<Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
				{label}
			</Text>
			<Text
				selectable
				style={{ color: theme.colors.textPrimary, marginTop: 3 }}
			>
				{value}
			</Text>
		</View>
	);
}

function ErrorText({ error }: Readonly<{ error: string }>) {
	const theme = useTheme();
	return (
		<Text
			style={{
				color: theme.colors.danger,
				fontSize: 12,
				fontWeight: '600',
				marginTop: 12,
			}}
		>
			{error}
		</Text>
	);
}
