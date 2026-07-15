import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShellRoute } from '../../src/app/shell/shell-route';

void test('shell route normalizes a complete request', () => {
	assert.deepEqual(
		parseShellRoute({
			connectionId: ' connection-1 ',
			channelId: '7',
			storedConnectionId: ' saved-1 ',
			agentConnectionId: ' agent-1 ',
			agentSession: ' main ',
			agentWindowId: ' 2 ',
			agentEventId: ' event-1 ',
			agentTapToken: ' token-1 ',
			tmuxSessionName: ' work ',
		}),
		{
			status: 'valid',
			request: {
				connectionId: 'connection-1',
				channelId: 7,
				storedConnectionId: 'saved-1',
				agentRoute: {
					connectionId: 'agent-1',
					session: 'main',
					windowId: '2',
					eventId: 'event-1',
					tapToken: 'token-1',
				},
				tmuxAttach: { status: 'normal', sessionName: 'work' },
			},
		},
	);
});

void test('shell route rejects a missing connection id', () => {
	assert.deepEqual(parseShellRoute({ channelId: '1' }), {
		status: 'invalid',
		error: {
			code: 'missing-connection-id',
			message: 'This shell link is missing a connection.',
		},
	});
});

for (const channelId of [undefined, '', '1x', '-1', '1.5']) {
	void test(`shell route rejects channel id ${String(channelId)}`, () => {
		assert.equal(
			parseShellRoute({ connectionId: 'connection-1', channelId }).status,
			'invalid',
		);
	});
}

for (const [channelId, expectedChannelId] of [
	['0', 0],
	[String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
] as const) {
	void test(`shell route accepts safe channel id ${channelId}`, () => {
		const result = parseShellRoute({
			connectionId: 'connection-1',
			channelId,
		});

		assert.equal(result.status, 'valid');
		if (result.status === 'valid') {
			assert.equal(result.request.channelId, expectedChannelId);
		}
	});
}

void test('shell route rejects a channel id above the safe integer boundary', () => {
	assert.deepEqual(
		parseShellRoute({
			connectionId: 'connection-1',
			channelId: String(Number.MAX_SAFE_INTEGER + 1),
		}),
		{
			status: 'invalid',
			error: {
				code: 'invalid-channel-id',
				message: 'This shell link has an invalid channel.',
			},
		},
	);
});

void test('shell route preserves tmux attach failure as typed state', () => {
	const result = parseShellRoute({
		connectionId: 'connection-1',
		channelId: '1',
		tmuxError: 'attach-failed',
		tmuxAttachFailureReason: 'session-missing',
		tmuxSessionName: 'main',
	});
	assert.equal(result.status, 'valid');
	if (result.status === 'valid') {
		assert.deepEqual(result.request.tmuxAttach, {
			status: 'failed',
			sessionName: 'main',
			failureReason: 'session-missing',
		});
	}
});

void test('shell route rejects a repeated connection id', () => {
	assert.deepEqual(
		parseShellRoute({
			connectionId: ['connection-1', 'connection-2'],
			channelId: '1',
		}),
		{
			status: 'invalid',
			error: {
				code: 'missing-connection-id',
				message: 'This shell link is missing a connection.',
			},
		},
	);
});

void test('shell route rejects a repeated channel id', () => {
	assert.deepEqual(
		parseShellRoute({ connectionId: 'connection-1', channelId: ['1', '2'] }),
		{
			status: 'invalid',
			error: {
				code: 'invalid-channel-id',
				message: 'This shell link has an invalid channel.',
			},
		},
	);
});

void test('shell route ignores repeated optional parameters', () => {
	assert.deepEqual(
		parseShellRoute({
			connectionId: 'connection-1',
			channelId: '1',
			storedConnectionId: ['saved-1', 'saved-2'],
			agentConnectionId: ['agent-1', 'agent-2'],
			agentSession: ['main', 'other'],
			agentWindowId: ['1', '2'],
			agentEventId: ['event-1', 'event-2'],
			agentTapToken: ['token-1', 'token-2'],
			tmuxError: ['attach-failed', 'attach-failed'],
			tmuxAttachFailureReason: ['missing-1', 'missing-2'],
			tmuxSessionName: ['work', 'other'],
		}),
		{
			status: 'valid',
			request: {
				connectionId: 'connection-1',
				channelId: 1,
				agentRoute: {
					connectionId: null,
					session: null,
					windowId: null,
					eventId: null,
					tapToken: null,
				},
				tmuxAttach: { status: 'normal', sessionName: 'main' },
			},
		},
	);
});
