import { WorkmuxControlChannelCleanupTimeoutError } from '../workmux-control-channel';
import { type ShellScrollbackLogger } from './scrollback-contracts';

export function reportShellScrollbackChannelCleanupError({
	error,
	logger,
}: {
	error: unknown;
	logger: ShellScrollbackLogger;
}): void {
	if (!(error instanceof WorkmuxControlChannelCleanupTimeoutError)) return;
	try {
		logger.warn(
			'Workmux scrollback cleanup timed out before control channel disposal',
			error,
		);
	} catch {
		// Channel teardown must not depend on diagnostics.
	}
}
