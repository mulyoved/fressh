import {
	normalizeStoredConnectionDetails,
	type StoredConnectionEntry,
} from '../connection-storage';
import { getStoredConnectionId } from '../connection-utils';
import { connectWithoutRemembering } from '../ssh-connect-flow';
import { type RegisteredSshConnection } from '../ssh-registry-store';
import { type HerdrHostState, type HerdrSnapshot } from './contracts';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Type query keeps Node tests from loading the native module.
type NativeRnRussh = typeof import('@fressh/react-native-uniffi-russh').RnRussh;

type RegisteredConnect = (
	params: Parameters<NativeRnRussh['connect']>[0],
) => Promise<RegisteredSshConnection>;

export type PrepareHerdrHostPorts = Readonly<{
	getSavedConnection(
		storedConnectionId: string,
	): Promise<StoredConnectionEntry | null>;
	getPrivateKey(keyId: string): Promise<string>;
	getConnections(): Readonly<Record<string, RegisteredSshConnection>>;
	connect: RegisteredConnect;
	loadSnapshot(connection: RegisteredSshConnection): Promise<HerdrSnapshot>;
}>;

const HERDR_CONNECT_TIMEOUT_MS = 5_000;

export async function prepareHerdrHost(input: {
	storedConnectionId: string;
	ports: PrepareHerdrHostPorts;
	abortSignal?: AbortSignal;
}): Promise<HerdrHostState> {
	const savedConnection = await input.ports.getSavedConnection(
		input.storedConnectionId,
	);
	if (!savedConnection) {
		throw new Error('Saved SSH connection not found.');
	}

	const connectionDetails = normalizeStoredConnectionDetails(
		savedConnection.value,
	);
	let connection = Object.values(input.ports.getConnections()).find(
		(candidate) =>
			getStoredConnectionId(candidate.connectionDetails) ===
			input.storedConnectionId,
	);

	if (!connection) {
		const privateKey = await input.ports.getPrivateKey(
			connectionDetails.security.keyId,
		);
		connection = await connectWithoutRemembering({
			connectionDetails,
			connect: input.ports.connect,
			abortSignalTimeoutMs: HERDR_CONNECT_TIMEOUT_MS,
			abortSignal: input.abortSignal,
			resolvedSecurity: { type: 'key', privateKey },
		});
	}

	const snapshot = await input.ports.loadSnapshot(connection);
	return {
		storedConnectionId: input.storedConnectionId,
		connectionId: connection.connectionId,
		snapshot,
	};
}
