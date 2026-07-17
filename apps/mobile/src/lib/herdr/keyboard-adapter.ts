import { type TerminalKeyboardProps } from '@/app/shell/components/keyboard-component-props';
import {
	KEYBOARD_TARGET_ACTION_IDS,
	type ActionId,
	type KeyboardTargetActionId,
} from '@/lib/keyboard-actions';
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
import { MODIFIER_DEFS } from '@/lib/shell-controllers/keyboard-state-core';

export const HERDR_KEYBOARD_UNSUPPORTED_MESSAGE = 'TBD for Herdr' as const;
export const HERDR_MISSING_MACRO_MESSAGE =
	'Keyboard macro unavailable.' as const;

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
	setSelectionModeEnabled(enabled: boolean): void;
	getTerminalKeyboardProps(): TerminalKeyboardProps;
}>;

export type HerdrKeyboardAdapterInput = Readonly<{
	shellConfigState: ShellConfigState;
	terminalInput: Readonly<{
		sendInput(bytes: Uint8Array): boolean | void;
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

function applyKeyboardModifiers(
	bytes: Uint8Array<ArrayBuffer>,
	modifierKeysActive: readonly ModifierKey[],
): Uint8Array<ArrayBuffer> {
	let next = new Uint8Array(bytes);
	for (const modifier of modifierKeysActive
		.map((key) => MODIFIER_DEFS[key])
		.sort((left, right) => left.orderPreference - right.orderPreference)) {
		if (modifier.canApplyModifierToBytes(next)) {
			next = modifier.applyModifierToBytes(next);
		}
	}
	return next;
}

function wait(delayMs: number): Promise<void> {
	return delayMs > 0
		? new Promise((resolve) => setTimeout(resolve, delayMs))
		: Promise.resolve();
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

	const sendBytes = (bytes: Uint8Array<ArrayBuffer>) => {
		if (bytes.length > 0) input.terminalInput.sendInput(new Uint8Array(bytes));
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

	const onCopySelection = async () => {
		const text = await input.terminalView.getSelection();
		if (!text) return;
		await input.clipboard.writeText(text);
		exitSelectionMode();
	};

	const runAction = async (actionId: ActionId) => {
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
				await onCopySelection();
				return;
			case 'paste-clipboard': {
				const text = await input.clipboard.readText();
				sendBytes(encoder.encode(text));
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

	const runSteps = async (steps: readonly CommandStep[]) => {
		for (let index = 0; index < steps.length; index += 1) {
			const step = steps[index];
			if (!step) continue;
			await wait(step.delayMs ?? (index === 0 ? 0 : defaultStepDelayMs));
			for (const segment of buildKeyboardStepSegments(step, encoder)) {
				sendBytes(segment);
			}
		}
	};

	const onSlotPress = async (item: KeyboardExecutableItem) => {
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
				applyKeyboardModifiers(encoder.encode(item.text), modifierKeysActive),
			);
			return;
		}
		if (item.type === 'bytes') {
			sendBytes(
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
			if (operation.type === 'bytes') sendBytes(operation.bytes);
			else if (operation.type === 'steps') await runSteps(operation.steps);
			else await runAction(operation.actionId);
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
