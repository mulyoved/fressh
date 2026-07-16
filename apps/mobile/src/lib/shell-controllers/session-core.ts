import { type ShellRouteRequest } from '../../app/shell/shell-route';
import {
	createControllerPublisher,
	type ControllerCore,
} from './controller-core';
import {
	type ShellSessionNavigation,
	type ShellSessionSnapshot,
	type ShellSessionSource,
} from './session-contracts';

export type ShellSessionCore = ControllerCore<ShellSessionSnapshot> & {
	reconcile(source: ShellSessionSource): void;
};

type ShellSessionSnapshotWithoutGeneration =
	ShellSessionSnapshot extends infer Snapshot
		? Snapshot extends { generation: number }
			? Omit<Snapshot, 'generation'>
			: never
		: never;

export function createShellSessionCore({
	request,
	navigate,
}: {
	request: ShellRouteRequest;
	navigate: ShellSessionNavigation;
}): ShellSessionCore {
	const initialBody: ShellSessionSnapshotWithoutGeneration =
		request.tmuxAttach.status === 'failed'
			? {
					status: 'attach-error',
					sessionName: request.tmuxAttach.sessionName,
					...(request.tmuxAttach.failureReason
						? { failureReason: request.tmuxAttach.failureReason }
						: {}),
				}
			: { status: 'waiting', reason: 'auto-connect' };
	const initial: ShellSessionSnapshot = { ...initialBody, generation: 0 };
	const publisher = createControllerPublisher<ShellSessionSnapshot>(initial);
	let generation = 0;
	let signature = JSON.stringify(initialBody);
	let navigationSignature: string | null = null;
	let disposed = false;

	const publish = (next: ShellSessionSnapshotWithoutGeneration) => {
		const nextSignature = JSON.stringify(next);
		if (nextSignature === signature) return;
		signature = nextSignature;
		generation += 1;
		publisher.publish({ ...next, generation });
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		reconcile: (source) => {
			if (disposed || request.tmuxAttach.status === 'failed') return;
			if (source.connectionPresent && source.shellPresent) {
				navigationSignature = null;
				publish({
					status: 'ready',
					...(source.storedConnectionId
						? { storedConnectionId: source.storedConnectionId }
						: {}),
				});
				return;
			}
			if (source.isAutoConnecting || source.isReconnecting) {
				publish({
					status: 'waiting',
					reason: source.isAutoConnecting ? 'auto-connect' : 'reconnect',
				});
				return;
			}
			if (
				source.connectionPresent &&
				source.lastReconnectOutcome?.destination !== 'hostPage'
			) {
				publish({ status: 'waiting', reason: 'reconnect' });
				return;
			}
			const navigation = source.connectionPresent
				? `edit:${source.storedConnectionId ?? request.connectionId}`
				: 'back';
			publish({ status: 'leaving' });
			if (navigationSignature === navigation) return;
			navigationSignature = navigation;
			if (navigation === 'back') navigate.back();
			else navigate.editHost(navigation.slice('edit:'.length));
		},
		invalidate: () => {
			if (!disposed) publish({ status: 'leaving' });
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			publish({ status: 'leaving' });
			publisher.disposePublisher();
		},
	};
}
