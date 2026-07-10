import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type RefObject,
} from 'react';
import {
	createControllerPublisher,
	type ControllerCore,
} from './controller-core';
import { type ShellModalArbiter, type ShellModalId } from './modal-arbiter';

type ShellSimpleModalId = Extract<
	ShellModalId,
	'command-menu' | 'commander' | 'text-entry' | 'configure'
>;

export type ShellSimpleModalsState = {
	commandMenu: boolean;
	commander: boolean;
	textEntry: boolean;
	configure: boolean;
};

export type ShellSimpleModalsCore = ControllerCore<ShellSimpleModalsState> & {
	open(id: ShellSimpleModalId): void;
	close(id: ShellSimpleModalId): void;
};

export type ReplaySafeDisposer = {
	setup(): () => void;
};

export type SimpleModalHandle = {
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
};

export type TextEntryModalHandle = SimpleModalHandle & {
	openRef: RefObject<boolean>;
};

export type ShellSimpleModalsHandle = {
	commandMenu: SimpleModalHandle;
	commander: SimpleModalHandle;
	textEntry: TextEntryModalHandle;
	configure: SimpleModalHandle;
};

const CLOSED_STATE: ShellSimpleModalsState = {
	commandMenu: false,
	commander: false,
	textEntry: false,
	configure: false,
};

function getStateKey(id: ShellSimpleModalId): keyof ShellSimpleModalsState {
	switch (id) {
		case 'command-menu':
			return 'commandMenu';
		case 'commander':
			return 'commander';
		case 'text-entry':
			return 'textEntry';
		case 'configure':
			return 'configure';
	}
}

export function createReplaySafeDisposer(
	dispose: () => void,
	defer: (task: () => void) => void = queueMicrotask,
): ReplaySafeDisposer {
	let generation = 0;
	let disposed = false;

	return {
		setup: () => {
			const setupGeneration = ++generation;
			return () => {
				defer(() => {
					if (disposed || generation !== setupGeneration) return;
					disposed = true;
					dispose();
				});
			};
		},
	};
}

export function createShellSimpleModalsCore(): ShellSimpleModalsCore {
	const publisher = createControllerPublisher(CLOSED_STATE);
	let disposed = false;

	const setOpen = (id: ShellSimpleModalId, open: boolean) => {
		if (disposed) return;
		const key = getStateKey(id);
		const snapshot = publisher.getSnapshot();
		if (snapshot[key] === open) return;
		publisher.publish({ ...snapshot, [key]: open });
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		open: (id) => setOpen(id, true),
		close: (id) => setOpen(id, false),
		invalidate: () => {
			if (disposed) return;
			publisher.publish(CLOSED_STATE);
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			publisher.publish(CLOSED_STATE);
			publisher.disposePublisher();
		},
	};
}

export function useShellSimpleModals(
	arbiter: ShellModalArbiter,
): ShellSimpleModalsHandle {
	const [core] = useState(createShellSimpleModalsCore);
	const [coreLifecycle] = useState(() =>
		createReplaySafeDisposer(core.dispose),
	);
	const snapshot = useSyncExternalStore(
		core.subscribe,
		core.getSnapshot,
		core.getSnapshot,
	);
	const textEntryOpenRef = useRef(snapshot.textEntry);
	textEntryOpenRef.current = snapshot.textEntry;

	useEffect(() => {
		const unregisterCommandMenu = arbiter.register('command-menu', () => {
			core.close('command-menu');
		});
		const unregisterCommander = arbiter.register('commander', () => {
			core.close('commander');
		});
		const unregisterConfigure = arbiter.register('configure', () => {
			core.close('configure');
		});
		return () => {
			unregisterCommandMenu();
			unregisterCommander();
			unregisterConfigure();
		};
	}, [arbiter, core]);

	useEffect(() => coreLifecycle.setup(), [coreLifecycle]);

	const openCommandMenu = useCallback(() => core.open('command-menu'), [core]);
	const closeCommandMenu = useCallback(
		() => core.close('command-menu'),
		[core],
	);
	const openCommander = useCallback(() => core.open('commander'), [core]);
	const closeCommander = useCallback(() => core.close('commander'), [core]);
	const openTextEntry = useCallback(() => {
		core.open('text-entry');
		textEntryOpenRef.current = core.getSnapshot().textEntry;
	}, [core]);
	const closeTextEntry = useCallback(() => {
		core.close('text-entry');
		textEntryOpenRef.current = core.getSnapshot().textEntry;
	}, [core]);
	const openConfigure = useCallback(() => core.open('configure'), [core]);
	const closeConfigure = useCallback(() => core.close('configure'), [core]);

	const commandMenu = useMemo<SimpleModalHandle>(
		() => ({
			open: snapshot.commandMenu,
			onOpen: openCommandMenu,
			onClose: closeCommandMenu,
		}),
		[snapshot.commandMenu, openCommandMenu, closeCommandMenu],
	);
	const commander = useMemo<SimpleModalHandle>(
		() => ({
			open: snapshot.commander,
			onOpen: openCommander,
			onClose: closeCommander,
		}),
		[snapshot.commander, openCommander, closeCommander],
	);
	const textEntry = useMemo<TextEntryModalHandle>(
		() => ({
			open: snapshot.textEntry,
			openRef: textEntryOpenRef,
			onOpen: openTextEntry,
			onClose: closeTextEntry,
		}),
		[snapshot.textEntry, openTextEntry, closeTextEntry],
	);
	const configure = useMemo<SimpleModalHandle>(
		() => ({
			open: snapshot.configure,
			onOpen: openConfigure,
			onClose: closeConfigure,
		}),
		[snapshot.configure, openConfigure, closeConfigure],
	);

	return { commandMenu, commander, textEntry, configure };
}
