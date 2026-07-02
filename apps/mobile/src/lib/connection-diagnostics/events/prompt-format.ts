import { normalizeConnectionIdentity } from './identity';
import { safeDiagnosticString, snapshotDiagnosticValue } from './snapshot';
import { type ConnectionDiagnosticConnectionIdentity } from './types';

export function formatConnectionIdentity(
	connection: ConnectionDiagnosticConnectionIdentity | undefined,
): string {
	const normalizedConnection = normalizeConnectionIdentity(connection);
	if (!normalizedConnection) return 'unknown connection';

	const username = normalizedConnection.username?.trim();
	const host = normalizedConnection.host?.trim();
	const port = normalizedConnection.port;
	const address =
		username && host && typeof port === 'number'
			? `${username}@${host}:${port}`
			: host;
	const parts = [
		address ? safeDiagnosticString(address) : null,
		normalizedConnection.savedConnectionId
			? `savedConnectionId=${safeDiagnosticString(
					normalizedConnection.savedConnectionId.trim(),
				)}`
			: null,
		normalizedConnection.connectionId
			? `connectionId=${safeDiagnosticString(
					normalizedConnection.connectionId.trim(),
				)}`
			: null,
		typeof normalizedConnection.useTmux === 'boolean'
			? `useTmux=${String(normalizedConnection.useTmux)}`
			: null,
		normalizedConnection.tmuxSessionName
			? `tmuxSessionName=${safeDiagnosticString(
					normalizedConnection.tmuxSessionName.trim(),
				)}`
			: null,
		normalizedConnection.keyId
			? `keyId=${safeDiagnosticString(normalizedConnection.keyId.trim())}`
			: null,
	];

	return parts.filter(Boolean).join(' | ') || 'unknown connection';
}

export function formatDiagnosticJsonInline(value: unknown): string {
	const json = JSON.stringify(snapshotDiagnosticValue(value), null, 2);
	return (json ?? safeDiagnosticString(value)).replace(/\n/g, ' ');
}
