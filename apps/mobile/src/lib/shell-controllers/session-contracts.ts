// eslint-disable-next-line import/consistent-type-specifier-style -- Avoid loading the React Native package in Node core tests.
import type {
	BufferReadResult,
	Cursor,
	ListenerEvent,
} from '@fressh/react-native-uniffi-russh';
import { type MdevBridgeFailureClass } from '../mdev-bridge-client';
import { type WorkmuxScrollDirection } from '../workmux-app-commands';
import { type MdevBridgeOperationRequest } from '../workmux-bridge-operations';
import { type ShellActivitySnapshot } from './activity-core';
import { type ControllerOutcome } from './controller-core';
import { type ShellDiagnosticPort } from './session-diagnostics';
import { type ShellTargetKey, type ShellTransportKey } from './source-keys';

export type ShellSessionSnapshot =
	| {
			status: 'waiting';
			reason: 'auto-connect' | 'reconnect';
			generation: number;
	  }
	| {
			status: 'attach-error';
			failureReason?: string;
			sessionName: string;
			generation: number;
	  }
	| { status: 'ready'; storedConnectionId?: string; generation: number }
	| { status: 'leaving'; generation: number };

export type ShellSessionNavigation = {
	back(): void;
	editHost(storedConnectionId: string): void;
};

export type ShellSessionSource = {
	connectionPresent: boolean;
	shellPresent: boolean;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	lastReconnectOutcome: { status: string; destination: string } | null;
	storedConnectionId?: string;
};

export type RetiringWorkmuxCleanupPort = {
	exitScroll(input: { sessionName: string }): Promise<ControllerOutcome>;
};

export type ShellWorkmuxFailure = {
	message: string;
	failureClass?: MdevBridgeFailureClass;
};

export type ShellWorkmuxOutcome = ControllerOutcome<ShellWorkmuxFailure> & {
	output?: string;
};

export type ShellWorkmuxScrollPort = {
	enter(input: { sessionName: string }): Promise<ShellWorkmuxOutcome>;
	move(input: {
		sessionName: string;
		direction: WorkmuxScrollDirection;
		unit: 'line' | 'page';
		count: number;
	}): Promise<ShellWorkmuxOutcome>;
	exit(input: { sessionName: string }): Promise<ShellWorkmuxOutcome>;
};

export type ShellWorkmuxPort = {
	readonly key: ShellTargetKey;
	command(
		argv: string[],
		options?: { timeoutMs?: number },
	): Promise<ShellWorkmuxOutcome>;
	operation(
		request: MdevBridgeOperationRequest,
		options?: { timeoutMs?: number },
	): Promise<ShellWorkmuxOutcome>;
	scroll: ShellWorkmuxScrollPort;
	registerBeforeDispose(
		owner: string,
		cleanup: (port: RetiringWorkmuxCleanupPort) => Promise<void>,
	): () => void;
};

declare const shellTerminalListenerRegistrationBrand: unique symbol;

export type ShellTerminalListenerRegistration = Readonly<{
	[shellTerminalListenerRegistrationBrand]: true;
}>;

export type ShellTerminalNativeOutputDiagnostics = {
	currentSeq: string;
	ringBytesCount: string;
	usedBytes: string;
	headSeq: string;
	tailSeq: string;
	droppedBytesTotal: string;
	chunksCount: string;
};

export type ShellTerminalSourcePort = {
	readonly key: ShellTransportKey;
	readonly generation: number;
	readonly connectionId: string;
	readonly channelId: number;
	isAvailable(): boolean;
	getNativeOutputDiagnostics(): ShellTerminalNativeOutputDiagnostics | null;
	readBuffer(cursor: Cursor): BufferReadResult | Promise<BufferReadResult>;
	addListener(
		listener: (event: ListenerEvent) => void,
		options: { cursor: Cursor },
	): Promise<ShellTerminalListenerRegistration>;
	removeListener(registration: ShellTerminalListenerRegistration): void;
	sendData(bytes: Uint8Array<ArrayBufferLike>): Promise<void>;
	resizePty(cols: number, rows: number): Promise<void>;
};

export type ShellHostCommandPort = {
	readonly key: ShellTargetKey;
	run(
		command: string,
		timeoutMs: number,
	): Promise<
		ControllerOutcome<{
			message: string;
			reason?: 'no-detail';
		}> & {
			output?: string;
			issueUrl?: string | null;
		}
	>;
};

export type ShellActivityPort = {
	getSnapshot(): ShellActivitySnapshot;
	subscribe(listener: () => void): () => void;
};

export type ShellSessionPorts = {
	terminalSource: ShellTerminalSourcePort;
	hostCommands: ShellHostCommandPort;
	workmux: ShellWorkmuxPort;
	diagnostics: ShellDiagnosticPort;
	activity: ShellActivityPort;
};
