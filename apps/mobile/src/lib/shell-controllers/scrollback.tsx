import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
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
	runtimeInstanceId: string | null;
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
	const disposeCore = (): void => {
		const ownerInput = committedInput;
		let firstError: unknown;
		for (const action of [
			() => core.invalidate('unmount'),
			() => core.dispose(),
		]) {
			try {
				action();
			} catch (error) {
				firstError ??= error;
			}
		}
		if (firstError === undefined) return;
		try {
			ownerInput.context.logger.warn(
				'Failed to dispose scrollback controller',
				firstError,
			);
		} catch {
			// Deferred unmount cleanup must never escape its microtask.
		}
	};
	const disposer = factories.createDisposer(disposeCore, deferDisposal);
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
		try {
			core.jumpToLive();
		} catch (error) {
			try {
				committedInput.context.logger.warn(
					'Workmux scrollback jump-to-live failed',
					error,
				);
			} catch {
				// Shell interaction cannot depend on diagnostics.
			}
		}
	};

	return {
		core,
		input: inputPort,
		xtermProps,
		commit: (nextInput) => {
			committedInput = nextInput;
			core.setContext(nextInput.context);
			core.onTerminalRuntimeChanged(nextInput.runtimeInstanceId);
		},
		getInput: () => committedInput,
		onActivityChanged: core.onActivityChanged,
		jumpToLive,
		setupDisposal: disposer.setup,
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
	const activityGeneration = useSyncExternalStore(
		input.context.activity.subscribe,
		() => input.context.activity.getSnapshot().generation,
		() => input.context.activity.getSnapshot().generation,
	);
	useLayoutEffect(() => runtime.commit(input), [input, runtime]);
	useLayoutEffect(
		() => runtime.onActivityChanged(),
		[activityGeneration, runtime],
	);
	useEffect(() => runtime.setupDisposal(), [runtime]);

	return useMemo(
		() => ({
			state,
			visible: state.active,
			input: runtime.input,
			clear: runtime.core.clear,
			jumpToLive: runtime.jumpToLive,
			xtermProps: runtime.xtermProps,
			invalidate: runtime.core.invalidate,
		}),
		[runtime, state],
	);
}
