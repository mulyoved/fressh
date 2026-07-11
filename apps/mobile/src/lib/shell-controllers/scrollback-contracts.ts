import { type ScrollTraceSink } from '../scroll-trace';
import { type WorkmuxControlChannel } from '../workmux-control-channel';
import { type ShellActivitySnapshot } from './activity-core';
import { type ControllerOutcome } from './controller-core';
import { type ShellTargetKey } from './source-keys';
import { type ShellTerminalViewPort } from './terminal';
import { type ShellTerminalTransportPort } from './terminal-transport';

export type ShellScrollbackState = {
	active: boolean;
	phase: 'dragging' | 'active';
	runtimeInstanceId: string | null;
};
export type ScrollbackModeChangeEvent = {
	active: boolean;
	phase: 'dragging' | 'active';
	instanceId: string;
	requestId?: number;
};
export type ScrollbackEnterRequestedEvent = {
	instanceId: string;
	requestId: number;
};
export type ScrollbackBatchEvent = {
	direction: 'up' | 'down';
	pages: number;
	lines: number;
	pageStep: number;
	instanceId: string;
	seq?: number;
	ts?: number;
	source?: 'touch-scroll' | 'selection-handle';
};
export type ShellLiveInputOptions = {
	interSegmentDelayMs?: number;
	onAccepted?: () => void;
};
export type ShellScrollbackInputPort = {
	sendSegments(
		segments: readonly Uint8Array<ArrayBuffer>[],
		options?: ShellLiveInputOptions,
	): Promise<ControllerOutcome<{ message: string }>>;
};
export type ShellScrollbackFeedback = {
	alert(
		title: string,
		message: string,
		buttons?: { text: string; onPress?: () => void }[],
	): void;
	copyMessage(message: string): void;
};
export type ShellScrollbackLogger = {
	warn(message: string, error?: unknown): void;
};
export type ShellScrollbackContext = {
	targetKey: ShellTargetKey;
	targetName: string;
	connectionAvailable: boolean;
	shellAvailable: boolean;
	tmuxEnabled: boolean;
	getActivitySnapshot(): ShellActivitySnapshot;
	getSelectionModeEnabled(): boolean;
	terminalTransport: ShellTerminalTransportPort;
	terminalView: ShellTerminalViewPort;
	workmuxScroll: WorkmuxControlChannel['scroll'];
	trace: ScrollTraceSink;
	feedback: ShellScrollbackFeedback;
	logger: ShellScrollbackLogger;
};
export type ScrollbackCleanupOwnership = Readonly<{
	targetOwnershipRevision: number;
	remoteCopyModeGeneration: number;
	targetKey: ShellTargetKey;
	targetName: string;
}>;
export type ScrollbackRequestAuthority<
	TExecutor extends object = object,
	TInstance extends string | null = string | null,
> = Readonly<{
	context: ShellScrollbackContext;
	executor: TExecutor;
	instanceId: TInstance;
	targetOwnershipRevision: number;
}>;
