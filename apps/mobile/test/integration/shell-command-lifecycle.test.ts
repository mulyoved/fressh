import assert from 'node:assert/strict';
import test from 'node:test';
import { syncShellCommandLifecycle } from '../../src/lib/shell-controllers/shell-command-lifecycle';
import {
	createShellTargetKey,
	createShellTransportKey,
} from '../../src/lib/shell-controllers/source-keys';

const firstTarget = createShellTargetKey(
	createShellTransportKey('connection', 7),
	'main',
);
const secondTarget = createShellTargetKey(
	createShellTransportKey('connection', 7),
	'other',
);

void test('shell command lifecycle invalidates once for every independent boundary', () => {
	const firstConnection = { id: 'connection-1' };
	const secondConnection = { id: 'connection-2' };
	const initial = {
		targetKey: firstTarget,
		tmuxEnabled: true,
		connection: firstConnection as object | null,
	};
	const cases = [
		{
			name: 'unchanged',
			next: { ...initial },
			expected: [],
		},
		{
			name: 'target-only',
			next: { ...initial, targetKey: secondTarget },
			expected: ['workmux', 'codex'],
		},
		{
			name: 'tmux-only',
			next: { ...initial, tmuxEnabled: false },
			expected: ['workmux', 'codex'],
		},
		{
			name: 'connection-to-null',
			next: { ...initial, connection: null },
			expected: ['workmux', 'codex'],
		},
		{
			name: 'connection-replacement',
			next: { ...initial, connection: secondConnection },
			expected: ['workmux', 'codex'],
		},
		{
			name: 'simultaneous',
			next: {
				targetKey: secondTarget,
				tmuxEnabled: false,
				connection: secondConnection,
			},
			expected: ['workmux', 'codex'],
		},
	] as const;

	for (const input of cases) {
		const tracked = { current: initial };
		const events: string[] = [];
		syncShellCommandLifecycle({
			trackedSource: tracked,
			nextSource: input.next,
			invalidateWorkmux: () => {
				assert.equal(tracked.current, input.next, input.name);
				events.push('workmux');
			},
			invalidateCodex: () => {
				assert.equal(tracked.current, input.next, input.name);
				events.push('codex');
			},
		});

		assert.equal(tracked.current, input.next, input.name);
		assert.deepEqual(events, input.expected, input.name);
	}
});
