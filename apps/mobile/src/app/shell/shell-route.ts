export type ShellRouteParams = {
	connectionId?: string;
	channelId?: string;
	storedConnectionId?: string;
	agentConnectionId?: string;
	agentSession?: string;
	agentWindowId?: string;
	agentEventId?: string;
	agentTapToken?: string;
	tmuxError?: string;
	tmuxAttachFailureReason?: string;
	tmuxSessionName?: string;
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

const optional = (value?: string): string | null => value?.trim() || null;

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
	const rawChannelId = params.channelId?.trim() ?? '';
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
