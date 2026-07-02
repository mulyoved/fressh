export const connectionDiagnosticSources = [
	'latest-shell',
	'active-connection',
	'saved-entry',
	'tailscale-recovery',
	'reconnect-controller',
	'manual-diagnostic',
	'foreground-service',
	'command-menu',
] as const;

export type ConnectionDiagnosticTrigger =
	| 'initial-auto-connect'
	| 'reconnect'
	| 'manual-diagnostic'
	| 'command-menu';

export type ConnectionDiagnosticStatus =
	| 'running'
	| 'failed'
	| 'connected'
	| 'skipped';

export type ConnectionDiagnosticSource =
	(typeof connectionDiagnosticSources)[number];

export type ConnectionDiagnosticConnectionIdentity = {
	savedConnectionId?: string;
	connectionId?: string;
	username?: string;
	host?: string;
	port?: number;
	keyId?: string;
	useTmux?: boolean;
	tmuxSessionName?: string;
};

export type ConnectionDiagnosticError = {
	name: string;
	message: string;
	stack?: string;
	tag?: string;
	inner?: unknown;
};

export type ConnectionDiagnosticEventBase = {
	source: ConnectionDiagnosticSource;
	message?: string;
};

export type TimedConnectionDiagnosticEvent<Event> = Event & {
	atMs: number;
	elapsedMs: number;
};

export type ConnectionDiagnosticTraceOf<Event> = {
	id: string;
	trigger: ConnectionDiagnosticTrigger;
	reason: string;
	status: ConnectionDiagnosticStatus;
	startedAtMs: number;
	finishedAtMs?: number;
	events: TimedConnectionDiagnosticEvent<Event>[];
};

export type ConnectionDiagnosticTraceHandleOf<Event> = {
	readonly trace: ConnectionDiagnosticTraceOf<Event>;
	event: (input: Event) => TimedConnectionDiagnosticEvent<Event>;
	finish: (status: Exclude<ConnectionDiagnosticStatus, 'running'>) => void;
};

export type ConnectionDiagnosticAppState = {
	platformOS: string;
	pathname?: string;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	foregroundServiceStarted?: boolean;
	backgroundWorkAllowed?: boolean;
	foregroundServiceRequired?: boolean;
	appActive?: boolean;
};

export type ConnectionDiagnosticRecorderOptions = {
	now?: () => number;
	maxHistory?: number;
};

export type ConnectionDiagnosticPromptOptions = {
	appState?: ConnectionDiagnosticAppState;
};
