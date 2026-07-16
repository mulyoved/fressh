import { type ShellSessionSource } from './session-contracts';

export type ShellSessionObservedSource = {
	connectionPresent: boolean;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	lastReconnectDestination: string | null;
	shellPresent: boolean;
	storedConnectionId?: string;
};

export function deriveShellSessionSource({
	connectionPresent,
	isAutoConnecting,
	isReconnecting,
	lastReconnectDestination,
	shellPresent,
	storedConnectionId,
}: ShellSessionObservedSource): ShellSessionSource {
	if (connectionPresent && shellPresent) {
		return {
			connectionPresent,
			shellPresent,
			isAutoConnecting,
			isReconnecting,
			lastReconnectOutcome: null,
			...(storedConnectionId ? { storedConnectionId } : {}),
		};
	}
	return {
		connectionPresent,
		shellPresent,
		isAutoConnecting,
		isReconnecting,
		lastReconnectOutcome:
			lastReconnectDestination === 'terminal' ||
			lastReconnectDestination === 'hostPage'
				? { status: 'failed', destination: lastReconnectDestination }
				: null,
		...(storedConnectionId ? { storedConnectionId } : {}),
	};
}
