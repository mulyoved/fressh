type ShellRouteParam = string | string[];

export type ShellRouteParams = {
	connectionId?: ShellRouteParam;
	channelId?: ShellRouteParam;
	storedConnectionId?: ShellRouteParam;
	agentConnectionId?: ShellRouteParam;
	agentSession?: ShellRouteParam;
	agentWindowId?: ShellRouteParam;
	agentEventId?: ShellRouteParam;
	agentTapToken?: ShellRouteParam;
	tmuxError?: ShellRouteParam;
	tmuxAttachFailureReason?: ShellRouteParam;
	tmuxSessionName?: ShellRouteParam;
};

export type ShellAgentRoute = {
	connectionId: string | null;
	session: string | null;
	windowId: string | null;
	eventId: string | null;
	tapToken: string | null;
};

export type ShellTmuxAttachRoute =
	| { status: 'normal'; sessionName: string }
	| { status: 'failed'; sessionName: string; failureReason?: string };

export type ShellRouteRequest = {
	connectionId: string;
	channelId: number;
	storedConnectionId?: string;
	agentRoute: ShellAgentRoute;
	tmuxAttach: ShellTmuxAttachRoute;
};

export type ShellRouteError = {
	code: 'missing-connection-id' | 'invalid-channel-id';
	message: string;
};

export type ShellRouteResult =
	| { status: 'valid'; request: ShellRouteRequest }
	| { status: 'invalid'; error: ShellRouteError };

const optional = (value?: ShellRouteParam): string | null =>
	typeof value === 'string' ? value.trim() || null : null;

export function parseShellRoute(params: ShellRouteParams): ShellRouteResult {
	const connectionId = optional(params.connectionId);
	if (!connectionId) {
		return {
			status: 'invalid',
			error: {
				code: 'missing-connection-id',
				message: 'This shell link is missing a connection.',
			},
		};
	}
	const rawChannelId = optional(params.channelId) ?? '';
	const channelId = Number(rawChannelId);
	if (!/^\d+$/.test(rawChannelId) || !Number.isSafeInteger(channelId)) {
		return {
			status: 'invalid',
			error: {
				code: 'invalid-channel-id',
				message: 'This shell link has an invalid channel.',
			},
		};
	}
	const sessionName = optional(params.tmuxSessionName) ?? 'main';
	const storedConnectionId = optional(params.storedConnectionId);
	return {
		status: 'valid',
		request: {
			connectionId,
			channelId,
			...(storedConnectionId ? { storedConnectionId } : {}),
			agentRoute: {
				connectionId: optional(params.agentConnectionId),
				session: optional(params.agentSession),
				windowId: optional(params.agentWindowId),
				eventId: optional(params.agentEventId),
				tapToken: optional(params.agentTapToken),
			},
			tmuxAttach:
				params.tmuxError === 'attach-failed'
					? {
							status: 'failed',
							sessionName,
							...(optional(params.tmuxAttachFailureReason)
								? {
										failureReason: optional(params.tmuxAttachFailureReason)!,
									}
								: {}),
						}
					: { status: 'normal', sessionName },
		},
	};
}
