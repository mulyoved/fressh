import { create } from 'zustand';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- keep this factory free of runtime native-module imports for Node integration tests
type NativeRnRussh = typeof import('@fressh/react-native-uniffi-russh').RnRussh;
type SshConnection = Awaited<ReturnType<NativeRnRussh['connect']>>;
type SshShell = Awaited<ReturnType<SshConnection['startShell']>>;
type StartShellOptions = Parameters<SshConnection['startShell']>[0];
type DisconnectOptions = Parameters<SshConnection['disconnect']>[0];
type ShellCloseOptions = Parameters<SshShell['close']>[0];

export type RegisteredStartShellOptions = StartShellOptions & {
	registerInStore?: boolean;
};

export type RegisteredSshConnection = Omit<SshConnection, 'startShell'> & {
	startShell: (opts: RegisteredStartShellOptions) => Promise<SshShell>;
};

type SshRegistryStore = {
	connections: Record<string, RegisteredSshConnection>;
	shells: Record<`${string}-${number}`, SshShell>;
	connect: (
		args: Parameters<NativeRnRussh['connect']>[0],
	) => Promise<RegisteredSshConnection>;
	invalidateShellTransport: (
		connectionId: string,
		channelId: number,
	) => boolean;
};

type SshRegistryLogger = {
	debug: (message: string, meta?: unknown) => void;
};

const noopLogger: SshRegistryLogger = {
	debug: () => {},
};

function traceStack(label: string) {
	return (new Error(label).stack ?? '').split('\n').slice(1, 10);
}

function describeSignal(signal?: AbortSignal) {
	if (!signal) {
		return {
			hasSignal: false,
			aborted: false,
			reason: undefined,
		};
	}
	const reason = signal.reason;
	return {
		hasSignal: true,
		aborted: signal.aborted,
		reason:
			reason instanceof Error
				? {
						name: reason.name,
						message: reason.message,
					}
				: String(reason),
	};
}

export function createSshRegistryStore(
	connect: NativeRnRussh['connect'],
	logger: SshRegistryLogger = noopLogger,
) {
	return create<SshRegistryStore>((set, get) => ({
		connections: {},
		shells: {},
		connect: async (args) => {
			const connection = await connect({
				...args,
				onDisconnected: (connectionId) => {
					args.onDisconnected?.(connectionId);
					logger.debug('connection disconnected', {
						connectionId,
						shellCountBefore: Object.keys(get().shells).length,
						connectionCountBefore: Object.keys(get().connections).length,
					});
					set((s) => {
						const { [connectionId]: _omit, ...rest } = s.connections;
						return { connections: rest };
					});
				},
			});
			const originalStartShellFn = connection.startShell.bind(connection);
			const originalDisconnectFn = connection.disconnect.bind(connection);
			const disconnect: SshConnection['disconnect'] = async (
				opts?: DisconnectOptions,
			) => {
				logger.debug('connection disconnect requested', {
					connectionId: connection.connectionId,
					signal: describeSignal(opts?.signal),
					shellCount: Object.keys(get().shells).length,
					connectionCount: Object.keys(get().connections).length,
					stack: traceStack('connection disconnect requested'),
				});
				return originalDisconnectFn(opts);
			};
			const startShell: RegisteredSshConnection['startShell'] = async (
				args,
			) => {
				const { registerInStore = true, ...startShellArgs } = args;
				logger.debug('startShell requested', {
					connectionId: connection.connectionId,
					registerInStore,
					useTmux: startShellArgs.useTmux,
					tmuxSessionName: startShellArgs.tmuxSessionName,
					abortSignal: describeSignal(startShellArgs.abortSignal),
					shellCount: Object.keys(get().shells).length,
					connectionCount: Object.keys(get().connections).length,
					stack: traceStack('startShell requested'),
				});
				const shell = await originalStartShellFn({
					...startShellArgs,
					onClosed: (channelId) => {
						args.onClosed?.(channelId);
						if (!registerInStore) return;
						const storeKey = `${connection.connectionId}-${channelId}` as const;
						logger.debug('shell closed', {
							storeKey,
							connectionId: connection.connectionId,
							channelId,
							connectionPresent:
								get().connections[connection.connectionId] !== undefined,
							shellPresentBefore: get().shells[storeKey] !== undefined,
						});
						set((s) => {
							const { [storeKey]: _omit, ...rest } = s.shells;
							return { shells: rest };
						});
					},
				});
				const originalCloseFn = shell.close.bind(shell);
				const close: SshShell['close'] = async (opts?: ShellCloseOptions) => {
					const closeStoreKey =
						`${connection.connectionId}-${shell.channelId}` as const;
					logger.debug('shell close requested', {
						storeKey: closeStoreKey,
						connectionId: connection.connectionId,
						channelId: shell.channelId,
						signal: describeSignal(opts?.signal),
						connectionPresent:
							get().connections[connection.connectionId] !== undefined,
						shellPresent: get().shells[closeStoreKey] !== undefined,
						shellCount: Object.keys(get().shells).length,
						connectionCount: Object.keys(get().connections).length,
						stack: traceStack('shell close requested'),
					});
					return originalCloseFn(opts);
				};
				const registeredShell = {
					...shell,
					close,
				};
				const storeKey = `${connection.connectionId}-${shell.channelId}`;
				if (!registerInStore) return registeredShell;
				set((s) => ({
					shells: {
						...s.shells,
						[storeKey]: registeredShell,
					},
				}));
				return registeredShell;
			};
			const registeredConnection: RegisteredSshConnection = {
				...connection,
				disconnect,
				startShell,
			};
			set((s) => ({
				connections: {
					...s.connections,
					[connection.connectionId]: registeredConnection,
				},
			}));
			return registeredConnection;
		},
		invalidateShellTransport: (connectionId, channelId) => {
			const storeKey = `${connectionId}-${channelId}` as const;
			const current = get();
			const shell = current.shells[storeKey];
			const connection = current.connections[connectionId];
			logger.debug('invalidate shell transport requested', {
				storeKey,
				connectionId,
				channelId,
				hasShell: shell !== undefined,
				hasConnection: connection !== undefined,
			});
			if (!shell && !connection) return false;
			set((s) => {
				const { [storeKey]: _omitShell, ...restShells } = s.shells;
				return {
					connections: s.connections,
					shells: restShells,
				};
			});
			void shell?.close?.().catch((error: unknown) => {
				logger.debug('shell invalidation close failed', error);
			});
			void connection?.disconnect?.().catch((error: unknown) => {
				logger.debug('connection invalidation disconnect failed', error);
			});
			return true;
		},
	}));
}
