export const HERDR_STATUS_ORDER = [
	'blocked',
	'done',
	'working',
	'idle',
	'unknown',
] as const;

export type HerdrAgentStatus = (typeof HERDR_STATUS_ORDER)[number];

export type HerdrAgent = Readonly<{
	terminalId: string;
	paneId: string;
	workspaceId: string;
	workspaceLabel: string;
	tabId: string;
	tabLabel: string;
	label: string;
	status: HerdrAgentStatus;
	cwdBasename: string | null;
	order: number;
}>;

export type HerdrSnapshot = Readonly<{
	version: string;
	protocol: number;
	agents: readonly HerdrAgent[];
}>;

export type HerdrHostState = Readonly<{
	storedConnectionId: string;
	connectionId: string;
	snapshot: HerdrSnapshot;
}>;

export type HerdrAgentGroup = Readonly<{
	status: HerdrAgentStatus;
	label: 'Needs attention' | 'Ready' | 'Working' | 'Idle' | 'Unknown';
	agents: readonly HerdrAgent[];
}>;
