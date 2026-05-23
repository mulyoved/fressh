import { create } from 'zustand';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- keep this factory free of runtime native-module imports for Node integration tests
type NativeRnRussh = typeof import('@fressh/react-native-uniffi-russh').RnRussh;
type SshConnection = Awaited<ReturnType<NativeRnRussh['connect']>>;
type SshShell = Awaited<ReturnType<SshConnection['startShell']>>;

type SshRegistryStore = {
	connections: Record<string, SshConnection>;
	shells: Record<`${string}-${number}`, SshShell>;
	connect: NativeRnRussh['connect'];
};

type SshRegistryLogger = {
	debug: (message: string, meta?: unknown) => void;
};

const noopLogger: SshRegistryLogger = {
	debug: () => {},
};

export function createSshRegistryStore(
	connect: NativeRnRussh['connect'],
	logger: SshRegistryLogger = noopLogger,
) {
	return create<SshRegistryStore>((set) => ({
		connections: {},
		shells: {},
		connect: async (args) => {
			const connection = await connect({
				...args,
				onDisconnected: (connectionId) => {
					args.onDisconnected?.(connectionId);
					logger.debug('connection disconnected', connectionId);
					set((s) => {
						const { [connectionId]: _omit, ...rest } = s.connections;
						return { connections: rest };
					});
				},
			});
			const originalStartShellFn = connection.startShell;
			const startShell: typeof connection.startShell = async (args) => {
				const { registerInStore = true, ...startShellArgs } =
					args as typeof args & {
						registerInStore?: boolean;
					};
				const shell = await originalStartShellFn({
					...startShellArgs,
					onClosed: (channelId) => {
						args.onClosed?.(channelId);
						if (!registerInStore) return;
						const storeKey = `${connection.connectionId}-${channelId}` as const;
						logger.debug('shell closed', storeKey);
						set((s) => {
							const { [storeKey]: _omit, ...rest } = s.shells;
							// if (Object.keys(rest).length === 0) {
							// 	void connection.disconnect();
							// }
							return { shells: rest };
						});
					},
				});
				const storeKey = `${connection.connectionId}-${shell.channelId}`;
				if (!registerInStore) return shell;
				set((s) => ({
					shells: {
						...s.shells,
						[storeKey]: shell,
					},
				}));
				return shell;
			};
			connection.startShell = startShell;
			set((s) => ({
				connections: {
					...s.connections,
					[connection.connectionId]: connection,
				},
			}));
			return connection;
		},
	}));
}
