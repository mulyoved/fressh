import { createTmuxScrollbackLocalExitRequest } from '../tmux-scrollback-local-exit';
import {
	clearTmuxScrollbackLineAccumulator,
	type TmuxScrollbackLineAccumulator,
} from '../workmux-scrollback-batch';
import {
	type ShellScrollbackContext,
	type ShellScrollbackState,
} from './scrollback-contracts';

export function createScrollbackLocalUiCoordinator({
	getCurrentState,
	isTerminalInstanceCurrent,
	lineAccumulator,
	localExitRequestIds,
	publish,
	warn,
}: {
	getCurrentState(): {
		context: ShellScrollbackContext | null;
		runtimeInstanceId: string | null;
		snapshot: ShellScrollbackState;
	};
	isTerminalInstanceCurrent(
		context: ShellScrollbackContext,
		instanceId: string,
	): boolean;
	lineAccumulator: TmuxScrollbackLineAccumulator;
	localExitRequestIds: Set<number>;
	publish(snapshot: ShellScrollbackState): void;
	warn(context: ShellScrollbackContext, message: string, error: unknown): void;
}) {
	let nextRequestId = 0;
	return (
		context: ShellScrollbackContext,
		token?: { instanceId: string | null; isCurrent(): boolean },
	): void => {
		let current = getCurrentState();
		if (
			token &&
			(!token.isCurrent() || current.runtimeInstanceId !== token.instanceId)
		) {
			return;
		}
		if (current.snapshot.active || current.snapshot.phase !== 'active') {
			publish({
				active: false,
				phase: 'active',
				runtimeInstanceId: current.runtimeInstanceId,
			});
		}
		current = getCurrentState();
		clearTmuxScrollbackLineAccumulator(lineAccumulator);
		if (token && !token.isCurrent()) return;
		const instanceId = token?.instanceId ?? current.runtimeInstanceId;
		if (
			instanceId === null ||
			current.context !== context ||
			!isTerminalInstanceCurrent(context, instanceId)
		) {
			return;
		}
		current = getCurrentState();
		if (
			current.context !== context ||
			current.runtimeInstanceId !== instanceId ||
			(token && !token.isCurrent())
		) {
			return;
		}
		if (token && !token.isCurrent()) return;
		nextRequestId += 1;
		const exitRequest = createTmuxScrollbackLocalExitRequest({
			requestIds: localExitRequestIds,
			requestId: nextRequestId,
			instanceId,
		});
		try {
			context.terminalView.exitScrollback(exitRequest.message);
		} catch (error) {
			warn(context, 'Scrollback local exit failed', error);
		}
		if (token && !token.isCurrent()) {
			localExitRequestIds.delete(nextRequestId);
		}
	};
}
