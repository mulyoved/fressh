import { XtermJsWebView } from '@fressh/react-native-xtermjs-webview';
import { Stack } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rootLogger } from '@/lib/logger';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import {
	type BrowserActionsModalProps,
	type DetectedOpenPickerModalProps,
	type HostUrlModalProps,
} from '@/lib/shell-controllers/browser-actions';
import { type FeatureRequestModalProps } from '@/lib/shell-controllers/feature-request';
import { type ShellKeyboardControllerHandle } from '@/lib/shell-controllers/keyboard';
import { type ShellScrollbackControllerHandle } from '@/lib/shell-controllers/scrollback';
import { type SimpleModalHandle } from '@/lib/shell-controllers/simple-modals';
import { type SkillSelectorModalProps } from '@/lib/shell-controllers/skill-selector';
import { type ShellTerminalControllerHandle } from '@/lib/shell-controllers/terminal';
import { type ShellWisprControllerHandle } from '@/lib/shell-controllers/wispr';
import { type WorktreeWorkspaceModalControllerProps } from '@/lib/shell-controllers/worktree-workspace-modal-props';
import { useTheme } from '@/lib/theme';
import { BrowserActionsModal } from './components/BrowserActionsModal';
import { CommandMenuModal } from './components/CommandMenuModal';
import { ConfigureModal } from './components/ConfigureModal';
import { DetectedOpenPickerModal } from './components/DetectedOpenPickerModal';
import { FeatureRequestModal } from './components/FeatureRequestModal';
import { HostUrlModal } from './components/HostUrlModal';
import { SkillSelectorModal } from './components/SkillSelectorModal';
import { TerminalCommanderModal } from './components/TerminalCommanderModal';
import { TerminalKeyboard } from './components/TerminalKeyboard';
import { TextEntryModal } from './components/TextEntryModal';
import { WorktreeWorkspaceModal } from './components/WorktreeWorkspaceModal';
import { type ShellTouchScrollPolicy } from './shell-touch-scroll';
import { KeyboardFlash, ReconnectOverlay } from './ShellScreenOverlays';
import {
	ShellRouteSkeleton,
	TerminalErrorBoundary,
	TmuxAttachErrorScreen,
} from './ShellScreenStates';

const logger = rootLogger.extend('TabsShellDetail');
const ScrollbackIcon = resolveLucideIcon('ArrowDownToLine');

export type ShellScreenSessionView =
	| {
			status: 'attach-error';
			failureReason?: string;
			sessionName: string;
			onEdit(): void;
	  }
	| { status: 'leaving' }
	| { status: 'waiting'; terminalHasRendered: boolean }
	| { status: 'ready' };

export type ShellScreenTerminalView = Pick<
	ShellTerminalControllerHandle,
	'xtermRef' | 'onLoadStart' | 'onResize' | 'onInitialized' | 'retry'
> & {
	view: Pick<ShellTerminalControllerHandle['view'], 'fit'>;
	policy: ShellTouchScrollPolicy;
	scrollback: Pick<
		ShellScrollbackControllerHandle,
		'visible' | 'jumpToLive' | 'xtermProps'
	>;
};

export type ShellScreenKeyboardView = Pick<
	ShellKeyboardControllerHandle,
	| 'terminalKeyboardProps'
	| 'onSelectionChanged'
	| 'onSelectionModeChange'
	| 'onWebViewInput'
	| 'flash'
>;

export type ShellScreenModalView = {
	commandMenu: {
		state: SimpleModalHandle;
		props: ShellKeyboardControllerHandle['commandMenuProps'];
	};
	browser: {
		actions: BrowserActionsModalProps;
		detectedOpenPicker: DetectedOpenPickerModalProps;
		hostUrl: HostUrlModalProps;
	};
	commander: {
		state: SimpleModalHandle;
		props: ShellKeyboardControllerHandle['commanderProps'];
	};
	skillSelector: SkillSelectorModalProps;
	textEntry: {
		state: SimpleModalHandle;
		keyboard: ShellKeyboardControllerHandle['textEntryProps'];
		wispr: ShellWisprControllerHandle['textEntryProps'];
	};
	configure: {
		state: SimpleModalHandle;
		props: ShellKeyboardControllerHandle['configureProps'];
	};
	featureRequest: FeatureRequestModalProps;
	worktreeWorkspace: WorktreeWorkspaceModalControllerProps;
};

export type ShellScreenViewProps = {
	session: ShellScreenSessionView;
	terminal: ShellScreenTerminalView;
	keyboard: ShellScreenKeyboardView;
	modals: ShellScreenModalView;
};

export function ShellScreenView({
	session,
	terminal,
	keyboard,
	modals,
}: ShellScreenViewProps): React.ReactElement | null {
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	if (session.status === 'attach-error') {
		return <TmuxAttachErrorScreen {...session} />;
	}
	if (session.status === 'leaving') return null;
	if (session.status === 'waiting' && !session.terminalHasRendered) {
		return <ShellRouteSkeleton />;
	}
	const showReconnectOverlay = session.status === 'waiting';
	const modalBottomOffset = Platform.OS === 'android' ? insets.bottom + 24 : 24;

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
				<TerminalErrorBoundary onRetry={terminal.retry}>
					<View style={{ flex: 1 }}>
						<XtermJsWebView
							ref={terminal.xtermRef}
							style={{ flex: 1 }}
							webViewOptions={{
								contentInsetAdjustmentBehavior: 'never',
								onLoadStart: terminal.onLoadStart,
								onLayout: terminal.view.fit,
							}}
							logger={{
								log: logger.info,
								warn: logger.warn,
								error: logger.error,
							}}
							xtermOptions={{
								scrollback: terminal.policy.xtermScrollback,
								theme: {
									background: theme.colors.background,
									foreground: theme.colors.textPrimary,
									...(Platform.OS === 'android'
										? {
												selectionBackground: '#F5F5F5',
												selectionForeground: '#000000',
												selectionInactiveBackground: 'rgba(255, 255, 255, 0.6)',
											}
										: {
												selectionBackground: 'rgba(37, 99, 235, 0.35)',
												selectionInactiveBackground: 'rgba(37, 99, 235, 0.2)',
											}),
								},
							}}
							touchScrollConfig={terminal.policy.touchScrollConfig}
							onResize={terminal.onResize}
							onSelection={keyboard.onSelectionChanged}
							onSelectionModeChange={keyboard.onSelectionModeChange}
							onInitialized={terminal.onInitialized}
							onInput={keyboard.onWebViewInput}
							{...terminal.scrollback.xtermProps}
						/>
						{terminal.scrollback.visible ? (
							<Pressable
								onPress={terminal.scrollback.jumpToLive}
								style={{
									position: 'absolute',
									right: 16,
									bottom: 16,
									width: 48,
									height: 48,
									borderRadius: 999,
									alignItems: 'center',
									justifyContent: 'center',
									backgroundColor: 'rgba(15, 23, 42, 0.92)',
									borderWidth: 1,
									borderColor: 'rgba(148, 163, 184, 0.35)',
								}}
							>
								{ScrollbackIcon ? (
									<ScrollbackIcon color={theme.colors.textPrimary} size={20} />
								) : null}
							</Pressable>
						) : null}
					</View>
				</TerminalErrorBoundary>
				<TerminalKeyboard {...keyboard.terminalKeyboardProps} />
				<CommandMenuModal
					open={modals.commandMenu.state.open}
					bottomOffset={modalBottomOffset}
					onClose={modals.commandMenu.state.onClose}
					{...modals.commandMenu.props}
				/>
				<BrowserActionsModal
					bottomOffset={modalBottomOffset}
					{...modals.browser.actions}
				/>
				<DetectedOpenPickerModal
					bottomOffset={modalBottomOffset}
					{...modals.browser.detectedOpenPicker}
				/>
				<TerminalCommanderModal
					open={modals.commander.state.open}
					bottomOffset={modalBottomOffset}
					onClose={modals.commander.state.onClose}
					{...modals.commander.props}
				/>
				<SkillSelectorModal
					bottomOffset={modalBottomOffset}
					{...modals.skillSelector}
				/>
				<WorktreeWorkspaceModal
					bottomOffset={modalBottomOffset}
					{...modals.worktreeWorkspace}
				/>
				<TextEntryModal
					open={modals.textEntry.state.open}
					bottomOffset={modalBottomOffset}
					{...modals.textEntry.keyboard}
					{...modals.textEntry.wispr}
				/>
				<HostUrlModal
					bottomOffset={modalBottomOffset}
					{...modals.browser.hostUrl}
				/>
				<ConfigureModal
					open={modals.configure.state.open}
					bottomOffset={modalBottomOffset}
					onClose={modals.configure.state.onClose}
					{...modals.configure.props}
				/>
				<FeatureRequestModal
					bottomOffset={modalBottomOffset}
					{...modals.featureRequest}
				/>
				{showReconnectOverlay ? <ReconnectOverlay /> : null}
				{keyboard.flash.name ? <KeyboardFlash flash={keyboard.flash} /> : null}
			</KeyboardAvoidingView>
		</>
	);
}
