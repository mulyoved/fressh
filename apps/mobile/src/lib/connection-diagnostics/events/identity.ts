import {
	readBooleanField,
	readNumberField,
	readObjectField,
	readStringField,
} from './snapshot';
import { type ConnectionDiagnosticConnectionIdentity } from './types';

const connectionIdentityCopyKeys = [
	'savedConnectionId',
	'connectionId',
	'username',
	'host',
	'port',
	'keyId',
	'useTmux',
	'tmuxSessionName',
] as const satisfies readonly (keyof ConnectionDiagnosticConnectionIdentity)[];

type ConnectionIdentityCopyKey = (typeof connectionIdentityCopyKeys)[number];
type ExactConnectionIdentityCopyKeys = [
	Exclude<
		keyof ConnectionDiagnosticConnectionIdentity,
		ConnectionIdentityCopyKey
	>,
	Exclude<
		ConnectionIdentityCopyKey,
		keyof ConnectionDiagnosticConnectionIdentity
	>,
] extends [never, never]
	? true
	: false;

const assertExactConnectionIdentityCopyKeys: ExactConnectionIdentityCopyKeys = true;

export function copyConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity,
): ConnectionDiagnosticConnectionIdentity {
	void assertExactConnectionIdentityCopyKeys;
	return Object.fromEntries(
		connectionIdentityCopyKeys.flatMap((key) => {
			const value = connection[key];
			return value === undefined ? [] : [[key, value]];
		}),
	) as ConnectionDiagnosticConnectionIdentity;
}

export function copyOptionalConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): ConnectionDiagnosticConnectionIdentity | undefined {
	return connection === undefined
		? undefined
		: copyConnectionIdentity(connection);
}

export function normalizeConnectionIdentity(
	value: unknown,
): ConnectionDiagnosticConnectionIdentity | undefined {
	const identity: ConnectionDiagnosticConnectionIdentity = {};
	const savedConnectionId = readStringField(value, 'savedConnectionId');
	const connectionId = readStringField(value, 'connectionId');
	const username = readStringField(value, 'username');
	const host = readStringField(value, 'host');
	const port = readNumberField(value, 'port');
	const keyId = readStringField(value, 'keyId');
	const useTmux = readBooleanField(value, 'useTmux');
	const tmuxSessionName = readStringField(value, 'tmuxSessionName');

	if (savedConnectionId !== undefined)
		identity.savedConnectionId = savedConnectionId;
	if (connectionId !== undefined) identity.connectionId = connectionId;
	if (username !== undefined) identity.username = username;
	if (host !== undefined) identity.host = host;
	if (port !== undefined) identity.port = port;
	if (keyId !== undefined) identity.keyId = keyId;
	if (useTmux !== undefined) identity.useTmux = useTmux;
	if (tmuxSessionName !== undefined) {
		identity.tmuxSessionName = tmuxSessionName;
	}

	return Object.keys(identity).length ? identity : undefined;
}

export function buildConnectionDetailsIdentity(
	connectionDetails: unknown,
): ConnectionDiagnosticConnectionIdentity {
	const identity: ConnectionDiagnosticConnectionIdentity = {};
	const security = readObjectField(connectionDetails, 'security');
	const username = readStringField(connectionDetails, 'username');
	const host = readStringField(connectionDetails, 'host');
	const port = readNumberField(connectionDetails, 'port');
	const keyId =
		readStringField(security, 'keyId') ??
		readStringField(connectionDetails, 'keyId');
	const useTmux = readBooleanField(connectionDetails, 'useTmux');
	const tmuxSessionName = readStringField(connectionDetails, 'tmuxSessionName');

	if (username !== undefined) identity.username = username;
	if (host !== undefined) identity.host = host;
	if (port !== undefined) identity.port = port;
	if (keyId !== undefined) identity.keyId = keyId;
	if (useTmux !== undefined) identity.useTmux = useTmux;
	if (tmuxSessionName !== undefined) {
		identity.tmuxSessionName = tmuxSessionName;
	}

	return identity;
}

export function buildSavedEntryIdentity(
	savedConnectionId: string,
	connectionDetails: unknown,
): ConnectionDiagnosticConnectionIdentity {
	return {
		savedConnectionId,
		...buildConnectionDetailsIdentity(connectionDetails),
	};
}

export function buildActiveConnectionIdentity(input: {
	connectionId: string;
	connectionDetails: unknown;
}): ConnectionDiagnosticConnectionIdentity {
	return {
		connectionId: input.connectionId,
		...buildConnectionDetailsIdentity(input.connectionDetails),
	};
}
