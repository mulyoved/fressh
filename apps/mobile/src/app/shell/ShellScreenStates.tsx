import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { rootLogger } from '@/lib/logger';
import { useTheme } from '@/lib/theme';
import { getWorkmuxAttachErrorCopy } from '@/lib/workmux-copy';

const logger = rootLogger.extend('ShellScreenView');

export function ShellRouteSkeleton() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Loading
			</Text>
		</View>
	);
}

export function TmuxAttachErrorScreen({
	failureReason,
	sessionName,
	onEdit,
}: {
	failureReason?: string;
	sessionName: string;
	onEdit(): void;
}) {
	const theme = useTheme();
	const copy = getWorkmuxAttachErrorCopy(sessionName, failureReason);
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
				padding: 24,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 20,
					fontWeight: '700',
					marginBottom: 12,
					textAlign: 'center',
				}}
			>
				{copy.title}
			</Text>
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 14,
					textAlign: 'center',
					marginBottom: 20,
				}}
			>
				{copy.body}
			</Text>
			<Pressable
				onPress={onEdit}
				style={{
					backgroundColor: theme.colors.primary,
					borderRadius: 10,
					paddingVertical: 12,
					paddingHorizontal: 20,
				}}
			>
				<Text style={{ color: '#fff', fontWeight: '700' }}>
					Edit Connection
				</Text>
			</Pressable>
		</View>
	);
}

type TerminalErrorBoundaryProps = {
	children: React.ReactNode;
	onRetry(): void;
};

export class TerminalErrorBoundary extends React.Component<
	TerminalErrorBoundaryProps,
	{ hasError: boolean }
> {
	override state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		logger.error('Terminal crashed', error, errorInfo);
	}

	private readonly retry = () => {
		this.setState({ hasError: false });
		this.props.onRetry();
	};

	override render() {
		return this.state.hasError ? (
			<TerminalErrorFallback onRetry={this.retry} />
		) : (
			this.props.children
		);
	}
}

function TerminalErrorFallback({ onRetry }: { onRetry(): void }) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
				padding: 20,
			}}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 18,
					marginBottom: 12,
				}}
			>
				Terminal crashed
			</Text>
			<Pressable
				onPress={onRetry}
				style={{
					paddingHorizontal: 20,
					paddingVertical: 10,
					borderRadius: 8,
					backgroundColor: theme.colors.primary,
				}}
			>
				<Text style={{ color: '#fff', fontSize: 16 }}>Tap to retry</Text>
			</Pressable>
		</View>
	);
}
