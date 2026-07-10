import { type ShellTargetKey } from './source-keys';

export type ShellCommandSource<Connection> = {
	targetKey: ShellTargetKey;
	tmuxEnabled: boolean;
	connection: Connection;
};

export function syncShellCommandLifecycle<Connection>(input: {
	trackedSource: { current: ShellCommandSource<Connection> };
	nextSource: ShellCommandSource<Connection>;
	invalidateWorkmux(): void;
	invalidateCodex(): void;
}): void {
	const previous = input.trackedSource.current;
	const changed =
		previous.targetKey !== input.nextSource.targetKey ||
		previous.tmuxEnabled !== input.nextSource.tmuxEnabled ||
		previous.connection !== input.nextSource.connection;

	input.trackedSource.current = input.nextSource;
	if (!changed) return;
	input.invalidateWorkmux();
	input.invalidateCodex();
}
