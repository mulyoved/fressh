import { type restartCodexWithBridge } from '@/lib/codex-restart';
import {
	type WorkmuxKeyboardCommand,
	type WorkmuxKeyboardCommandRunResult,
} from '@/lib/keyboard-actions';
import { type CommandBridgeEntry } from '@/lib/shell-config';
import { type ShellConfigState } from '@/lib/shell-config-store';
import { type WorkmuxNavScope } from '@/lib/workmux-app-commands';
import { type WorkmuxControlChannel } from '@/lib/workmux-control-channel';

import { type ControllerInvalidationReason } from './controller-core';
import { type TerminalOutputDiagnosticSnapshot } from './terminal-output-diagnostics';

export type ShellKeyboardRemoteOutcome =
	| { status: 'handled' }
	| { status: 'failed' }
	| { status: 'superseded' }
	| { status: 'unavailable' };

export type ShellKeyboardRemoteActivitySnapshot = {
	focused: boolean;
	appActive: boolean;
	interactive: boolean;
	generation: number;
};

export type ShellKeyboardRemoteTargetContext = {
	targetKey: string;
	tmuxEnabled: boolean;
	sessionName: string;
	connectionId: string;
	channelId: number;
	workmuxControlChannel: Pick<WorkmuxControlChannel, 'command' | 'operation'>;
	source: unknown;
};

export type ShellKeyboardRemoteLogger = {
	info(message: string, details?: unknown): void;
	warn(message: string, details?: unknown): void;
};

export type ShellKeyboardRemoteStatePort = {
	getSnapshot(): { shellConfigState: ShellConfigState };
	setShellConfigState(state: ShellConfigState): void;
};

export type ShellKeyboardRemoteCore = {
	runWorkmuxCommand(
		command: WorkmuxKeyboardCommand,
	): Promise<WorkmuxKeyboardCommandRunResult>;
	reloadConfig(): Promise<ShellKeyboardRemoteOutcome>;
	restartCodex(options?: {
		timeoutMs?: number;
	}): Promise<ShellKeyboardRemoteOutcome>;
	handleCommandBridgeEntry(
		entry: CommandBridgeEntry,
	): Promise<ShellKeyboardRemoteOutcome>;
	setTargetContext(context: ShellKeyboardRemoteTargetContext): void;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export type CreateShellKeyboardRemoteCoreOptions = {
	initialTargetContext: ShellKeyboardRemoteTargetContext;
	getActivitySnapshot(): ShellKeyboardRemoteActivitySnapshot;
	getNavScope(): WorkmuxNavScope;
	keyboardState: ShellKeyboardRemoteStatePort;
	reloadRuntimeShellConfig(): PromiseLike<ShellConfigState>;
	closeCommandMenu(): void;
	showAlert(title: string, message: string): void;
	invalidateShellTransport(connectionId: string, channelId: number): void;
	readTerminalOutputDiagnostics(): TerminalOutputDiagnosticSnapshot | null;
	logger?: ShellKeyboardRemoteLogger;
	now?: () => number;
	restartCodex?: typeof restartCodexWithBridge;
};
