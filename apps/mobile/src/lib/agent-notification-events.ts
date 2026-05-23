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

function hasStringProperties<const TKeys extends readonly string[]>(
	value: Record<string, unknown>,
	keys: TKeys,
): value is Record<string, unknown> & Record<TKeys[number], string> {
	for (const key of keys) {
		if (typeof value[key] !== 'string') return false;
	}
	return true;
}

function isValidCreatedAtMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
	if (!hasStringProperties(parsed, stringKeys)) return null;
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

export function matchesAgentNotificationPendingKey(
	key: string,
	input: { connectionId: string; session: string; windowId: string },
): boolean {
	try {
		const parsed = JSON.parse(key);
		return (
			Array.isArray(parsed) &&
			parsed[0] === input.connectionId &&
			parsed[1] === input.session &&
			parsed[2] === input.windowId
		);
	} catch {
		return false;
	}
}

export function createStableNotificationId(key: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i += 1) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	const notificationId = hash & 0x7fffffff;
	return notificationId === 0 ? 1 : notificationId;
}

export class AgentNotificationDedupe {
	private readonly pending = new Map<
		string,
		{
			event: AgentNotificationEvent | null;
			eventId: string;
			inFlightAnyPostCount: number;
			inFlightPostCount: number;
			notificationId: number;
			postAttemptId: number;
			posted: boolean;
			stalePosted: boolean;
		}
	>();

	markPendingIfNew(key: string, notificationId: number): boolean {
		if (this.pending.has(key)) return false;
		this.pending.set(key, {
			event: null,
			eventId: '',
			inFlightAnyPostCount: 0,
			inFlightPostCount: 0,
			notificationId,
			postAttemptId: 0,
			posted: false,
			stalePosted: false,
		});
		return true;
	}

	markPendingEvent(
		key: string,
		notificationId: number,
		event: AgentNotificationEvent,
	): boolean {
		const existing = this.pending.get(key);
		if (existing?.eventId === event.id) return false;
		this.pending.set(key, {
			event,
			eventId: event.id,
			inFlightAnyPostCount: existing?.inFlightAnyPostCount ?? 0,
			inFlightPostCount: 0,
			notificationId,
			postAttemptId: 0,
			posted: false,
			stalePosted: existing?.posted || existing?.stalePosted || false,
		});
		return true;
	}

	beginPost(key: string, eventId: string): number | null {
		const pending = this.pending.get(key);
		if (!pending || pending.eventId !== eventId) return null;
		pending.inFlightAnyPostCount += 1;
		pending.inFlightPostCount += 1;
		pending.postAttemptId += 1;
		return pending.postAttemptId;
	}

	completePost(
		key: string,
		eventId: string,
		attemptId: number,
		posted: boolean,
	):
		| { type: 'posted' | 'failed' | 'ignored' }
		| { type: 'cancel-posted'; notificationId: number }
		| {
				type: 'superseded';
				posted: boolean;
				current: {
					key: string;
					notificationId: number;
					event: AgentNotificationEvent;
				};
		  } {
		const pending = this.pending.get(key);
		if (!pending) {
			return posted
				? {
						type: 'cancel-posted',
						notificationId: createStableNotificationId(key),
					}
				: { type: 'ignored' };
		}
		if (pending.eventId !== eventId) {
			pending.inFlightAnyPostCount = Math.max(
				0,
				pending.inFlightAnyPostCount - 1,
			);
			if (!posted) return { type: 'ignored' };
			pending.stalePosted = true;
			return pending.event && pending.inFlightPostCount === 0
				? {
						type: 'superseded',
						posted,
						current: {
							key,
							notificationId: pending.notificationId,
							event: pending.event,
						},
					}
				: { type: 'ignored' };
		}
		pending.inFlightAnyPostCount = Math.max(
			0,
			pending.inFlightAnyPostCount - 1,
		);
		pending.inFlightPostCount = Math.max(0, pending.inFlightPostCount - 1);
		if (pending.postAttemptId !== attemptId) {
			if (posted) pending.posted = true;
			return { type: 'ignored' };
		}
		if (!posted) {
			if (
				pending.posted ||
				pending.stalePosted ||
				pending.inFlightAnyPostCount > 0 ||
				pending.inFlightPostCount > 0
			) {
				return { type: 'ignored' };
			}
			this.pending.delete(key);
			return { type: 'failed' };
		}
		pending.posted = true;
		return { type: 'posted' };
	}

	acknowledge(key: string): number[] {
		const pending = this.pending.get(key);
		if (!pending) return [];
		this.pending.delete(key);
		return [pending.notificationId];
	}

	acknowledgeMatching(predicate: (key: string) => boolean): number[] {
		const ids: number[] = [];
		for (const [key, pending] of this.pending) {
			if (!predicate(key)) continue;
			this.pending.delete(key);
			ids.push(pending.notificationId);
		}
		return ids;
	}

	clear(): number[] {
		const ids = Array.from(
			new Set(
				Array.from(this.pending.values(), (pending) => pending.notificationId),
			),
		);
		this.pending.clear();
		return ids;
	}

	getPendingEvents(): {
		key: string;
		notificationId: number;
		event: AgentNotificationEvent;
	}[] {
		const events: {
			key: string;
			notificationId: number;
			event: AgentNotificationEvent;
		}[] = [];
		for (const [key, pending] of this.pending) {
			if (!pending.event) continue;
			events.push({
				key,
				notificationId: pending.notificationId,
				event: pending.event,
			});
		}
		return events;
	}
}

export type HandleAgentNotificationEventInput = {
	event: AgentNotificationEvent;
	connectionId: string;
	onPending: (input: {
		key: string;
		notificationId: number;
		event: AgentNotificationEvent;
	}) => void;
	notifyPending: () => void;
	dedupe: AgentNotificationDedupe;
};

export function handleAgentNotificationEvent({
	event,
	connectionId,
	onPending,
	notifyPending,
	dedupe,
}: HandleAgentNotificationEventInput) {
	const key = createAgentNotificationPendingKey({
		connectionId,
		session: event.session,
		windowId: event.windowId,
	});
	const notificationId = createStableNotificationId(key);
	if (!dedupe.markPendingEvent(key, notificationId, event)) return;
	notifyPending();
	onPending({ key, notificationId, event });
}
