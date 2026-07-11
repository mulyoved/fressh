import {
	createReplaySafeDisposer,
	type ControllerInvalidationReason,
} from '@/lib/shell-controllers/controller-core';
type ShellDetailKeyboardControllerInput = {
	initialShellConfigState: unknown;
	historyStore?: unknown;
	activity: unknown;
	sourceKey: unknown;
	scrollbackInput: unknown;
	terminalView: unknown;
	remoteTarget: unknown;
	navScope: unknown;
	setNavScope: unknown;
	modalCommands: unknown;
	browserCommands: unknown;
	fitTerminalToDevice: unknown;
	debugConnectionInCodex: unknown;
	reloadRuntimeShellConfig: unknown;
	showAlert: unknown;
	invalidateShellTransport: unknown;
	configureCommands: unknown;
	logger?: unknown;
	platformOS?: unknown;
};

export function createShellDetailKeyboardControllerInput<
	Input extends ShellDetailKeyboardControllerInput,
>(input: Input): Input {
	return {
		initialShellConfigState: input.initialShellConfigState,
		historyStore: input.historyStore,
		activity: input.activity,
		sourceKey: input.sourceKey,
		scrollbackInput: input.scrollbackInput,
		terminalView: input.terminalView,
		remoteTarget: input.remoteTarget,
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
	} as Input;
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

type ShellDetailKeyboardViewSource = {
	terminalKeyboardProps: unknown;
	commandMenuProps: unknown;
	commanderProps: unknown;
	textEntryProps: unknown;
	configureProps: unknown;
	onWebViewInput: unknown;
	onSelectionChanged: unknown;
	onSelectionModeChange: unknown;
};

export type ShellDetailKeyboardViewBindings<
	Source extends ShellDetailKeyboardViewSource,
> = Pick<Source, keyof ShellDetailKeyboardViewSource>;

export function createShellDetailKeyboardViewBindings<
	Source extends ShellDetailKeyboardViewSource,
>(handle: Source): ShellDetailKeyboardViewBindings<Source> {
	return {
		terminalKeyboardProps: handle.terminalKeyboardProps,
		commandMenuProps: handle.commandMenuProps,
		commanderProps: handle.commanderProps,
		textEntryProps: handle.textEntryProps,
		configureProps: handle.configureProps,
		onWebViewInput: handle.onWebViewInput,
		onSelectionChanged: handle.onSelectionChanged,
		onSelectionModeChange: handle.onSelectionModeChange,
	};
}
