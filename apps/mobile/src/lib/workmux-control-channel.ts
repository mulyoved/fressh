import {
	createMdevBridgeClient,
	type MdevBridgeClient,
	type MdevBridgeDisposeOptions,
	type MdevBridgeFailureClass,
	type MdevBridgeStreamConnection,
} from './mdev-bridge-client';
import { type ConnectionDiagnosticEvent } from './connection-diagnostics';
import { type WorkmuxScrollDirection } from './workmux-app-commands';
import {
	type MdevBridgeOperationRequest,
	WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
	buildMdevBridgeOperationFromWorkmuxArgv,
} from './workmux-bridge-operations';
import {
	type DirectTmuxConnectionLike,
	type DirectTmuxControlTransport,
	buildDirectTmuxScrollEnterCommand,
	buildDirectTmuxScrollExitCommand,
	buildDirectTmuxScrollMoveCommand,
	createDirectTmuxControlTransport,
} from './workmux-direct-tmux-control';

export type WorkmuxControlConnection = DirectTmuxConnectionLike &
	MdevBridgeStreamConnection;

export type WorkmuxControlCommandResult = {
	success: boolean;
	output: string;
	error?: string;
	failureClass?: MdevBridgeFailureClass;
};

export type WorkmuxControlCommandOptions = {
	timeoutMs?: number;
};

export type WorkmuxScrollTarget = {
	sessionName: string;
};

export type WorkmuxScrollMove = WorkmuxScrollTarget & {
	direction: WorkmuxScrollDirection;
	unit: 'line' | 'page';
	count: number;
};

export type WorkmuxControlChannel = {
	command: (
		argv: string[],
		options?: WorkmuxControlCommandOptions,
	) => Promise<WorkmuxControlCommandResult>;
	operation: (
		request: MdevBridgeOperationRequest,
		options?: WorkmuxControlCommandOptions,
	) => Promise<WorkmuxControlCommandResult>;
	scroll: {
		enter: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
		move: (input: WorkmuxScrollMove) => Promise<WorkmuxControlCommandResult>;
		exit: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
	};
	prepareDispose: (opts?: MdevBridgeDisposeOptions) => void;
	dispose: (opts?: MdevBridgeDisposeOptions) => Promise<void>;
};

export type WorkmuxControlChannelCleanupOptions = {
	cleanup?: Promise<unknown> | null;
	prepareDispose?: () => void;
	dispose: () => Promise<void>;
	onCleanupError?: (error: unknown) => void;
	onDisposeError?: (error: unknown) => void;
};

const DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS = 10_000;

function successResult(): WorkmuxControlCommandResult {
	return { success: true, output: '' };
}

function failureResult(error: string): WorkmuxControlCommandResult {
	return { success: false, output: '', error };
}

function isUnrecognizedScopeError(result: WorkmuxControlCommandResult): boolean {
	return (
		!result.success &&
		typeof result.error === 'string' &&
		/Unrecognized key.*scope/.test(result.error)
	);
}

function buildLegacyScopedNavFallback(
	request: MdevBridgeOperationRequest,
): MdevBridgeOperationRequest | null {
	if (request.operation !== WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS[3]) return null;
	const { action, session, scope } = request.params;
	if (
		(action !== 'next' && action !== 'prev') ||
		typeof session !== 'string' ||
		typeof scope !== 'string'
	) {
		return null;
	}
	return {
		operation: request.operation,
		params: {
			action:
				scope === 'all'
					? action === 'next'
						? 'next-all'
						: 'prev-all'
					: action,
			session,
		},
	};
}

export function createWorkmuxControlChannel({
	connection,
	bridgeClient,
	directTmuxTransport = createDirectTmuxControlTransport({ connection }),
	trace,
}: {
	connection: WorkmuxControlConnection | null;
	bridgeClient?: MdevBridgeClient;
	directTmuxTransport?: DirectTmuxControlTransport;
	trace?: { event: (event: ConnectionDiagnosticEvent) => void };
}): WorkmuxControlChannel {
	let disposed = false;
	const resolvedBridgeClient =
		bridgeClient ??
		(connection
			? createMdevBridgeClient({
					connection,
					requiredOperations: WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
					requestTimeoutMs: DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
					trace,
				})
			: null);

	const runDirect = async (
		command: string,
	): Promise<WorkmuxControlCommandResult> => {
		const sent = await directTmuxTransport.send(command);
		return sent
			? successResult()
			: failureResult('DirectMux control unavailable.');
	};

	const runScroll = (
		buildCommand: () => string,
	): Promise<WorkmuxControlCommandResult> => {
		if (disposed) {
			return Promise.resolve(
				failureResult('Workmux control channel disposed.'),
			);
		}
		return runDirect(buildCommand());
	};

	const runBridgeOperation = (
		request: MdevBridgeOperationRequest,
		options?: WorkmuxControlCommandOptions,
	): Promise<WorkmuxControlCommandResult> => {
		if (disposed) {
			return Promise.resolve(
				failureResult('Workmux control channel disposed.'),
			);
		}
		if (!connection || !resolvedBridgeClient) {
			return Promise.resolve(failureResult('No SSH connection available.'));
		}
		return resolvedBridgeClient.runOperation({
			operation: request.operation,
			params: request.params,
			timeoutMs: options?.timeoutMs ?? DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
		});
	};

	return {
		command: (argv, options) => {
			if (disposed) {
				return Promise.resolve(
					failureResult('Workmux control channel disposed.'),
				);
			}
			if (!connection) {
				return Promise.resolve(failureResult('No SSH connection available.'));
			}
			try {
				const request = buildMdevBridgeOperationFromWorkmuxArgv(argv);
				return runBridgeOperation(request, options).then((result) => {
					const fallbackRequest = buildLegacyScopedNavFallback(request);
					if (!fallbackRequest || !isUnrecognizedScopeError(result)) {
						return result;
					}
					return runBridgeOperation(fallbackRequest, options);
				});
			} catch (error) {
				return Promise.resolve(
					failureResult(error instanceof Error ? error.message : String(error)),
				);
			}
		},
		operation: runBridgeOperation,
		scroll: {
			enter: (input) =>
				runScroll(() => buildDirectTmuxScrollEnterCommand(input.sessionName)),
			move: (input) => runScroll(() => buildDirectTmuxScrollMoveCommand(input)),
			exit: (input) =>
				runScroll(() => buildDirectTmuxScrollExitCommand(input.sessionName)),
		},
		prepareDispose: (opts) => {
			resolvedBridgeClient?.prepareDispose(opts);
		},
		dispose: async (opts) => {
			disposed = true;
			await Promise.all([
				resolvedBridgeClient?.dispose(opts) ?? Promise.resolve(),
				directTmuxTransport.dispose(),
			]);
		},
	};
}

export function disposeWorkmuxControlChannelAfterCleanup({
	cleanup,
	prepareDispose,
	dispose,
	onCleanupError,
	onDisposeError,
}: WorkmuxControlChannelCleanupOptions): void {
	prepareDispose?.();
	const disposeChannel = () => {
		void dispose().catch((error: unknown) => {
			onDisposeError?.(error);
		});
	};

	if (!cleanup) {
		disposeChannel();
		return;
	}

	void cleanup
		.catch((error: unknown) => {
			onCleanupError?.(error);
		})
		.finally(disposeChannel);
}
