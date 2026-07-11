import { type ScrollTraceSink } from '../scroll-trace';
import { handleTmuxScrollbackBatchEvent } from '../tmux-scrollback';
import { type TmuxScrollbackLineAccumulator } from '../workmux-scrollback-batch';
import { type WorkmuxScrollbackCommandExecutor } from '../workmux-scrollback-executor';
import {
	type ScrollbackBatchEvent,
	type ShellScrollbackContext,
} from './scrollback-core';

export function handleScrollbackBatch({
	context,
	event,
	executor,
	getCurrentState,
	isTerminalInstanceCurrent,
	lineAccumulator,
	onCurrentFailure,
	remoteCopyModeActive,
	scrollbackActive,
	trace,
	warn,
}: {
	context: ShellScrollbackContext;
	event: ScrollbackBatchEvent;
	executor: WorkmuxScrollbackCommandExecutor;
	getCurrentState(): {
		context: ShellScrollbackContext | null;
		disposed: boolean;
		executor: WorkmuxScrollbackCommandExecutor | null;
		runtimeInstanceId: string | null;
		targetOwnershipRevision: number;
	};
	isTerminalInstanceCurrent(
		context: ShellScrollbackContext,
		instanceId: string,
	): boolean;
	lineAccumulator: TmuxScrollbackLineAccumulator;
	onCurrentFailure(message: string): void;
	remoteCopyModeActive: boolean;
	scrollbackActive: boolean;
	trace(event: Parameters<ScrollTraceSink>[0]): void;
	warn(message: string, error?: unknown): void;
}): void {
	const initial = getCurrentState();
	const runtimeInstanceId = initial.runtimeInstanceId;
	const targetOwnershipRevision = initial.targetOwnershipRevision;
	const isInternallyCurrent = () => {
		const current = getCurrentState();
		return (
			!current.disposed &&
			current.context === context &&
			current.executor === executor &&
			current.runtimeInstanceId === runtimeInstanceId &&
			current.targetOwnershipRevision === targetOwnershipRevision
		);
	};
	const isCurrent = () => {
		if (!isInternallyCurrent()) return false;
		const terminalCurrent = isTerminalInstanceCurrent(
			context,
			event.instanceId,
		);
		return terminalCurrent && isInternallyCurrent();
	};
	if (
		runtimeInstanceId === null ||
		event.instanceId !== runtimeInstanceId ||
		!isCurrent()
	) {
		trace({
			event: 'rn.batch.dropped',
			reason: 'stale-instance',
			instanceId: event.instanceId,
			currentInstanceId: runtimeInstanceId,
			direction: event.direction,
			pages: event.pages,
			lines: event.lines,
			pageStep: event.pageStep,
			seq: event.seq,
			webviewTs: event.ts,
			source: event.source,
		});
		return;
	}
	try {
		const selectionModeEnabled = context.getSelectionModeEnabled();
		if (!isCurrent()) return;
		handleTmuxScrollbackBatchEvent({
			event,
			shellAvailable: context.shellAvailable,
			currentInstanceId: runtimeInstanceId,
			selectionModeEnabled,
			tmuxEnabled: context.tmuxEnabled,
			connectionAvailable: context.connectionAvailable,
			scrollbackActive,
			remoteCopyModeActive,
			targetName: context.targetName,
			lineAccumulator,
			enqueueScrollBatch: (commands) =>
				isCurrent()
					? executor.enqueueScrollBatch(commands)
					: Promise.resolve(false),
			isRequestCurrent: isCurrent,
			onEnqueueFailure: (error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (isCurrent()) onCurrentFailure(message);
				else warn(`Stale Workmux scrollback batch failed: ${message}`, error);
			},
			trace,
		});
	} catch (error) {
		warn('Workmux scrollback batch failed', error);
	}
}
