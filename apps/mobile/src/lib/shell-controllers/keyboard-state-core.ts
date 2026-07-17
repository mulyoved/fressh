import { applyKeyboardModifiers } from '@/lib/keyboard-modifiers';
import {
	getActiveKeyboardIds,
	getKeyboardsById,
	resolveActiveOneShotReturnKeyboardId,
	resolveSelectedKeyboardId,
	type KeyboardDefinition,
	type MacroDef,
	type ModifierKey,
} from '@/lib/shell-config';
import { type ShellConfigState } from '@/lib/shell-config-store';
import {
	createEmptyTextEntryHistoryState,
	getTextEntryHistoryCycleEntries,
	getTextEntryHistorySections,
	type TextEntryHistoryEntry,
	type TextEntryHistoryState,
} from '@/lib/text-entry-history';

import { createControllerPublisher } from './controller-core';

export type { ModifierKey } from '@/lib/shell-config';

export type ShellKeyboardHistoryStore = {
	load(): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
	recordPaste(
		text: string,
	): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
	pinText(
		text: string,
	): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
	pinEntry(
		id: string,
	): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
	unpinEntry(
		id: string,
	): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
	deleteEntry(
		id: string,
	): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
	clearRecent(): TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
};

export type ShellKeyboardStateLogger = {
	warn(message: string, error?: unknown): void;
};

export type ShellKeyboardHistorySnapshot = {
	state: TextEntryHistoryState;
	pinned: readonly TextEntryHistoryEntry[];
	recent: readonly TextEntryHistoryEntry[];
	cycleEntries: readonly TextEntryHistoryEntry[];
};

export type ShellKeyboardStateSnapshot = {
	shellConfigState: ShellConfigState;
	activeKeyboardIds: readonly string[];
	preferredKeyboardId: string;
	selectedKeyboardId: string;
	keyboard: KeyboardDefinition | null;
	macros: readonly MacroDef[];
	modifierKeysActive: readonly ModifierKey[];
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	history: ShellKeyboardHistorySnapshot;
};

export type ShellKeyboardStateCore = {
	getSnapshot(): ShellKeyboardStateSnapshot;
	subscribe(listener: () => void): () => void;
	setShellConfigState(state: ShellConfigState): void;
	rotateKeyboard(): void;
	selectKeyboardIfExists(id: string): void;
	completeSlotPress(): void;
	toggleModifier(modifier: ModifierKey): void;
	applyModifiers(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
	setSystemKeyboardEnabled(enabled: boolean): void;
	setSelectionModeEnabled(enabled: boolean): void;
	recordAcceptedTextPaste(text: string): void;
	pinHistoryText(text: string): void;
	pinHistoryEntry(id: string): void;
	unpinHistoryEntry(id: string): void;
	deleteHistoryEntry(id: string): void;
	clearRecentHistory(): void;
	dispose(): void;
};

type CreateShellKeyboardStateCoreOptions = {
	initialShellConfigState: ShellConfigState;
	historyStore: ShellKeyboardHistoryStore;
	initialSystemKeyboardEnabled?: boolean;
	logger?: ShellKeyboardStateLogger;
};

const supportedModifiers = new Set<ModifierKey>([
	'CTRL',
	'ALT',
	'SHIFT',
	'CMD',
]);

function cloneAndFreeze<Value>(value: Value): Value {
	if (Array.isArray(value)) {
		return Object.freeze(value.map((entry) => cloneAndFreeze(entry))) as Value;
	}
	if (value && typeof value === 'object') {
		const clone = Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry)]),
		);
		return Object.freeze(clone) as Value;
	}
	return value;
}

function stableSemanticValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableSemanticValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [
					key,
					stableSemanticValue((value as Record<string, unknown>)[key]),
				]),
		);
	}
	return value;
}

function semanticallyEqual(left: unknown, right: unknown): boolean {
	return (
		JSON.stringify(stableSemanticValue(left)) ===
		JSON.stringify(stableSemanticValue(right))
	);
}

function createHistorySnapshot(
	state: TextEntryHistoryState,
): ShellKeyboardHistorySnapshot {
	const frozenState = cloneAndFreeze(state);
	const sections = getTextEntryHistorySections(frozenState);
	return Object.freeze({
		state: frozenState,
		pinned: Object.freeze(sections.pinned),
		recent: Object.freeze(sections.recent),
		cycleEntries: Object.freeze(getTextEntryHistoryCycleEntries(frozenState)),
	});
}

function getAvailableKeyboardIds(state: ShellConfigState): string[] {
	const keyboardsById = getKeyboardsById(state.config);
	return getActiveKeyboardIds(state.config).filter(
		(id) => keyboardsById[id] !== undefined,
	);
}

function createSnapshot({
	shellConfigState,
	activeKeyboardIds,
	preferredKeyboardId,
	selectedKeyboardId,
	keyboard,
	macros,
	modifierKeysActive,
	systemKeyboardEnabled,
	selectionModeEnabled,
	history,
}: {
	shellConfigState: ShellConfigState;
	activeKeyboardIds: readonly string[];
	preferredKeyboardId: string;
	selectedKeyboardId: string;
	keyboard: KeyboardDefinition | null;
	macros: readonly MacroDef[];
	modifierKeysActive: readonly ModifierKey[];
	systemKeyboardEnabled: boolean;
	selectionModeEnabled: boolean;
	history: ShellKeyboardHistorySnapshot;
}): ShellKeyboardStateSnapshot {
	return Object.freeze({
		shellConfigState,
		activeKeyboardIds,
		preferredKeyboardId,
		selectedKeyboardId,
		keyboard,
		macros,
		modifierKeysActive,
		systemKeyboardEnabled,
		selectionModeEnabled,
		history,
	});
}

function deriveKeyboardSelection(
	shellConfigState: ShellConfigState,
	activeKeyboardIds: readonly string[],
	preferredKeyboardId: string,
) {
	const selectedKeyboardId = resolveSelectedKeyboardId(
		shellConfigState.config,
		preferredKeyboardId,
		new Set(activeKeyboardIds),
	);
	const keyboard =
		getKeyboardsById(shellConfigState.config)[selectedKeyboardId] ?? null;
	const macros = keyboard
		? (shellConfigState.config.macrosByKeyboardId[keyboard.id] ?? [])
		: [];
	return { selectedKeyboardId, keyboard, macros };
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'then' in value &&
		typeof value.then === 'function'
	);
}

export function createShellKeyboardStateCore({
	initialShellConfigState,
	historyStore,
	initialSystemKeyboardEnabled = false,
	logger,
}: CreateShellKeyboardStateCoreOptions): ShellKeyboardStateCore {
	let disposed = false;
	let nextHistoryGeneration = 0;
	let lastSuccessfulHistoryGeneration = -1;
	let pendingInitialHistory: PromiseLike<TextEntryHistoryState> | null = null;
	let initialHistory = createEmptyTextEntryHistoryState();
	const initialHistoryGeneration = ++nextHistoryGeneration;

	const safeWarn = (message: string, error: unknown) => {
		try {
			logger?.warn(message, error);
		} catch {
			// Logging is diagnostic and must not affect controller state.
		}
	};

	try {
		const loaded = historyStore.load();
		if (isPromiseLike<TextEntryHistoryState>(loaded)) {
			pendingInitialHistory = loaded;
		} else {
			initialHistory = loaded;
			lastSuccessfulHistoryGeneration = initialHistoryGeneration;
		}
	} catch (error) {
		safeWarn('Failed to load text entry history', error);
	}

	const frozenConfigState = cloneAndFreeze(initialShellConfigState);
	const initialActiveKeyboardIds = Object.freeze(
		getAvailableKeyboardIds(frozenConfigState),
	);
	const initialPreferredKeyboardId = frozenConfigState.config.defaultKeyboardId;
	const initialSelection = deriveKeyboardSelection(
		frozenConfigState,
		initialActiveKeyboardIds,
		initialPreferredKeyboardId,
	);
	const publisher = createControllerPublisher(
		createSnapshot({
			shellConfigState: frozenConfigState,
			activeKeyboardIds: initialActiveKeyboardIds,
			preferredKeyboardId: initialPreferredKeyboardId,
			...initialSelection,
			modifierKeysActive: Object.freeze([]),
			systemKeyboardEnabled: initialSystemKeyboardEnabled,
			selectionModeEnabled: false,
			history: createHistorySnapshot(initialHistory),
		}),
	);

	const safePublish = (snapshot: ShellKeyboardStateSnapshot) => {
		if (disposed) return;
		try {
			publisher.publish(snapshot);
		} catch (error) {
			safeWarn('Shell keyboard state subscriber failed', error);
		}
	};

	const updateSnapshot = (
		changes: Partial<{
			shellConfigState: ShellConfigState;
			preferredKeyboardId: string;
			modifierKeysActive: readonly ModifierKey[];
			systemKeyboardEnabled: boolean;
			selectionModeEnabled: boolean;
			history: ShellKeyboardHistorySnapshot;
		}>,
	) => {
		if (disposed) return;
		const current = publisher.getSnapshot();
		const shellConfigState =
			changes.shellConfigState ?? current.shellConfigState;
		const activeKeyboardIds = changes.shellConfigState
			? Object.freeze(getAvailableKeyboardIds(shellConfigState))
			: current.activeKeyboardIds;
		const preferredKeyboardId =
			changes.preferredKeyboardId ?? current.preferredKeyboardId;
		const selection =
			changes.shellConfigState || changes.preferredKeyboardId !== undefined
				? deriveKeyboardSelection(
						shellConfigState,
						activeKeyboardIds,
						preferredKeyboardId,
					)
				: {
						selectedKeyboardId: current.selectedKeyboardId,
						keyboard: current.keyboard,
						macros: current.macros,
					};
		safePublish(
			createSnapshot({
				shellConfigState,
				activeKeyboardIds,
				preferredKeyboardId,
				...selection,
				modifierKeysActive:
					changes.modifierKeysActive ?? current.modifierKeysActive,
				systemKeyboardEnabled:
					changes.systemKeyboardEnabled ?? current.systemKeyboardEnabled,
				selectionModeEnabled:
					changes.selectionModeEnabled ?? current.selectionModeEnabled,
				history: changes.history ?? current.history,
			}),
		);
	};

	const commitHistory = (generation: number, state: TextEntryHistoryState) => {
		if (disposed || generation <= lastSuccessfulHistoryGeneration) return;
		lastSuccessfulHistoryGeneration = generation;
		const history = createHistorySnapshot(state);
		if (
			semanticallyEqual(history.state, publisher.getSnapshot().history.state)
		) {
			return;
		}
		updateSnapshot({ history });
	};

	const runHistoryOperation = (
		operation: () => TextEntryHistoryState | PromiseLike<TextEntryHistoryState>,
	) => {
		if (disposed) return;
		const generation = ++nextHistoryGeneration;
		let result: TextEntryHistoryState | PromiseLike<TextEntryHistoryState>;
		try {
			result = operation();
		} catch (error) {
			safeWarn('Failed to mutate text entry history', error);
			return;
		}
		if (!isPromiseLike<TextEntryHistoryState>(result)) {
			commitHistory(generation, result);
			return;
		}
		void Promise.resolve(result).then(
			(state) => commitHistory(generation, state),
			(error: unknown) => {
				if (!disposed) safeWarn('Failed to mutate text entry history', error);
			},
		);
	};

	if (pendingInitialHistory) {
		void Promise.resolve(pendingInitialHistory).then(
			(state) => commitHistory(initialHistoryGeneration, state),
			(error: unknown) => {
				if (!disposed) safeWarn('Failed to load text entry history', error);
			},
		);
	}

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: (listener) =>
			publisher.subscribe(() => {
				try {
					listener();
				} catch (error) {
					safeWarn('Shell keyboard state subscriber failed', error);
				}
			}),
		setShellConfigState: (state) => {
			if (disposed) return;
			const frozen = cloneAndFreeze(state);
			if (semanticallyEqual(publisher.getSnapshot().shellConfigState, frozen)) {
				return;
			}
			updateSnapshot({ shellConfigState: frozen });
		},
		rotateKeyboard: () => {
			if (disposed) return;
			const current = publisher.getSnapshot();
			if (current.activeKeyboardIds.length <= 1) return;
			const index = current.activeKeyboardIds.indexOf(
				current.selectedKeyboardId,
			);
			const nextId =
				current.activeKeyboardIds[
					(Math.max(index, 0) + 1) % current.activeKeyboardIds.length
				];
			if (nextId) updateSnapshot({ preferredKeyboardId: nextId });
		},
		selectKeyboardIfExists: (id) => {
			if (disposed) return;
			const current = publisher.getSnapshot();
			if (
				id === current.preferredKeyboardId ||
				!current.activeKeyboardIds.includes(id)
			) {
				return;
			}
			updateSnapshot({ preferredKeyboardId: id });
		},
		completeSlotPress: () => {
			if (disposed) return;
			const current = publisher.getSnapshot();
			const returnId = resolveActiveOneShotReturnKeyboardId(
				current.shellConfigState.config,
				new Set(current.activeKeyboardIds),
				current.selectedKeyboardId,
			);
			if (returnId && returnId !== current.selectedKeyboardId) {
				updateSnapshot({ preferredKeyboardId: returnId });
			}
		},
		toggleModifier: (modifier) => {
			if (disposed || !supportedModifiers.has(modifier)) return;
			const current = publisher.getSnapshot();
			const next = current.modifierKeysActive.includes(modifier)
				? current.modifierKeysActive.filter((entry) => entry !== modifier)
				: [...current.modifierKeysActive, modifier];
			updateSnapshot({ modifierKeysActive: Object.freeze(next) });
		},
		applyModifiers: (bytes) => {
			return applyKeyboardModifiers(
				bytes,
				publisher.getSnapshot().modifierKeysActive,
			);
		},
		setSystemKeyboardEnabled: (enabled) => {
			if (
				disposed ||
				publisher.getSnapshot().systemKeyboardEnabled === enabled
			) {
				return;
			}
			updateSnapshot({ systemKeyboardEnabled: enabled });
		},
		setSelectionModeEnabled: (enabled) => {
			if (
				disposed ||
				publisher.getSnapshot().selectionModeEnabled === enabled
			) {
				return;
			}
			updateSnapshot({ selectionModeEnabled: enabled });
		},
		recordAcceptedTextPaste: (text) => {
			if (text.length === 0) return;
			runHistoryOperation(() => historyStore.recordPaste(text));
		},
		pinHistoryText: (text) => {
			if (text.length === 0) return;
			runHistoryOperation(() => historyStore.pinText(text));
		},
		pinHistoryEntry: (id) =>
			runHistoryOperation(() => historyStore.pinEntry(id)),
		unpinHistoryEntry: (id) =>
			runHistoryOperation(() => historyStore.unpinEntry(id)),
		deleteHistoryEntry: (id) =>
			runHistoryOperation(() => historyStore.deleteEntry(id)),
		clearRecentHistory: () =>
			runHistoryOperation(() => historyStore.clearRecent()),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
