import { type ShellConfigState } from '@/lib/shell-config-store';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';

import { type ShellActivitySnapshot } from './activity-core';
import {
	type ShellKeyboardBrowserCommands,
	type ShellKeyboardModalCommands,
} from './keyboard-controller-adapter';
import { type ShellKeyboardInputLogger } from './keyboard-input-contracts';
import {
	type ShellKeyboardRemoteLogger,
	type ShellKeyboardRemoteTargetContext,
} from './keyboard-remote-contracts';
import {
	type ShellKeyboardHistoryStore,
	type ShellKeyboardStateLogger,
} from './keyboard-state-core';
import { type ShellScrollbackInputPort } from './scrollback-contracts';
import { type ShellTerminalRuntimeView } from './terminal-hook-runtime';

export type ShellKeyboardControllerLogger = ShellKeyboardInputLogger &
	ShellKeyboardRemoteLogger &
	ShellKeyboardStateLogger;

export type ShellKeyboardConfigureCommands = {
	onDevServer(): void;
	onHostConfig(): void;
	onRequestFeature(): void;
	onOpenGitHubIssues(): void;
	onOpenShellConfigDocs(): void;
};

export type UseShellKeyboardControllerInput = {
	initialShellConfigState: ShellConfigState;
	historyStore?: ShellKeyboardHistoryStore;
	activity: {
		snapshot: ShellActivitySnapshot;
		getSnapshot(): ShellActivitySnapshot;
	};
	sourceKey: unknown;
	scrollbackInput: ShellScrollbackInputPort;
	terminalView: ShellTerminalRuntimeView;
	remoteTarget: ShellKeyboardRemoteTargetContext;
	navScope: WorkmuxNavScope;
	setNavScope(scope: WorkmuxNavScope): void;
	modalCommands: ShellKeyboardModalCommands;
	browserCommands: ShellKeyboardBrowserCommands;
	fitTerminalToDevice(): void | Promise<void>;
	debugConnectionInCodex(): void | Promise<void>;
	reloadRuntimeShellConfig(): PromiseLike<ShellConfigState>;
	showAlert(title: string, message: string): void;
	invalidateShellTransport(connectionId: string, channelId: number): void;
	configureCommands: ShellKeyboardConfigureCommands;
	logger?: ShellKeyboardControllerLogger;
	platformOS?: string;
};
