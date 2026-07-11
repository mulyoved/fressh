import {
	type ActionId,
	type RunActionOptions,
} from '../../src/lib/keyboard-actions';
import { type MacroDef } from '../../src/lib/shell-config';
import { type ShellConfigState } from '../../src/lib/shell-config-store';
import { type ControllerOutcome } from '../../src/lib/shell-controllers/controller-core';
import {
	createShellKeyboardInputCore,
	type ShellKeyboardInputCore,
} from '../../src/lib/shell-controllers/keyboard-input-core';
import { type ShellKeyboardStateCore } from '../../src/lib/shell-controllers/keyboard-state-core';

export type TimerId = number;

export function createFakeClock() {
	let now = 0;
	let nextId = 1;
	let throwNextSchedule = false;
	let scheduleHook: (() => void) | null = null;
	let throwNextClear = false;
	const timers = new Map<TimerId, { at: number; task: () => void }>();
	return {
		setTimeout: (task: () => void, delayMs: number): TimerId => {
			if (throwNextSchedule) {
				throwNextSchedule = false;
				throw new Error('schedule failed');
			}
			scheduleHook?.();
			const id = nextId++;
			timers.set(id, { at: now + delayMs, task });
			return id;
		},
		clearTimeout: (id: TimerId): void => {
			if (throwNextClear) {
				throwNextClear = false;
				throw new Error('clear failed');
			}
			timers.delete(id);
		},
		advanceBy: (durationMs: number): void => {
			const target = now + durationMs;
			while (true) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= target)
					.sort(
						([leftId, left], [rightId, right]) =>
							left.at - right.at || leftId - rightId,
					)[0];
				if (!due) break;
				const [id, timer] = due;
				timers.delete(id);
				now = timer.at;
				timer.task();
			}
			now = target;
		},
		pendingCount: () => timers.size,
		throwOnNextSchedule: () => {
			throwNextSchedule = true;
		},
		throwOnNextClear: () => {
			throwNextClear = true;
		},
		setScheduleHook: (hook: (() => void) | null) => {
			scheduleHook = hook;
		},
		settled: async (): Promise<void> => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		},
	};
}

const shellConfigState = {
	config: {
		version: '1',
		updatedAt: '2026-07-10T00:00:00.000Z',
		defaultKeyboardId: 'main',
		activeKeyboardIds: ['main'],
		keyboardRouting: { actionTargets: {}, oneShotReturnByKeyboardId: {} },
		keyboards: [{ id: 'main', name: 'Main', grid: [] }],
		macrosByKeyboardId: { main: [] },
		commandMenus: [],
	},
	source: 'bundled',
	lastLoadedAt: null,
	lastError: null,
} satisfies ShellConfigState;

export function createKeyboardInputHarness() {
	const clock = createFakeClock();
	const sent: number[][][] = [];
	const sendOptions: ({ interSegmentDelayMs?: number } | undefined)[] = [];
	const recordedHistory: string[] = [];
	const selectionCommands: boolean[] = [];
	const actions: { actionId: ActionId; options?: RunActionOptions }[] = [];
	const completedSlots: string[] = [];
	const modifierToggles: string[] = [];
	const warnings: string[] = [];
	let outcome: ControllerOutcome<{ message: string }> = {
		status: 'completed',
	};
	let activity = {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 1,
	};
	let sourceKey = 'source-1';
	let runtimeKey: object | null = { id: 'runtime-1' };
	let instanceId: string | null = 'instance-1';
	let macros: MacroDef[] = shellConfigState.config.macrosByKeyboardId.main;
	let modifiersActive = false;
	let selectionModeEnabled = false;
	let sendImplementation:
		| ((options?: {
				onAccepted?: () => void;
		  }) =>
				| ControllerOutcome<{ message: string }>
				| Promise<ControllerOutcome<{ message: string }>>)
		| null = null;
	let currentnessImplementation: ((candidate: string) => boolean) | null = null;
	let actionImplementation:
		| ((actionId: ActionId, options?: RunActionOptions) => void | Promise<void>)
		| null = null;
	let currentConfigState: ShellConfigState = shellConfigState;
	let throwHistory = false;
	let keyboardId = 'main';
	const state = {
		getSnapshot: () => ({
			shellConfigState: currentConfigState,
			keyboard: {
				...(currentConfigState.config.keyboards[0] ?? {
					name: 'Keyboard',
					grid: [],
				}),
				id: keyboardId,
			},
			macros,
			modifierKeysActive: modifiersActive ? ['CTRL' as const] : [],
			selectionModeEnabled,
		}),
		applyModifiers: (bytes: Uint8Array<ArrayBuffer>) => {
			if (!modifiersActive) return new Uint8Array(bytes);
			return new Uint8Array([bytes[0] === 0x61 ? 0x01 : (bytes[0] ?? 0)]);
		},
		setSelectionModeEnabled: (enabled: boolean) => {
			selectionModeEnabled = enabled;
			selectionCommands.push(enabled);
		},
		recordAcceptedTextPaste: (text: string) => {
			if (throwHistory) throw new Error('history failed');
			recordedHistory.push(text);
		},
		completeSlotPress: () => completedSlots.push('complete'),
		toggleModifier: (modifier: string) => modifierToggles.push(modifier),
	} as unknown as ShellKeyboardStateCore;
	const core = createShellKeyboardInputCore({
		state,
		scrollbackInput: {
			sendSegments: async (segments, options) => {
				sent.push(segments.map((segment) => Array.from(segment)));
				sendOptions.push(options);
				if (sendImplementation) return sendImplementation(options);
				if (outcome.status === 'completed') options?.onAccepted?.();
				return outcome;
			},
		},
		terminalView: {
			getRuntimeKey: () => runtimeKey as never,
			getRuntimeInstanceId: () => instanceId,
			isCurrentInstance: (candidate) =>
				currentnessImplementation
					? currentnessImplementation(candidate)
					: candidate === instanceId,
			setSelectionModeEnabled: (enabled) => selectionCommands.push(enabled),
		},
		getActivitySnapshot: () => activity,
		getSourceKey: () => sourceKey,
		runAction: (actionId, options) => {
			actions.push({ actionId, options });
			return actionImplementation?.(actionId, options);
		},
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		logger: { warn: (message) => warnings.push(message) },
	});
	return {
		core,
		clock,
		sent,
		sendOptions,
		recordedHistory,
		selectionCommands,
		actions,
		completedSlots,
		modifierToggles,
		warnings,
		setOutcome: (next: ControllerOutcome<{ message: string }>) => {
			outcome = next;
		},
		setSendImplementation: (implementation: typeof sendImplementation) => {
			sendImplementation = implementation;
		},
		setActionImplementation: (implementation: typeof actionImplementation) => {
			actionImplementation = implementation;
		},
		setCurrentnessImplementation: (
			implementation: typeof currentnessImplementation,
		) => {
			currentnessImplementation = implementation;
		},
		setInteractive: (interactive: boolean) => {
			activity = {
				...activity,
				interactive,
				generation: activity.generation + 1,
			};
		},
		replaceSource: () => {
			sourceKey = `${sourceKey}-next`;
		},
		replaceRuntime: () => {
			runtimeKey = { id: 'runtime-next' };
			instanceId = 'instance-next';
		},
		setInstanceId: (next: string | null) => {
			instanceId = next;
		},
		setMacros: (next: typeof macros) => {
			macros = next;
		},
		setModifiersActive: (active: boolean) => {
			modifiersActive = active;
		},
		setSelectionModeEnabled: (enabled: boolean) => {
			selectionModeEnabled = enabled;
		},
		replaceConfigState: () => {
			currentConfigState = { ...currentConfigState };
		},
		setThrowHistory: (value: boolean) => {
			throwHistory = value;
		},
		setKeyboardId: (id: string) => {
			keyboardId = id;
		},
	};
}

export type KeyboardInputHarness = ReturnType<
	typeof createKeyboardInputHarness
>;
export type { ShellKeyboardInputCore };
