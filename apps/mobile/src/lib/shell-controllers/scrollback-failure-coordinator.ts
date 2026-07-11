import { type ScrollTraceSink } from '../scroll-trace';
import { type WorkmuxScrollbackFailureContext } from '../workmux-scrollback-executor';
import {
	type ShellScrollbackContext,
	type ShellScrollbackLogger,
} from './scrollback-contracts';
import {
	handleShellWorkmuxScrollbackCommandFailureActions,
	shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive,
} from './scrollback-policy';

export function createScrollbackFailureCoordinator({
	clearLocalState,
	clearState,
	isCurrentContext,
	remoteCopyModeActive,
	remoteCopyModeGeneration,
	trace,
	warn,
}: {
	clearLocalState(context: ShellScrollbackContext): void;
	clearState(
		context: ShellScrollbackContext,
		failurePolicy?: 'notify' | 'suppress',
	): void;
	isCurrentContext(context: ShellScrollbackContext): boolean;
	remoteCopyModeActive: { current: boolean };
	remoteCopyModeGeneration: { current: number };
	trace(
		context: ShellScrollbackContext,
		event: Parameters<ScrollTraceSink>[0],
	): void;
	warn(logger: ShellScrollbackLogger, message: string, error?: unknown): void;
}) {
	return (
		context: ShellScrollbackContext,
		message: string,
		failure: WorkmuxScrollbackFailureContext,
	): void => {
		if (!isCurrentContext(context)) return;
		if (
			shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive({
				message,
				commandKind: failure.commandKind,
			})
		) {
			trace(context, {
				event: 'rn.remote.inactive',
				reason: 'not-in-mode',
				commandKind: failure.commandKind,
				message,
			});
			if (!isCurrentContext(context)) return;
			warn(context.logger, message);
			if (!isCurrentContext(context)) return;
			remoteCopyModeGeneration.current += 1;
			remoteCopyModeActive.current = false;
			clearLocalState(context);
			return;
		}
		let interactive = false;
		try {
			interactive = context.getActivitySnapshot().interactive;
		} catch (error) {
			warn(context.logger, 'Scrollback activity check failed', error);
		}
		if (!isCurrentContext(context)) return;
		if (!interactive) {
			warn(context.logger, message);
			if (!isCurrentContext(context)) return;
			if (failure.commandKind === 'exit') clearLocalState(context);
			else clearState(context, 'suppress');
			return;
		}
		try {
			handleShellWorkmuxScrollbackCommandFailureActions({
				message,
				alert: context.feedback.alert,
				copyMessage: context.feedback.copyMessage,
				clearScrollbackState: () => {
					if (failure.commandKind === 'exit') clearLocalState(context);
					else clearState(context);
				},
				isCurrent: () => isCurrentContext(context),
				warn: (warning) => context.logger.warn(warning),
			});
		} catch (error) {
			warn(context.logger, 'Workmux scrollback failure feedback failed', error);
		}
	};
}
