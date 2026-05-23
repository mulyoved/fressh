import {
	createAgentNotificationRouteIdentityKey,
	type AgentNotificationRouteIdentity,
	type AgentNotificationRouteToken,
} from './agent-notification-route-identity';

type AgentNotificationRouteRecord = AgentNotificationRouteToken;

export type AgentNotificationRouteStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
	getAllKeys: () => string[];
};

export type AgentNotificationRouteTokenStoreDependencies = {
	storage: AgentNotificationRouteStorage;
	createToken: () => string;
};

const tokenPrefix = 'token:';
const routePrefix = 'route:';

function tokenKey(tapToken: string) {
	return `${tokenPrefix}${tapToken}`;
}

function routeKey(input: AgentNotificationRouteIdentity) {
	return `${routePrefix}${createAgentNotificationRouteIdentityKey(input)}`;
}

function parseRecord(
	raw: string | undefined,
): AgentNotificationRouteRecord | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<AgentNotificationRouteRecord>;
		if (
			typeof parsed.connectionId !== 'string' ||
			typeof parsed.session !== 'string' ||
			typeof parsed.windowId !== 'string' ||
			typeof parsed.eventId !== 'string' ||
			typeof parsed.tapToken !== 'string'
		) {
			return null;
		}
		return {
			connectionId: parsed.connectionId,
			session: parsed.session,
			windowId: parsed.windowId,
			eventId: parsed.eventId,
			tapToken: parsed.tapToken,
		};
	} catch {
		return null;
	}
}

function matchesIdentity(
	record: AgentNotificationRouteRecord,
	input: AgentNotificationRouteIdentity,
) {
	return (
		record.connectionId === input.connectionId &&
		record.session === input.session &&
		record.windowId === input.windowId &&
		record.eventId === input.eventId
	);
}

function deleteRouteKeyIfMatching(
	storage: AgentNotificationRouteStorage,
	record: AgentNotificationRouteRecord,
) {
	const key = routeKey(record);
	if (storage.getString(key) === record.tapToken) {
		storage.delete(key);
	}
}

export function createAgentNotificationRouteTokenStore({
	storage,
	createToken,
}: AgentNotificationRouteTokenStoreDependencies) {
	return {
		create(input: AgentNotificationRouteIdentity) {
			const key = routeKey(input);
			const existingToken = storage.getString(key);
			const tapToken = createToken();
			const record: AgentNotificationRouteRecord = {
				...input,
				tapToken,
			};
			try {
				storage.set(key, tapToken);
				storage.set(tokenKey(tapToken), JSON.stringify(record));
			} catch (error) {
				try {
					if (existingToken) {
						storage.set(key, existingToken);
					} else {
						storage.delete(key);
					}
				} catch {
					// Best effort rollback: preserve the original failure.
				}
				throw error;
			}
			return tapToken;
		},

		has(input: AgentNotificationRouteToken) {
			const record = parseRecord(storage.getString(tokenKey(input.tapToken)));
			return !!record && matchesIdentity(record, input);
		},

		delete(input: AgentNotificationRouteIdentity & { tapToken?: string }) {
			const key = routeKey(input);
			const tapToken = input.tapToken ?? storage.getString(key);
			if (tapToken) storage.delete(tokenKey(tapToken));
			if (!input.tapToken || storage.getString(key) === input.tapToken) {
				storage.delete(key);
			}
		},

		deleteMatching(input: {
			connectionId: string;
			session: string;
			windowId: string;
		}) {
			for (const key of storage.getAllKeys()) {
				if (!key.startsWith(tokenPrefix)) continue;
				const record = parseRecord(storage.getString(key));
				if (
					!record ||
					record.connectionId !== input.connectionId ||
					record.session !== input.session ||
					record.windowId !== input.windowId
				) {
					continue;
				}
				storage.delete(key);
				deleteRouteKeyIfMatching(storage, record);
			}
		},

		clear() {
			for (const key of storage.getAllKeys()) {
				if (key.startsWith(tokenPrefix) || key.startsWith(routePrefix)) {
					storage.delete(key);
				}
			}
		},
	};
}
