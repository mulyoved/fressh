import { quoteShell } from './host-browser-actions';

export type AgentNotificationStatus = 'waiting' | 'done';

export type AgentNotificationEvent = {
	id: string;
	type: 'tmux_status';
	session: string;
	target: string;
	windowId: string;
	windowIndex: string;
	windowName: string;
	status: AgentNotificationStatus;
	icon: '💬' | '✅';
	createdAtMs: number;
};

export type AgentNotificationHeartbeat = {
	type: 'heartbeat';
	session: string;
	createdAtMs: number;
};

export type AgentNotificationLine =
	| AgentNotificationEvent
	| AgentNotificationHeartbeat;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isValidCreatedAtMs(value: unknown): value is number {
	return Number.isSafeInteger(value) && value >= 0;
}

export function parseAgentNotificationLine(
	line: string,
): AgentNotificationLine | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;

	if (parsed.type === 'heartbeat') {
		if (
			typeof parsed.session !== 'string' ||
			!isValidCreatedAtMs(parsed.createdAtMs)
		) {
			return null;
		}
		return {
			type: 'heartbeat',
			session: parsed.session,
			createdAtMs: parsed.createdAtMs,
		};
	}

	if (parsed.type !== 'tmux_status') return null;
	if (parsed.status !== 'waiting' && parsed.status !== 'done') return null;
	if (parsed.icon !== '💬' && parsed.icon !== '✅') return null;

	const stringKeys = [
		'id',
		'session',
		'target',
		'windowId',
		'windowIndex',
		'windowName',
	] as const;
	for (const key of stringKeys) {
		if (typeof parsed[key] !== 'string') return null;
	}
	if (!isValidCreatedAtMs(parsed.createdAtMs)) return null;

	return {
		id: parsed.id,
		type: 'tmux_status',
		session: parsed.session,
		target: parsed.target,
		windowId: parsed.windowId,
		windowIndex: parsed.windowIndex,
		windowName: parsed.windowName,
		status: parsed.status,
		icon: parsed.icon,
		createdAtMs: parsed.createdAtMs,
	};
}

export function buildAgentNotificationListenCommand(
	session: string,
	sinceId?: string | null,
): string {
	const parts = [
		'mdev tmux notifications listen --session',
		quoteShell(session),
	];
	if (sinceId) {
		parts.push('--since-id', quoteShell(sinceId));
	}
	return parts.join(' ');
}

export function createAgentNotificationPendingKey(input: {
	connectionId: string;
	session: string;
	windowId: string;
}): string {
	return JSON.stringify([input.connectionId, input.session, input.windowId]);
}

export function createStableNotificationId(key: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i += 1) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash & 0x7fffffff;
}

export class AgentNotificationDedupe {
	private readonly pending = new Map<string, number>();

	markPendingIfNew(key: string, notificationId: number): boolean {
		if (this.pending.has(key)) return false;
		this.pending.set(key, notificationId);
		return true;
	}

	acknowledge(key: string): number[] {
		const notificationId = this.pending.get(key);
		if (notificationId === undefined) return [];
		this.pending.delete(key);
		return [notificationId];
	}

	acknowledgeMatching(predicate: (key: string) => boolean): number[] {
		const ids: number[] = [];
		for (const [key, notificationId] of this.pending) {
			if (!predicate(key)) continue;
			this.pending.delete(key);
			ids.push(notificationId);
		}
		return ids;
	}
}
