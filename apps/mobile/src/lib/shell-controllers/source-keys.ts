export type ShellTransportKey = string & {
	readonly __shellTransportKey: true;
};
export type ShellTargetKey = string & { readonly __shellTargetKey: true };

export function createShellTransportKey(
	connectionId: string,
	channelId: number,
): ShellTransportKey {
	return JSON.stringify([connectionId, channelId]) as ShellTransportKey;
}

export function createShellTargetKey(
	transportKey: ShellTransportKey,
	tmuxTarget: string,
): ShellTargetKey {
	return JSON.stringify([
		transportKey,
		tmuxTarget.trim() || 'main',
	]) as ShellTargetKey;
}
