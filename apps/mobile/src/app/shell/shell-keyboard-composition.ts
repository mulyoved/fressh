import {
	createReplaySafeDisposer,
	type ControllerInvalidationReason,
} from '@/lib/shell-controllers/controller-core';
import { type UseShellKeyboardControllerInput } from '@/lib/shell-controllers/keyboard-hook-contracts';
import { type ShellKeyboardRemoteTargetContext } from '@/lib/shell-controllers/keyboard-remote-contracts';

export type ShellDetailKeyboardCompositionInput = Omit<
	UseShellKeyboardControllerInput,
	'sourceKey' | 'scrollbackInput' | 'terminalView' | 'remoteTarget'
> & {
	targetKey: ShellKeyboardRemoteTargetContext['targetKey'];
	scrollback: { input: UseShellKeyboardControllerInput['scrollbackInput'] };
	terminal: { view: UseShellKeyboardControllerInput['terminalView'] };
	remote: Omit<ShellKeyboardRemoteTargetContext, 'targetKey'>;
};

export function createShellDetailKeyboardControllerInput(
	input: ShellDetailKeyboardCompositionInput,
): UseShellKeyboardControllerInput {
	return {
		initialShellConfigState: input.initialShellConfigState,
		historyStore: input.historyStore,
		activity: input.activity,
		sourceKey: input.targetKey,
		scrollbackInput: input.scrollback.input,
		terminalView: input.terminal.view,
		remoteTarget: {
			targetKey: input.targetKey,
			tmuxEnabled: input.remote.tmuxEnabled,
			sessionName: input.remote.sessionName,
			connectionId: input.remote.connectionId,
			channelId: input.remote.channelId,
			workmuxControlChannel: input.remote.workmuxControlChannel,
			source: input.remote.source,
		},
		navScope: input.navScope,
		setNavScope: input.setNavScope,
		modalCommands: input.modalCommands,
		browserCommands: input.browserCommands,
		fitTerminalToDevice: input.fitTerminalToDevice,
		debugConnectionInCodex: input.debugConnectionInCodex,
		reloadRuntimeShellConfig: input.reloadRuntimeShellConfig,
		showAlert: input.showAlert,
		invalidateShellTransport: input.invalidateShellTransport,
		configureCommands: input.configureCommands,
		logger: input.logger,
		platformOS: input.platformOS,
	} satisfies UseShellKeyboardControllerInput;
}

export type ShellDetailKeyboardLateBindings = {
	openSkillSelector(): void;
	closeSkillSelector(): void;
	openWisprTextEditor(): void;
	replaceSkillSelector(commands: { open(): void; close(): void }): void;
	replaceWispr(open: () => void): void;
	clear(): void;
};

export function createShellDetailKeyboardLateBindings(): ShellDetailKeyboardLateBindings {
	let skillSelector = { open: () => {}, close: () => {} };
	let openWispr = () => {};
	let closed = false;
	return {
		openSkillSelector: () => {
			if (!closed) skillSelector.open();
		},
		closeSkillSelector: () => {
			if (!closed) skillSelector.close();
		},
		openWisprTextEditor: () => {
			if (!closed) openWispr();
		},
		replaceSkillSelector: (commands) => {
			if (!closed) skillSelector = commands;
		},
		replaceWispr: (open) => {
			if (!closed) openWispr = open;
		},
		clear: () => {
			closed = true;
			skillSelector = { open: () => {}, close: () => {} };
			openWispr = () => {};
		},
	};
}

export type CreateShellDetailKeyboardModalCommandsInput = {
	late: ShellDetailKeyboardLateBindings;
	invalidateBrowserReads(): void;
	closeCommander(): void;
	closeBrowser(): void;
	closeTextEntry(): void;
	isCommandMenuOpen(): boolean;
	openCommandMenu(): void;
	closeCommandMenu(): void;
	openCommander(): void;
	openBrowserActions(): void;
	openFeatureRequest(): void;
	openConfigurator(): void;
};

export type ShellDetailKeyboardModalCommands = {
	toggleCommandMenu(): void;
	openCommander(): void;
	openSkillSelector(): void;
	openBrowserActions(): void;
	openFeatureRequest(): void;
	openWisprTextEditor(): void;
	openConfigurator(): void;
	closeCommandMenu(): void;
};

export function createShellDetailKeyboardModalCommands(
	input: CreateShellDetailKeyboardModalCommandsInput,
): ShellDetailKeyboardModalCommands {
	return {
		toggleCommandMenu: () => {
			input.invalidateBrowserReads();
			input.closeCommander();
			input.closeBrowser();
			input.late.closeSkillSelector();
			input.closeTextEntry();
			if (input.isCommandMenuOpen()) input.closeCommandMenu();
			else input.openCommandMenu();
		},
		openCommander: () => {
			input.invalidateBrowserReads();
			input.closeCommandMenu();
			input.closeBrowser();
			input.late.closeSkillSelector();
			input.closeTextEntry();
			input.openCommander();
		},
		openSkillSelector: () => input.late.openSkillSelector(),
		openBrowserActions: () => input.openBrowserActions(),
		openFeatureRequest: () => input.openFeatureRequest(),
		openWisprTextEditor: () => input.late.openWisprTextEditor(),
		openConfigurator: () => input.openConfigurator(),
		closeCommandMenu: () => input.closeCommandMenu(),
	};
}

export type ShellDetailKeyboardAuthorityIdentity = {
	targetKey: unknown;
	activityGeneration: number;
	tmuxEnabled: boolean;
	workmuxControlChannel: unknown;
};

export type ShellDetailKeyboardAuthorityRuntime = {
	replaceHandle(handle: {
		invalidate(reason: ControllerInvalidationReason): void;
	}): void;
	reconcile(
		identity: ShellDetailKeyboardAuthorityIdentity & {
			appActive: boolean;
			focused: boolean;
		},
	): void;
	onRuntimeChanged(
		runtimeKey: unknown,
		instanceId: string | null,
		notify: () => void,
	): void;
	getRuntimeIdentity(): { runtimeKey: unknown; instanceId: string | null };
	setup(): () => void;
};

export function createShellDetailKeyboardAuthorityRuntime(
	initialIdentity: ShellDetailKeyboardAuthorityIdentity,
	options: {
		onClose?(): void;
		onInvalidationError?(error: unknown): void;
		late?: ShellDetailKeyboardLateBindings;
	} = {},
): ShellDetailKeyboardAuthorityRuntime {
	let identity = initialIdentity;
	let handle: {
		invalidate(reason: ControllerInvalidationReason): void;
	} | null = null;
	let runtimeIdentity = {
		runtimeKey: null as unknown,
		instanceId: null as string | null,
	};
	let closed = false;
	const invalidate = (reason: ControllerInvalidationReason) => {
		try {
			handle?.invalidate(reason);
		} catch (error) {
			try {
				options.onInvalidationError?.(error);
			} catch {
				// Composition cleanup cannot depend on diagnostics.
			}
		}
	};
	const disposer = createReplaySafeDisposer(() => {
		if (closed) return;
		closed = true;
		handle = null;
		options.late?.clear();
		options.onClose?.();
	});
	return {
		replaceHandle: (nextHandle) => {
			if (!closed) handle = nextHandle;
		},
		reconcile: (nextIdentity) => {
			if (closed) return;
			if (
				identity.targetKey === nextIdentity.targetKey &&
				identity.activityGeneration === nextIdentity.activityGeneration &&
				identity.tmuxEnabled === nextIdentity.tmuxEnabled &&
				identity.workmuxControlChannel === nextIdentity.workmuxControlChannel
			) {
				return;
			}
			const reason = !nextIdentity.appActive
				? 'app-inactive'
				: !nextIdentity.focused
					? 'focus-lost'
					: 'source-change';
			invalidate(reason);
			identity = nextIdentity;
		},
		onRuntimeChanged: (runtimeKey, instanceId, notify) => {
			if (closed) return;
			invalidate('runtime-reset');
			runtimeIdentity = { runtimeKey, instanceId };
			notify();
		},
		getRuntimeIdentity: () => ({ ...runtimeIdentity }),
		setup: disposer.setup,
	};
}

type ShellDetailKeyboardPublishedHandle = {
	invalidate(reason: ControllerInvalidationReason): void;
};

export type ShellDetailKeyboardCommitPublication = {
	prepareKeyboard(input: {
		handle: ShellDetailKeyboardPublishedHandle;
		selectionModeEnabled: boolean;
	}): { commit(): () => void };
	prepareLateBindings(input: {
		skillSelector: { open(): void; close(): void };
		openWispr(): void;
	}): { commit(): () => void };
	getSnapshot(): {
		keyboardHandle: ShellDetailKeyboardPublishedHandle | null;
		selectionModeEnabled: boolean;
	};
};

export function createShellDetailKeyboardCommitPublication(input: {
	authority: Pick<ShellDetailKeyboardAuthorityRuntime, 'replaceHandle'>;
	late: ShellDetailKeyboardLateBindings;
	publishSelectionMode(enabled: boolean): void;
	defer?: (task: () => void) => void;
}): ShellDetailKeyboardCommitPublication {
	const defer = input.defer ?? queueMicrotask;
	let currentKeyboardOwner: symbol | null = null;
	let currentLateOwner: symbol | null = null;
	let keyboardHandle: ShellDetailKeyboardPublishedHandle | null = null;
	let selectionModeEnabled = false;
	return {
		prepareKeyboard: (next) => ({
			commit: () => {
				const owner = Symbol('shell-detail-keyboard-publication');
				currentKeyboardOwner = owner;
				keyboardHandle = next.handle;
				selectionModeEnabled = next.selectionModeEnabled;
				input.authority.replaceHandle(next.handle);
				input.publishSelectionMode(next.selectionModeEnabled);
				return () => {
					defer(() => {
						if (currentKeyboardOwner !== owner) return;
						currentKeyboardOwner = null;
						keyboardHandle = null;
						selectionModeEnabled = false;
						input.publishSelectionMode(false);
					});
				};
			},
		}),
		prepareLateBindings: (next) => ({
			commit: () => {
				const owner = Symbol('shell-detail-keyboard-late-publication');
				currentLateOwner = owner;
				input.late.replaceSkillSelector(next.skillSelector);
				input.late.replaceWispr(next.openWispr);
				return () => {
					defer(() => {
						if (currentLateOwner !== owner) return;
						currentLateOwner = null;
						input.late.clear();
					});
				};
			},
		}),
		getSnapshot: () => ({ keyboardHandle, selectionModeEnabled }),
	};
}
