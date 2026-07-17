import { type TerminalKeyboardProps } from '@/app/shell/components/keyboard-component-props';
import {
	KEYBOARD_TARGET_ACTION_IDS,
	type ActionId,
	type KeyboardTargetActionId,
} from '@/lib/keyboard-action-contract';
import { applyKeyboardModifiers } from '@/lib/keyboard-modifiers';
import { buildKeyboardStepSegments, runSlotItem } from '@/lib/keyboard-runtime';
import {
	getActiveKeyboardIds,
	getKeyboardActionTarget,
	getKeyboardsById,
	resolveSelectedKeyboardId,
	type CommandStep,
	type KeyboardDefinition,
	type KeyboardExecutableItem,
	type MacroDef,
	type ModifierKey,
} from '@/lib/shell-config';
import { type ShellConfigState } from '@/lib/shell-config-store';

export const HERDR_KEYBOARD_UNSUPPORTED_MESSAGE = 'TBD for Herdr' as const;
export const HERDR_MISSING_MACRO_MESSAGE =
	'Keyboard macro unavailable.' as const;
export const HERDR_KEYBOARD_ACTION_FAILED_MESSAGE =
	'Herdr keyboard action failed.' as const;

export type HerdrKeyboardAction =
	| { type: 'previous-agent' }
	| { type: 'next-agent' }
	| { type: 'fit' }
	| { type: 'copy-selection' }
	| { type: 'paste-clipboard' }
	| {
			type: 'keyboard';
			actionId: KeyboardTargetActionId | 'ROTATE_KEYBOARD';
	  }
	| { type: 'unsupported'; message: 'TBD for Herdr' };

export type HerdrKeyboardSnapshot = Readonly<{
	selectedKeyboardId: string;
	keyboard: KeyboardDefinition | null;
	macros: readonly MacroDef[];
	modifierKeysActive: readonly ModifierKey[];
	selectionModeEnabled: boolean;
}>;

export type HerdrKeyboardAdapter = Readonly<{
	getSnapshot(): HerdrKeyboardSnapshot;
	subscribe(listener: () => void): () => void;
	onSlotPress(item: KeyboardExecutableItem): Promise<void>;
	onCopySelection(): Promise<void>;
	invalidatePending(): void;
	setSelectionModeEnabled(enabled: boolean): void;
	getTerminalKeyboardProps(): TerminalKeyboardProps;
}>;

export type HerdrKeyboardAdapterInput = Readonly<{
	shellConfigState: ShellConfigState;
	terminalInput: Readonly<{
		captureSender(): ((bytes: Uint8Array) => boolean | void) | null;
	}>;
	clipboard: Readonly<{
		readText(): Promise<string>;
		writeText(text: string): Promise<void>;
	}>;
	terminalView: Readonly<{
		getSelection(): Promise<string>;
		fit(): void | Promise<void>;
		setSelectionModeEnabled(enabled: boolean): void;
	}>;
	agentNavigation: Readonly<{
		previous(): void | Promise<void>;
		next(): void | Promise<void>;
	}>;
	showFeedback(message: string): void;
}>;

type HerdrKeyboardOperation =
	| Readonly<{ type: 'bytes'; bytes: Uint8Array<ArrayBuffer> }>
	| Readonly<{ type: 'steps'; steps: readonly CommandStep[] }>
	| Readonly<{ type: 'action'; actionId: ActionId }>;

type HerdrKeyboardOperationToken = Readonly<{
	generation: number;
	sendInput: ((bytes: Uint8Array) => boolean | void) | null;
}>;

type PendingMacroDelay = Readonly<{
	handle: ReturnType<typeof setTimeout>;
	resolve(): void;
}>;

const encoder = new TextEncoder();
const defaultStepDelayMs = 50;
const keyboardTargetActionIds = new Set<string>(KEYBOARD_TARGET_ACTION_IDS);

export function classifyHerdrKeyboardAction(
	actionId: ActionId,
): HerdrKeyboardAction {
	if (actionId === 'WORKMUX_NAV_PREV') return { type: 'previous-agent' };
	if (actionId === 'WORKMUX_NAV_NEXT') return { type: 'next-agent' };
	if (actionId === 'FIT_TERMINAL_TO_DEVICE') return { type: 'fit' };
	if (actionId === 'COPY_SELECTION') return { type: 'copy-selection' };
	if (actionId === 'PASTE_CLIPBOARD') return { type: 'paste-clipboard' };
	if (actionId === 'ROTATE_KEYBOARD') {
		return { type: 'keyboard', actionId: 'ROTATE_KEYBOARD' };
	}
	if (keyboardTargetActionIds.has(actionId)) {
		return {
			type: 'keyboard',
			actionId: actionId as KeyboardTargetActionId,
		};
	}
	return { type: 'unsupported', message: HERDR_KEYBOARD_UNSUPPORTED_MESSAGE };
}

export function createHerdrKeyboardAdapter(
	input: HerdrKeyboardAdapterInput,
): HerdrKeyboardAdapter {
	const config = input.shellConfigState.config;
	const keyboardsById = getKeyboardsById(config);
	const activeKeyboardIds = getActiveKeyboardIds(config).filter(
		(id) => keyboardsById[id] !== undefined,
	);
	const activeKeyboardIdSet = new Set(activeKeyboardIds);
	const listeners = new Set<() => void>();
	let selectedKeyboardId = resolveSelectedKeyboardId(
		config,
		config.defaultKeyboardId,
		activeKeyboardIdSet,
	);
	let modifierKeysActive: readonly ModifierKey[] = [];
	let selectionModeEnabled = false;
	let operationGeneration = 0;
	let pendingMacroDelay: PendingMacroDelay | null = null;

	const cancelPendingMacroDelay = () => {
		const pending = pendingMacroDelay;
		if (!pending) return;
		pendingMacroDelay = null;
		clearTimeout(pending.handle);
		pending.resolve();
	};

	const invalidatePending = () => {
		cancelPendingMacroDelay();
		operationGeneration += 1;
	};

	const beginOperation = (): HerdrKeyboardOperationToken => {
		cancelPendingMacroDelay();
		return {
			generation: ++operationGeneration,
			sendInput: input.terminalInput.captureSender(),
		};
	};

	const isCurrent = (token: HerdrKeyboardOperationToken) =>
		token.generation === operationGeneration;

	const showCurrentFailure = (token: HerdrKeyboardOperationToken) => {
		if (!isCurrent(token)) return;
		try {
			input.showFeedback(HERDR_KEYBOARD_ACTION_FAILED_MESSAGE);
		} catch {
			// Provider-local feedback cannot alter input ownership.
		}
	};

	const buildSnapshot = (): HerdrKeyboardSnapshot => {
		const keyboard = keyboardsById[selectedKeyboardId] ?? null;
		return Object.freeze({
			selectedKeyboardId,
			keyboard,
			macros: Object.freeze(
				keyboard ? [...(config.macrosByKeyboardId[keyboard.id] ?? [])] : [],
			),
			modifierKeysActive: Object.freeze([...modifierKeysActive]),
			selectionModeEnabled,
		});
	};
	let snapshot = buildSnapshot();

	const publish = () => {
		snapshot = buildSnapshot();
		for (const listener of listeners) {
			try {
				listener();
			} catch {
				// Presentation subscribers cannot alter keyboard input ownership.
			}
		}
	};

	const setSelectionModeEnabled = (enabled: boolean) => {
		if (selectionModeEnabled === enabled) return;
		selectionModeEnabled = enabled;
		input.terminalView.setSelectionModeEnabled(enabled);
		publish();
	};

	const exitSelectionMode = () => {
		if (selectionModeEnabled) setSelectionModeEnabled(false);
	};

	const sendBytes = (
		token: HerdrKeyboardOperationToken,
		bytes: Uint8Array<ArrayBuffer>,
	) => {
		if (!isCurrent(token) || bytes.length === 0 || !token.sendInput) return;
		token.sendInput(new Uint8Array(bytes));
	};

	const rotateKeyboard = () => {
		if (activeKeyboardIds.length <= 1) return;
		const currentIndex = activeKeyboardIds.indexOf(selectedKeyboardId);
		const nextId =
			activeKeyboardIds[
				(Math.max(currentIndex, 0) + 1) % activeKeyboardIds.length
			];
		if (nextId && nextId !== selectedKeyboardId) {
			selectedKeyboardId = nextId;
			publish();
		}
	};

	const selectKeyboardForAction = (actionId: KeyboardTargetActionId) => {
		const targetId = getKeyboardActionTarget(config, actionId);
		if (
			targetId &&
			activeKeyboardIdSet.has(targetId) &&
			targetId !== selectedKeyboardId
		) {
			selectedKeyboardId = targetId;
			publish();
		}
	};

	const copySelection = async (token: HerdrKeyboardOperationToken) => {
		const text = await input.terminalView.getSelection();
		if (!isCurrent(token) || !text) return;
		await input.clipboard.writeText(text);
		if (!isCurrent(token)) return;
		exitSelectionMode();
	};

	const runAction = async (
		token: HerdrKeyboardOperationToken,
		actionId: ActionId,
	) => {
		const action = classifyHerdrKeyboardAction(actionId);
		switch (action.type) {
			case 'previous-agent':
				await input.agentNavigation.previous();
				return;
			case 'next-agent':
				await input.agentNavigation.next();
				return;
			case 'fit':
				await input.terminalView.fit();
				return;
			case 'copy-selection':
				await copySelection(token);
				return;
			case 'paste-clipboard': {
				const text = await input.clipboard.readText();
				sendBytes(token, encoder.encode(text));
				return;
			}
			case 'keyboard':
				if (action.actionId === 'ROTATE_KEYBOARD') rotateKeyboard();
				else selectKeyboardForAction(action.actionId);
				return;
			case 'unsupported':
				input.showFeedback(action.message);
				return;
		}
	};

	const runSteps = async (
		token: HerdrKeyboardOperationToken,
		steps: readonly CommandStep[],
	) => {
		const waitForStep = (delayMs: number): Promise<void> => {
			if (delayMs <= 0) return Promise.resolve();
			return new Promise<void>((resolve) => {
				let pending!: PendingMacroDelay;
				const settle = () => {
					if (pendingMacroDelay === pending) pendingMacroDelay = null;
					resolve();
				};
				pending = {
					handle: setTimeout(settle, delayMs),
					resolve: settle,
				};
				pendingMacroDelay = pending;
			});
		};

		for (let index = 0; index < steps.length; index += 1) {
			const step = steps[index];
			if (!step) continue;
			await waitForStep(step.delayMs ?? (index === 0 ? 0 : defaultStepDelayMs));
			if (!isCurrent(token)) return;
			for (const segment of buildKeyboardStepSegments(step, encoder)) {
				sendBytes(token, segment);
			}
		}
	};

	const runSlotPress = async (
		token: HerdrKeyboardOperationToken,
		item: KeyboardExecutableItem,
	) => {
		if (item.type === 'modifier') {
			modifierKeysActive = modifierKeysActive.includes(item.modifier)
				? modifierKeysActive.filter((entry) => entry !== item.modifier)
				: [...modifierKeysActive, item.modifier];
			publish();
			return;
		}

		const explicitCopy =
			item.type === 'action' && item.actionId === 'COPY_SELECTION';
		if (!explicitCopy) exitSelectionMode();

		if (
			item.type === 'macro' &&
			!snapshot.macros.some((macro) => macro.id === item.macroId)
		) {
			input.showFeedback(HERDR_MISSING_MACRO_MESSAGE);
			return;
		}

		if (item.type === 'text') {
			sendBytes(
				token,
				applyKeyboardModifiers(encoder.encode(item.text), modifierKeysActive),
			);
			return;
		}
		if (item.type === 'bytes') {
			sendBytes(
				token,
				applyKeyboardModifiers(new Uint8Array(item.bytes), modifierKeysActive),
			);
			return;
		}

		const operations: HerdrKeyboardOperation[] = [];
		runSlotItem(item, [...snapshot.macros], {
			sendBytes: (bytes) =>
				operations.push({ type: 'bytes', bytes: new Uint8Array(bytes) }),
			sendText: (value) =>
				operations.push({ type: 'bytes', bytes: encoder.encode(value) }),
			runSteps: (steps) =>
				operations.push({ type: 'steps', steps: [...steps] }),
			onAction: (actionId) => operations.push({ type: 'action', actionId }),
		});

		for (const operation of operations) {
			if (!isCurrent(token)) return;
			if (operation.type === 'bytes') sendBytes(token, operation.bytes);
			else if (operation.type === 'steps') {
				await runSteps(token, operation.steps);
			} else await runAction(token, operation.actionId);
		}
	};

	const onSlotPress = async (item: KeyboardExecutableItem) => {
		const token = beginOperation();
		try {
			await runSlotPress(token, item);
		} catch {
			showCurrentFailure(token);
		}
	};

	const onCopySelection = async () => {
		const token = beginOperation();
		try {
			await copySelection(token);
		} catch {
			showCurrentFailure(token);
		}
	};

	return Object.freeze<HerdrKeyboardAdapter>({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onSlotPress,
		onCopySelection,
		invalidatePending,
		setSelectionModeEnabled,
		getTerminalKeyboardProps: () => ({
			keyboard: snapshot.keyboard,
			modifierKeysActive: [...snapshot.modifierKeysActive],
			onSlotPress,
			selectionModeEnabled: snapshot.selectionModeEnabled,
			onCopySelection,
			workKeyLongPressMode: 'configured',
		}),
	});
}
