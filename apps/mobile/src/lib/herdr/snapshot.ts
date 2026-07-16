import { z } from 'zod';

import {
	HERDR_STATUS_ORDER,
	type HerdrAgent,
	type HerdrAgentGroup,
	type HerdrAgentStatus,
	type HerdrSnapshot,
} from './contracts';

const nonEmptyIdSchema = z.string().min(1);

const workspaceSchema = z.object({
	workspace_id: nonEmptyIdSchema,
	label: z.string(),
});

const tabSchema = z.object({
	tab_id: nonEmptyIdSchema,
	workspace_id: nonEmptyIdSchema,
	label: z.string(),
});

const paneSchema = z.object({
	pane_id: nonEmptyIdSchema,
	workspace_id: nonEmptyIdSchema,
	tab_id: nonEmptyIdSchema,
	label: z.string().nullable().optional(),
});

const agentSchema = z.object({
	terminal_id: nonEmptyIdSchema,
	pane_id: nonEmptyIdSchema,
	display_agent: z.string().nullable().optional(),
	agent_status: z.unknown().optional(),
	foreground_cwd: z.string().nullable().optional(),
});

const responseSchema = z.object({
	id: z.string(),
	result: z.object({
		type: z.literal('session_snapshot'),
		snapshot: z.object({
			version: z.string(),
			protocol: z.number().int().nonnegative(),
			workspaces: z.array(workspaceSchema),
			tabs: z.array(tabSchema),
			panes: z.array(paneSchema),
			agents: z.array(agentSchema),
		}),
	}),
});

const statusSet = new Set<string>(HERDR_STATUS_ORDER);
const statusIndexes = new Map<HerdrAgentStatus, number>(
	HERDR_STATUS_ORDER.map((status, index) => [status, index]),
);

const groupLabels: Record<HerdrAgentStatus, HerdrAgentGroup['label']> = {
	blocked: 'Needs attention',
	done: 'Ready',
	working: 'Working',
	idle: 'Idle',
	unknown: 'Unknown',
};

const INVALID_SNAPSHOT_MESSAGE = 'Herdr returned an invalid snapshot.';
const HERDR_UNAVAILABLE_MESSAGE =
	'Herdr 0.7.2 or newer is required on the selected host.';

type WorkspacePresentation = {
	index: number;
	label: string;
};

type TabPresentation = {
	index: number;
	workspaceId: string;
	label: string;
};

type PanePresentation = {
	index: number;
	workspaceId: string;
	workspaceIndex: number;
	workspaceLabel: string;
	tabId: string;
	tabIndex: number;
	tabLabel: string;
	label: string | null;
};

function invalidSnapshot(): never {
	throw new Error(INVALID_SNAPSHOT_MESSAGE);
}

function normalizeStatus(value: unknown): HerdrAgentStatus {
	return typeof value === 'string' && statusSet.has(value)
		? (value as HerdrAgentStatus)
		: 'unknown';
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const characterCode = value.charCodeAt(index);
		if (characterCode <= 31 || characterCode === 127) return true;
	}
	return false;
}

function safeCwdBasename(cwd: string | null | undefined): string | null {
	if (!cwd || hasControlCharacter(cwd)) {
		return null;
	}

	const parts = cwd.split('/').filter(Boolean);
	const basename = parts.at(-1);
	return basename && basename !== '.' && basename !== '..' ? basename : null;
}

function preferredAgentLabel(input: {
	displayAgent: string | null | undefined;
	paneLabel: string | null;
	terminalId: string;
}): string {
	const displayAgent = input.displayAgent?.trim();
	if (displayAgent) return displayAgent;
	const paneLabel = input.paneLabel?.trim();
	return paneLabel || input.terminalId;
}

function addUnique<K, V>(map: Map<K, V>, key: K, value: V): void {
	if (map.has(key)) invalidSnapshot();
	map.set(key, value);
}

function normalizeSnapshot(
	raw: z.infer<typeof responseSchema>['result']['snapshot'],
): HerdrSnapshot {
	const workspaces = new Map<string, WorkspacePresentation>();
	for (const [index, workspace] of raw.workspaces.entries()) {
		addUnique(workspaces, workspace.workspace_id, {
			index,
			label: workspace.label,
		});
	}

	const tabs = new Map<string, TabPresentation>();
	for (const [index, tab] of raw.tabs.entries()) {
		if (!workspaces.has(tab.workspace_id)) invalidSnapshot();
		addUnique(tabs, tab.tab_id, {
			index,
			workspaceId: tab.workspace_id,
			label: tab.label,
		});
	}

	const panes = new Map<string, PanePresentation>();
	for (const [index, pane] of raw.panes.entries()) {
		const workspace = workspaces.get(pane.workspace_id);
		const tab = tabs.get(pane.tab_id);
		if (!workspace || !tab || tab.workspaceId !== pane.workspace_id) {
			invalidSnapshot();
		}
		addUnique(panes, pane.pane_id, {
			index,
			workspaceId: pane.workspace_id,
			workspaceIndex: workspace.index,
			workspaceLabel: workspace.label,
			tabId: pane.tab_id,
			tabIndex: tab.index,
			tabLabel: tab.label,
			label: pane.label ?? null,
		});
	}

	const orderedPanes = [...panes.entries()].sort(([, left], [, right]) => {
		return (
			left.workspaceIndex - right.workspaceIndex ||
			left.tabIndex - right.tabIndex ||
			left.index - right.index
		);
	});
	const paneOrder = new Map(
		orderedPanes.map(([paneId], index) => [paneId, index]),
	);

	const terminalIds = new Set<string>();
	const agents: HerdrAgent[] = raw.agents.map((agent) => {
		if (terminalIds.has(agent.terminal_id)) invalidSnapshot();
		terminalIds.add(agent.terminal_id);

		const pane = panes.get(agent.pane_id);
		const order = paneOrder.get(agent.pane_id);
		if (!pane || order === undefined) invalidSnapshot();

		return {
			terminalId: agent.terminal_id,
			paneId: agent.pane_id,
			workspaceId: pane.workspaceId,
			workspaceLabel: pane.workspaceLabel,
			tabId: pane.tabId,
			tabLabel: pane.tabLabel,
			label: preferredAgentLabel({
				displayAgent: agent.display_agent,
				paneLabel: pane.label,
				terminalId: agent.terminal_id,
			}),
			status: normalizeStatus(agent.agent_status),
			cwdBasename: safeCwdBasename(agent.foreground_cwd),
			order,
		};
	});

	agents.sort((left, right) => {
		return (
			(statusIndexes.get(left.status) ?? Number.MAX_SAFE_INTEGER) -
				(statusIndexes.get(right.status) ?? Number.MAX_SAFE_INTEGER) ||
			left.order - right.order
		);
	});

	return {
		version: raw.version,
		protocol: raw.protocol,
		agents,
	};
}

export const HERDR_SNAPSHOT_COMMAND =
	'command -v herdr >/dev/null 2>&1 && ' +
	'herdr terminal session control --help >/dev/null 2>&1 && ' +
	'herdr api snapshot';

export function parseHerdrSnapshot(output: string): HerdrSnapshot {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		invalidSnapshot();
	}

	const response = responseSchema.safeParse(parsed);
	if (!response.success) invalidSnapshot();
	return normalizeSnapshot(response.data.result.snapshot);
}

export async function loadHerdrSnapshot(input: {
	run(command: string): Promise<string>;
}): Promise<HerdrSnapshot> {
	let output: string;
	try {
		output = await input.run(HERDR_SNAPSHOT_COMMAND);
	} catch {
		throw new Error(HERDR_UNAVAILABLE_MESSAGE);
	}
	return parseHerdrSnapshot(output);
}

export function groupHerdrAgents(
	agents: readonly HerdrAgent[],
): readonly HerdrAgentGroup[] {
	return HERDR_STATUS_ORDER.flatMap((status) => {
		const groupedAgents = agents
			.filter((agent) => agent.status === status)
			.sort((left, right) => left.order - right.order);
		return groupedAgents.length === 0
			? []
			: [
					{
						status,
						label: groupLabels[status],
						agents: groupedAgents,
					},
				];
	});
}

export function findHerdrAgent(
	snapshot: HerdrSnapshot,
	terminalId: string,
): HerdrAgent | null {
	return (
		snapshot.agents.find((agent) => agent.terminalId === terminalId) ?? null
	);
}

export function nextHerdrTerminalId(
	agents: readonly HerdrAgent[],
	currentTerminalId: string,
	direction: 'next' | 'previous',
): string | null {
	if (agents.length === 0) return null;
	const currentIndex = agents.findIndex(
		(agent) => agent.terminalId === currentTerminalId,
	);
	if (currentIndex === -1) return null;

	const offset = direction === 'next' ? 1 : -1;
	const targetIndex = (currentIndex + offset + agents.length) % agents.length;
	return agents[targetIndex]?.terminalId ?? null;
}
