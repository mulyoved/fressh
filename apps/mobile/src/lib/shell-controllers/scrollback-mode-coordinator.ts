import { type ScrollTraceSink } from '../scroll-trace';
import { shouldRunTmuxScrollbackRemoteResetForModeChange } from '../tmux-scrollback';
import {
	type ScrollbackModeChangeEvent,
	type ShellScrollbackState,
} from './scrollback-core';

export function createScrollbackModeCoordinator() {
	let invocationGeneration = 0;
	return function handleScrollbackModeChange({
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
		getCurrentState(): ShellScrollbackState & {
			contextIdentity: object | null;
			disposed: boolean;
			executorIdentity: object | null;
			targetOwnershipRevision: number;
		};
		isTerminalInstanceCurrent(instanceId: string): boolean;
		localExitRequestIds: Set<number>;
		onActivated(): void;
		publish(snapshot: ShellScrollbackState): void;
		remoteCopyModeActive: boolean;
		resetRemote(): void;
		trace(event: Parameters<ScrollTraceSink>[0]): void;
	}): void {
		const generation = ++invocationGeneration;
		const current = getCurrentState();
		const isInternallyCurrent = () => {
			const latest = getCurrentState();
			return (
				invocationGeneration === generation &&
				!latest.disposed &&
				latest.runtimeInstanceId === current.runtimeInstanceId &&
				latest.contextIdentity === current.contextIdentity &&
				latest.executorIdentity === current.executorIdentity &&
				latest.targetOwnershipRevision === current.targetOwnershipRevision
			);
		};
		if (
			current.disposed ||
			event.instanceId !== current.runtimeInstanceId ||
			!isTerminalInstanceCurrent(event.instanceId)
		) {
			return;
		}
		if (!isInternallyCurrent()) return;
		if (event.active && !current.active) onActivated();
		if (!isInternallyCurrent()) return;
		trace({
			event: 'rn.mode',
			active: event.active,
			phase: event.phase,
			instanceId: event.instanceId,
			requestId: event.requestId,
			remoteCopyModeActive,
		});
		if (!isInternallyCurrent()) return;
		if (current.active !== event.active || current.phase !== event.phase) {
			publish({
				active: event.active,
				phase: event.phase,
				runtimeInstanceId: current.runtimeInstanceId,
			});
		}
		if (!isInternallyCurrent()) return;
		if (
			shouldRunTmuxScrollbackRemoteResetForModeChange({
				active: event.active,
				requestId: event.requestId,
				localExitRequestIds,
			})
		) {
			resetRemote();
		}
	};
}
