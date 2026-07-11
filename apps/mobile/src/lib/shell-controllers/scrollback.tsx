import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
// eslint-disable-next-line import/consistent-type-specifier-style -- Keep the Node-testable hook runtime free of React Native evaluation.
import type { ShellActivityControllerHandle } from './activity';
import {
	createReplaySafeDisposer,
	type ControllerInvalidationReason,
	type ReplaySafeDisposer,
} from './controller-core';
import {
	type ScrollbackBatchEvent,
	type ScrollbackEnterRequestedEvent,
	type ScrollbackModeChangeEvent,
	type ShellScrollbackContext,
	type ShellScrollbackInputPort,
	type ShellScrollbackState,
} from './scrollback-contracts';
import {
	createShellScrollbackControllerCore,
	type ShellScrollbackControllerCore,
} from './scrollback-core';

export type ShellScrollbackControllerHandle = {
	state: ShellScrollbackState;
	visible: boolean;
	input: ShellScrollbackInputPort;
	clear(options?: {
		failurePolicy?: 'notify' | 'suppress';
	}): Promise<boolean> | null;
	jumpToLive(): void;
	onTerminalRuntimeChanged(instanceId: string | null): void;
	xtermProps: {
		onScrollbackModeChange(event: ScrollbackModeChangeEvent): void;
		onScrollbackEnterRequested(
			event: ScrollbackEnterRequestedEvent,
		): Promise<void>;
		onScrollbackBatch(event: ScrollbackBatchEvent): void;
	};
	invalidate(reason: ControllerInvalidationReason): void;
};

export type UseShellScrollbackControllerInput = {
	activity: ShellActivityControllerHandle;
	context: ShellScrollbackContext;
};

export type ShellScrollbackHookRuntimeFactories = {
	createCore(): ShellScrollbackControllerCore;
	createDisposer(
		dispose: () => void,
		defer: (task: () => void) => void,
	): ReplaySafeDisposer;
};

const defaultFactories: ShellScrollbackHookRuntimeFactories = {
	createCore: createShellScrollbackControllerCore,
	createDisposer: (dispose, defer) => createReplaySafeDisposer(dispose, defer),
};

export type ShellScrollbackHookRuntime = {
	core: ShellScrollbackControllerCore;
	input: ShellScrollbackInputPort;
	xtermProps: ShellScrollbackControllerHandle['xtermProps'];
	commit(input: UseShellScrollbackControllerInput): void;
	getInput(): UseShellScrollbackControllerInput;
	onActivityChanged(): void;
	onTerminalRuntimeChanged(instanceId: string | null): void;
	jumpToLive(): void;
	setupDisposal(): () => void;
};

export function createShellScrollbackHookRuntime({
	deferDisposal = queueMicrotask,
	factories = defaultFactories,
	input,
}: {
	input: UseShellScrollbackControllerInput;
	factories?: ShellScrollbackHookRuntimeFactories;
	deferDisposal?(task: () => void): void;
}): ShellScrollbackHookRuntime {
	let committedInput = input;
	const core = factories.createCore();
	const disposer = factories.createDisposer(core.dispose, deferDisposal);
	const inputPort: ShellScrollbackInputPort = {
		sendSegments: (segments, options) => core.sendSegments(segments, options),
	};
	const xtermProps = {
		onScrollbackModeChange: (event: ScrollbackModeChangeEvent) =>
			core.onScrollbackModeChange(event),
		onScrollbackEnterRequested: (event: ScrollbackEnterRequestedEvent) =>
			core.onScrollbackEnterRequested(event),
		onScrollbackBatch: (event: ScrollbackBatchEvent) =>
			core.onScrollbackBatch(event),
	};
	const jumpToLive = (): void => {
		let cleanup: Promise<boolean> | null;
		try {
			// The core's public command remains void-shaped; its implementation
			// returns the exact cleanup solely so this hook can observe rejection.
			cleanup = core.jumpToLive() as unknown as Promise<boolean> | null;
		} catch (error) {
			try {
				committedInput.context.logger.warn(
					'Workmux scrollback jump-to-live failed',
					error,
				);
			} catch {
				// Shell interaction cannot depend on diagnostics.
			}
			return;
		}
		void cleanup?.catch((error) => {
			try {
				committedInput.context.logger.warn(
					'Workmux scrollback jump-to-live failed',
					error,
				);
			} catch {
				// Deferred cleanup errors must not escape their microtask.
			}
		});
	};

	return {
		core,
		input: inputPort,
		xtermProps,
		commit: (nextInput) => {
			committedInput = nextInput;
			core.setContext(nextInput.context);
		},
		getInput: () => committedInput,
		onActivityChanged: core.onActivityChanged,
		onTerminalRuntimeChanged: core.onTerminalRuntimeChanged,
		jumpToLive,
		setupDisposal: () => {
			const scheduleDispose = disposer.setup();
			return () => {
				core.invalidate('unmount');
				scheduleDispose();
			};
		},
	};
}

export function useShellScrollbackController(
	input: UseShellScrollbackControllerInput,
): ShellScrollbackControllerHandle {
	const [runtime] = useState(() => createShellScrollbackHookRuntime({ input }));
	const state = useSyncExternalStore(
		runtime.core.subscribe,
		runtime.core.getSnapshot,
		runtime.core.getSnapshot,
	);
	useLayoutEffect(() => runtime.commit(input), [input, runtime]);
	useLayoutEffect(
		() => runtime.onActivityChanged(),
		[input.activity.snapshot.generation, runtime],
	);
	useEffect(() => runtime.setupDisposal(), [runtime]);

	return useMemo(
		() => ({
			state,
			visible: state.active,
			input: runtime.input,
			clear: runtime.core.clear,
			jumpToLive: runtime.jumpToLive,
			onTerminalRuntimeChanged: runtime.onTerminalRuntimeChanged,
			xtermProps: runtime.xtermProps,
			invalidate: runtime.core.invalidate,
		}),
		[runtime, state],
	);
}
