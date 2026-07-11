import { type ScrollTraceSink } from '../scroll-trace';
import {
	type ShellScrollbackContext,
	type ShellScrollbackLogger,
} from './scrollback-core';

export const createSafeScrollbackWarn =
	(logger: ShellScrollbackLogger | undefined) =>
	(message: string, error?: unknown): void => {
		try {
			logger?.warn(message, error);
		} catch {
			// Logging is observational and cannot interrupt controller ownership.
		}
	};

export function traceScrollbackSafely(
	context: ShellScrollbackContext,
	traceId: string,
	event: Parameters<ScrollTraceSink>[0],
): void {
	try {
		context.trace({ traceId, ...event });
	} catch (error) {
		createSafeScrollbackWarn(context.logger)(
			'Workmux scrollback trace failed',
			error,
		);
	}
}

export function isScrollbackTerminalInstanceCurrent(
	context: ShellScrollbackContext,
	instanceId: string,
): boolean {
	try {
		return context.terminalView.isCurrentInstance(instanceId);
	} catch (error) {
		createSafeScrollbackWarn(context.logger)(
			'Scrollback terminal instance check failed',
			error,
		);
		return false;
	}
}
