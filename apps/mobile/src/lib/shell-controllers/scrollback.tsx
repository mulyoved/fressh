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
	onTeardownCleanup?(
		cleanup: Promise<boolean> | null,
		reason: 'channel-replaced' | 'unmount',
	): void;
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
	const safelyHandOffCleanup = (
		ownerInput: UseShellScrollbackControllerInput,
		reason: 'channel-replaced' | 'unmount',
	): unknown => {
		let cleanup: Promise<boolean> | null = null;
		let firstError: unknown;
		try {
			cleanup = core.getCurrentCleanup();
		} catch (error) {
			firstError = error;
		}
		try {
			ownerInput.onTeardownCleanup?.(cleanup, reason);
		} catch (error) {
			firstError ??= error;
		}
		return firstError;
	};
	const reportHandoffError = (
		ownerInput: UseShellScrollbackControllerInput,
		error: unknown,
	): void => {
		if (error === undefined) return;
		try {
			ownerInput.context.logger.warn(
				'Failed to hand off scrollback channel cleanup',
				error,
			);
		} catch {
			// Teardown recovery must not depend on diagnostics.
		}
	};
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
		const handoffError = safelyHandOffCleanup(ownerInput, 'unmount');
		reportHandoffError(ownerInput, handoffError);
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
			const previousInput = committedInput;
			const channelReplaced =
				previousInput.context.workmuxScroll !== nextInput.context.workmuxScroll;
			committedInput = nextInput;
			let firstError: unknown;
			try {
				core.setContext(nextInput.context);
			} catch (error) {
				firstError = error;
			}
			if (channelReplaced) {
				const handoffError = safelyHandOffCleanup(
					previousInput,
					'channel-replaced',
				);
				reportHandoffError(previousInput, handoffError);
			}
			if (firstError !== undefined) throw firstError;
		},
		getInput: () => committedInput,
		onActivityChanged: core.onActivityChanged,
		onTerminalRuntimeChanged: core.onTerminalRuntimeChanged,
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
