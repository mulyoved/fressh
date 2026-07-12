import assert from 'node:assert/strict';
import test from 'node:test';
import { reportShellScrollbackChannelCleanupError } from '../../src/lib/shell-controllers/scrollback-channel-teardown';
import { WorkmuxControlChannelCleanupTimeoutError } from '../../src/lib/workmux-control-channel';

void test('scrollback channel teardown reports only timeout through the owning logger', () => {
	const warnings: { message: string; error: unknown }[] = [];
	const timeout = new WorkmuxControlChannelCleanupTimeoutError();
	reportShellScrollbackChannelCleanupError({
		error: timeout,
		logger: {
			warn: (message, error) => warnings.push({ message, error }),
		},
	});
	reportShellScrollbackChannelCleanupError({
		error: new Error('core-owned cleanup rejection'),
		logger: {
			warn: (message, error) => warnings.push({ message, error }),
		},
	});
	assert.deepEqual(warnings, [
		{
			message:
				'Workmux scrollback cleanup timed out before control channel disposal',
			error: timeout,
		},
	]);
});

void test('scrollback channel teardown contains throwing timeout diagnostics', () => {
	assert.doesNotThrow(() =>
		reportShellScrollbackChannelCleanupError({
			error: new WorkmuxControlChannelCleanupTimeoutError(),
			logger: {
				warn: () => {
					throw new Error('logger failed');
				},
			},
		}),
	);
});
