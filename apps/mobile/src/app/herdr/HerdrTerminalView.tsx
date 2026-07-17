import {
	XtermJsWebView,
	type ScrollbackBatchEvent,
	type TouchScrollConfig,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';
import { Stack } from 'expo-router';
import React from 'react';
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	Text,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
	TerminalKeyboard,
	type TerminalKeyboardProps,
} from '@/app/shell/components/TerminalKeyboard';
import { type HerdrAgent } from '@/lib/herdr/contracts';
import { type HerdrTerminalState } from '@/lib/herdr/terminal-owner';
import { rootLogger } from '@/lib/logger';
import { useTheme } from '@/lib/theme';

const logger = rootLogger.extend('HerdrTerminal');

export const HERDR_TOUCH_SCROLL_CONFIG: TouchScrollConfig = {
	enabled: true,
	pxPerLine: 10,
	slopPx: 10,
	maxLinesPerFrame: 12,
	flickVelocity: 1.2,
	coalesceMs: 24,
	minFlushMs: 16,
	maxFlushMs: 80,
	maxPagesPerFlush: 12,
	maxExtraLines: 999,
	maxBacklogPages: 50,
	velocityMultiplierEnabled: true,
	velocityThreshold: 0.3,
	velocityBoost: 2.5,
	velocityBoostMax: 20,
	velocitySmoothing: 0.2,
	backlogMultiplierEnabled: true,
	backlogBoostRefPages: 2,
	backlogBoostMax: 2,
	rttEwmaAlpha: 0.2,
	debug: false,
	debugOverlay: false,
	debugTelemetry: false,
	debugTelemetryIntervalMs: 120,
};

export type HerdrTerminalViewState =
	| HerdrTerminalState
	| Readonly<{ phase: 'reconnecting' }>;

export type HerdrTerminalViewProps = Readonly<{
	agent: HerdrAgent | null;
	state: HerdrTerminalViewState;
	rendererGeneration: number;
	xtermRef: React.RefObject<XtermWebViewHandle | null>;
	keyboardProps: TerminalKeyboardProps;
	onLoadStart(): void;
	onRendererFailure(): void;
	onInitialized(instanceId: string): void;
	onInput(input: { str: string; kind: 'typing'; instanceId: string }): void;
	onResize(cols: number, rows: number): void;
	onScrollbackBatch(event: ScrollbackBatchEvent): void;
	onSelectionModeChange(enabled: boolean): void;
	onTakeOver(): void;
	onRetry(): void;
	onBack(): void;
}>;

function OverlayButton(props: {
	label: 'Take Over' | 'Retry' | 'Back';
	primary?: boolean;
	onPress(): void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			onPress={props.onPress}
			style={{
				borderRadius: 10,
				backgroundColor: props.primary
					? theme.colors.primary
					: theme.colors.surface,
				borderWidth: props.primary ? 0 : 1,
				borderColor: theme.colors.border,
				paddingHorizontal: 16,
				paddingVertical: 10,
			}}
		>
			<Text
				style={{
					color: props.primary
						? theme.colors.buttonTextOnPrimary
						: theme.colors.textPrimary,
					fontWeight: '700',
				}}
			>
				{props.label}
			</Text>
		</Pressable>
	);
}

function stateMessage(state: HerdrTerminalViewState): string | null {
	switch (state.phase) {
		case 'starting':
			return 'Starting terminal…';
		case 'active':
			return null;
		case 'releasing':
			return 'Releasing terminal…';
		case 'reconnecting':
			return 'Reconnecting terminal…';
		case 'backgrounded':
			return 'Terminal paused in background.';
		case 'owned-elsewhere':
		case 'error':
			return state.reason;
	}
}

export function HerdrTerminalView(props: HerdrTerminalViewProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const message = stateMessage(props.state);
	const overlay = props.state.phase !== 'active';

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'height' : undefined}
				keyboardVerticalOffset={0}
				style={{
					flex: 1,
					backgroundColor: theme.colors.background,
					paddingTop: Platform.OS === 'android' ? insets.top : 0,
					paddingBottom: Platform.OS === 'android' ? insets.bottom + 4 : 0,
				}}
			>
				<View
					style={{
						paddingHorizontal: 14,
						paddingVertical: 8,
						borderBottomWidth: 1,
						borderBottomColor: theme.colors.border,
					}}
				>
					<Text
						style={{
							color: theme.colors.textPrimary,
							fontSize: 16,
							fontWeight: '700',
						}}
					>
						{props.agent?.label ?? 'Herdr terminal'}
					</Text>
					{props.agent ? (
						<Text style={{ color: theme.colors.textSecondary }}>
							{props.agent.workspaceLabel} / {props.agent.tabLabel}
						</Text>
					) : null}
				</View>
				<View style={{ flex: 1 }}>
					<XtermJsWebView
						key={props.rendererGeneration}
						ref={props.xtermRef}
						style={{ flex: 1 }}
						webViewOptions={{
							contentInsetAdjustmentBehavior: 'never',
							onLayout: () => props.xtermRef.current?.fit(),
							onLoadStart: props.onLoadStart,
							onError: () => props.onRendererFailure(),
							onRenderProcessGone: () => props.onRendererFailure(),
							onContentProcessDidTerminate: () => props.onRendererFailure(),
						}}
						logger={{
							warn: logger.warn,
							error: logger.error,
						}}
						xtermOptions={{
							scrollback: 0,
							theme: {
								background: theme.colors.background,
								foreground: theme.colors.textPrimary,
								selectionBackground:
									Platform.OS === 'android'
										? '#F5F5F5'
										: 'rgba(37, 99, 235, 0.35)',
								selectionInactiveBackground:
									Platform.OS === 'android'
										? 'rgba(255, 255, 255, 0.6)'
										: 'rgba(37, 99, 235, 0.2)',
								...(Platform.OS === 'android'
									? { selectionForeground: '#000000' }
									: {}),
							},
						}}
						touchScrollConfig={HERDR_TOUCH_SCROLL_CONFIG}
						onInitialized={props.onInitialized}
						onInput={props.onInput}
						onResize={props.onResize}
						onScrollbackBatch={props.onScrollbackBatch}
						onSelectionModeChange={props.onSelectionModeChange}
					/>
					{overlay ? (
						<View
							style={{
								position: 'absolute',
								top: 0,
								right: 0,
								bottom: 0,
								left: 0,
								alignItems: 'center',
								justifyContent: 'center',
								gap: 14,
								padding: 24,
								backgroundColor: 'rgba(0, 0, 0, 0.72)',
							}}
						>
							{message ? (
								<Text
									style={{
										color: theme.colors.textPrimary,
										textAlign: 'center',
									}}
								>
									{message}
								</Text>
							) : null}
							{props.state.phase === 'owned-elsewhere' ? (
								<View style={{ flexDirection: 'row', gap: 10 }}>
									<OverlayButton
										label="Take Over"
										primary
										onPress={props.onTakeOver}
									/>
									<OverlayButton label="Back" onPress={props.onBack} />
								</View>
							) : null}
							{props.state.phase === 'error' ? (
								<View style={{ flexDirection: 'row', gap: 10 }}>
									<OverlayButton
										label="Retry"
										primary
										onPress={props.onRetry}
									/>
									<OverlayButton label="Back" onPress={props.onBack} />
								</View>
							) : null}
						</View>
					) : null}
				</View>
				<TerminalKeyboard {...props.keyboardProps} />
			</KeyboardAvoidingView>
		</>
	);
}
