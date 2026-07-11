import { type ScrollTraceSink } from '../scroll-trace';
import { shouldRunTmuxScrollbackRemoteResetForModeChange } from '../tmux-scrollback';
import {
	type ScrollbackModeChangeEvent,
	type ShellScrollbackState,
} from './scrollback-core';

export function handleScrollbackModeChange({
	event,
	getCurrentState,
	isTerminalInstanceCurrent,
	localExitRequestIds,
	onActivated,
	publish,
	remoteCopyModeActive,
	resetRemote,
	trace,
}: {
	event: ScrollbackModeChangeEvent;
	getCurrentState(): ShellScrollbackState & { disposed: boolean };
	isTerminalInstanceCurrent(instanceId: string): boolean;
	localExitRequestIds: Set<number>;
	onActivated(): void;
	publish(snapshot: ShellScrollbackState): void;
	remoteCopyModeActive: boolean;
	resetRemote(): void;
	trace(event: Parameters<ScrollTraceSink>[0]): void;
}): void {
	const current = getCurrentState();
	if (
		current.disposed ||
		event.instanceId !== current.runtimeInstanceId ||
		!isTerminalInstanceCurrent(event.instanceId)
	) {
		return;
	}
	if (event.active && !current.active) onActivated();
	trace({
		event: 'rn.mode',
		active: event.active,
		phase: event.phase,
		instanceId: event.instanceId,
		requestId: event.requestId,
		remoteCopyModeActive,
	});
	if (current.active !== event.active || current.phase !== event.phase) {
		publish({
			active: event.active,
			phase: event.phase,
			runtimeInstanceId: current.runtimeInstanceId,
		});
	}
	if (
		shouldRunTmuxScrollbackRemoteResetForModeChange({
			active: event.active,
			requestId: event.requestId,
			localExitRequestIds,
		})
	) {
		resetRemote();
	}
}
