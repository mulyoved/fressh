import { planDetectedOpenShortcutPress } from '@/lib/detected-open-actions';
import { runKeyboardActionSlot } from '@/lib/keyboard-action-run-options';
import { type ActionId, type RunActionOptions } from '@/lib/keyboard-actions';
import { runMacro } from '@/lib/keyboard-runtime';
import {
	type CommandPreset,
	type CommandStep,
	type KeyboardExecutableItem,
	type MacroDef,
} from '@/lib/shell-config';
import {
	buildClipboardPasteSegments,
	buildCommanderExecuteSegments,
	buildTextEntryPastePayload,
} from '@/lib/terminal-input-payloads';

import { type ShellActivitySnapshot } from './activity-core';
import {
	type ControllerInvalidationReason,
	type ControllerOutcome,
} from './controller-core';
import { type ShellKeyboardStateCore } from './keyboard-state-core';
import { type ShellScrollbackInputPort } from './scrollback-contracts';
// eslint-disable-next-line import/consistent-type-specifier-style -- Keep the pure input core out of the React Native hook module in Node tests.
import type { ShellTerminalViewPort } from './terminal';

const encoder = new TextEncoder();
const defaultStepDelayMs = 50;
const scrollbackExitDelayMs = 10;

type InputFailure = { message: string };
type InputOutcome = ControllerOutcome<InputFailure>;
type TimerHandle = unknown;

export type ShellKeyboardInputLogger = {
	warn(message: string, error?: unknown): void;
};

export type ShellKeyboardInputCore = {
	sendBytes(bytes: Uint8Array<ArrayBuffer>): Promise<InputOutcome>;
	sendBytesWithModifiers(bytes: Uint8Array<ArrayBuffer>): Promise<InputOutcome>;
	sendTextRaw(value: string): Promise<InputOutcome>;
	sendTextWithModifiers(value: string): Promise<InputOutcome>;
	onWebViewInput(input: {
		str: string;
		instanceId: string;
	}): Promise<InputOutcome>;
	pasteClipboard(value: string): Promise<InputOutcome>;
	pasteTextEntry(value: string): Promise<InputOutcome>;
	executeCommanderCommand(value: string): Promise<InputOutcome>;
	pasteCommanderText(value: string): Promise<InputOutcome>;
	sendShortcut(sequence: string): Promise<InputOutcome>;
	runCommandSteps(steps: readonly CommandStep[]): Promise<InputOutcome>;
	runCommandPreset(preset: CommandPreset): Promise<InputOutcome>;
	handleSlotPress(slot: KeyboardExecutableItem): Promise<InputOutcome>;
	invalidate(reason: ControllerInvalidationReason): void;
	dispose(): void;
};

export type CreateShellKeyboardInputCoreOptions = {
	state: Pick<
		ShellKeyboardStateCore,
		| 'getSnapshot'
		| 'applyModifiers'
		| 'setSelectionModeEnabled'
		| 'recordAcceptedTextPaste'
		| 'completeSlotPress'
		| 'toggleModifier'
	>;
	scrollbackInput: ShellScrollbackInputPort;
	terminalView: Pick<
		ShellTerminalViewPort,
		| 'getRuntimeKey'
		| 'getRuntimeInstanceId'
		| 'isCurrentInstance'
		| 'setSelectionModeEnabled'
	>;
	getActivitySnapshot(): ShellActivitySnapshot;
	getSourceKey(): unknown;
	runAction(
		actionId: ActionId,
		options?: RunActionOptions,
	): void | InputOutcome | PromiseLike<void | InputOutcome>;
	setTimeout(task: () => void, delayMs: number): TimerHandle;
	clearTimeout(timer: TimerHandle): void;
	closeCommandMenu?(): void;
	logger?: ShellKeyboardInputLogger;
};

type RequestToken = Readonly<{
	generation: number;
	sourceKey: unknown;
	activityGeneration: number;
	runtimeKey: unknown;
	runtimeInstanceId: string;
	configState: unknown;
}>;

type MacroOperation =
	| { type: 'bytes'; bytes: Uint8Array<ArrayBuffer> }
	| { type: 'text'; value: string }
	| { type: 'steps'; steps: CommandStep[] }
	| { type: 'action'; actionId: ActionId };

function copyStep(step: CommandStep): CommandStep {
	return step.type === 'text' ? { ...step, data: `${step.data}` } : { ...step };
}

function copySegments(
	segments: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer>[] {
	return segments.map((segment) => new Uint8Array(segment));
}

function copyExecutableItem(
	item: KeyboardExecutableItem,
): KeyboardExecutableItem {
	return item.type === 'bytes'
		? { ...item, bytes: [...item.bytes] }
		: item.type === 'text'
			? { ...item, text: `${item.text}` }
			: item.type === 'macro'
				? { ...item, macroId: `${item.macroId}` }
				: { ...item };
}

function isCompleted(outcome: InputOutcome): boolean {
	return outcome.status === 'completed';
}

export function createShellKeyboardInputCore({
	state,
	scrollbackInput,
	terminalView,
	getActivitySnapshot,
	getSourceKey,
	runAction,
	setTimeout: scheduleTimeout,
	clearTimeout: cancelTimeout,
	closeCommandMenu,
	logger,
}: CreateShellKeyboardInputCoreOptions): ShellKeyboardInputCore {
	let disposed = false;
	let generation = 0;
	let sequence: {
		generation: number;
		timer: TimerHandle | null;
		resolve(outcome: InputOutcome): void;
	} | null = null;

	const safeWarn = (message: string, error: unknown) => {
		try {
			logger?.warn(message, error);
		} catch {
			// Diagnostics cannot alter input ownership.
		}
	};

	const settleSequence = (outcome: InputOutcome) => {
		const owned = sequence;
		if (!owned) return;
		sequence = null;
		if (owned.timer !== null) {
			try {
				cancelTimeout(owned.timer);
			} catch (error) {
				safeWarn('Failed to cancel keyboard command timer', error);
			}
		}
		owned.resolve(outcome);
	};

	const advanceGeneration = () => {
		generation += 1;
		settleSequence({ status: 'superseded' });
		return generation;
	};

	const createToken = (): RequestToken | null => {
		if (disposed) return null;
		const tokenGeneration = advanceGeneration();
		try {
			const activity = getActivitySnapshot();
			const runtimeKey = terminalView.getRuntimeKey();
			const runtimeInstanceId = terminalView.getRuntimeInstanceId();
			const sourceKey = getSourceKey();
			if (
				!activity.interactive ||
				runtimeKey === null ||
				runtimeInstanceId === null ||
				sourceKey === null ||
				sourceKey === undefined
			) {
				return null;
			}
			return Object.freeze({
				generation: tokenGeneration,
				sourceKey,
				activityGeneration: activity.generation,
				runtimeKey,
				runtimeInstanceId,
				configState: state.getSnapshot().shellConfigState,
			});
		} catch (error) {
			safeWarn('Failed to snapshot keyboard input authority', error);
			return null;
		}
	};

	const isCurrent = (token: RequestToken): boolean => {
		if (disposed || token.generation !== generation) return false;
		try {
			const activity = getActivitySnapshot();
			return (
				activity.interactive &&
				activity.generation === token.activityGeneration &&
				getSourceKey() === token.sourceKey &&
				terminalView.getRuntimeKey() === token.runtimeKey &&
				terminalView.getRuntimeInstanceId() === token.runtimeInstanceId &&
				terminalView.isCurrentInstance(token.runtimeInstanceId) &&
				state.getSnapshot().shellConfigState === token.configState
			);
		} catch (error) {
			safeWarn('Failed to validate keyboard input authority', error);
			return false;
		}
	};

	const exitSelection = (token: RequestToken): boolean => {
		if (!isCurrent(token)) return false;
		try {
			if (!state.getSnapshot().selectionModeEnabled) return isCurrent(token);
			state.setSelectionModeEnabled(false);
			if (!isCurrent(token)) return false;
			terminalView.setSelectionModeEnabled(false);
			return isCurrent(token);
		} catch (error) {
			safeWarn('Failed to exit terminal selection mode', error);
			return false;
		}
	};

	const sendSegments = async (
		token: RequestToken,
		segments: readonly Uint8Array<ArrayBuffer>[],
		interSegmentDelayMs?: number,
		onAccepted?: () => void,
	): Promise<InputOutcome> => {
		if (!isCurrent(token)) return { status: 'superseded' };
		const copied = copySegments(segments).filter(
			(segment) => segment.length > 0,
		);
		if (copied.length === 0) return { status: 'unavailable' };
		let pending: Promise<ControllerOutcome<InputFailure>>;
		let acceptanceObserved = false;
		try {
			pending = Promise.resolve(
				scrollbackInput.sendSegments(copied, {
					interSegmentDelayMs,
					onAccepted: () => {
						if (acceptanceObserved || !isCurrent(token)) return;
						acceptanceObserved = true;
						try {
							onAccepted?.();
						} catch (error) {
							safeWarn('Keyboard input acceptance callback failed', error);
						}
					},
				}),
			);
		} catch (error) {
			safeWarn('Failed to send keyboard input', error);
			return isCurrent(token)
				? { status: 'failed', failure: { message: 'Keyboard input failed.' } }
				: { status: 'superseded' };
		}
		let outcome: InputOutcome;
		try {
			outcome = await pending;
		} catch (error) {
			safeWarn('Failed to send keyboard input', error);
			outcome = {
				status: 'failed',
				failure: { message: 'Keyboard input failed.' },
			};
		}
		return isCurrent(token) ? outcome : { status: 'superseded' };
	};

	const beginInput = async (
		segments: readonly Uint8Array<ArrayBuffer>[],
		options?: { modifiers?: boolean; interSegmentDelayMs?: number },
	): Promise<InputOutcome> => {
		const token = createToken();
		if (!token) return { status: 'unavailable' };
		if (!exitSelection(token)) return { status: 'superseded' };
		let copied = copySegments(segments);
		if (options?.modifiers) {
			try {
				copied = copied.map(
					(segment) => new Uint8Array(state.applyModifiers(segment)),
				);
			} catch (error) {
				safeWarn('Failed to apply keyboard modifiers', error);
				return isCurrent(token)
					? { status: 'failed', failure: { message: 'Keyboard input failed.' } }
					: { status: 'superseded' };
			}
		}
		return sendSegments(token, copied, options?.interSegmentDelayMs);
	};

	const runActionWithToken = async (
		token: RequestToken,
		actionId: ActionId,
		options?: RunActionOptions,
	): Promise<InputOutcome> => {
		if (!isCurrent(token)) return { status: 'superseded' };
		try {
			const result = await runAction(actionId, options);
			if (!isCurrent(token)) return { status: 'superseded' };
			return result && typeof result === 'object' && 'status' in result
				? result
				: { status: 'completed' };
		} catch (error) {
			safeWarn('Keyboard action failed', error);
			return isCurrent(token)
				? { status: 'failed', failure: { message: 'Keyboard action failed.' } }
				: { status: 'superseded' };
		}
	};

	const stepSegments = (step: CommandStep): Uint8Array<ArrayBuffer>[] => {
		const value =
			step.type === 'text'
				? step.data
				: step.type === 'enter'
					? '\r'
					: step.type === 'arrowDown'
						? '\x1b[B'
						: step.type === 'arrowUp'
							? '\x1b[A'
							: step.type === 'esc'
								? '\x1b'
								: step.type === 'space'
									? ' '
									: '\t';
		return Array.from({ length: step.repeat ?? 1 }, () =>
			encoder.encode(value),
		);
	};

	const runStepsWithToken = (
		token: RequestToken,
		steps: readonly CommandStep[],
	): Promise<InputOutcome> => {
		const copiedSteps = steps.map(copyStep);
		if (copiedSteps.length === 0)
			return Promise.resolve({ status: 'unavailable' });
		settleSequence({ status: 'superseded' });
		return new Promise<InputOutcome>((resolve) => {
			sequence = { generation: token.generation, timer: null, resolve };
			let index = 0;
			const finish = (outcome: InputOutcome) => {
				if (sequence?.generation !== token.generation) return;
				settleSequence(outcome);
			};
			const scheduleNext = () => {
				if (!isCurrent(token)) {
					finish({ status: 'superseded' });
					return;
				}
				const step = copiedSteps[index];
				if (!step) {
					finish({ status: 'completed' });
					return;
				}
				const delay = step.delayMs ?? (index === 0 ? 0 : defaultStepDelayMs);
				try {
					const timer = scheduleTimeout(() => {
						if (sequence?.generation !== token.generation) return;
						sequence.timer = null;
						void sendSegments(token, stepSegments(step)).then((outcome) => {
							if (sequence?.generation !== token.generation) return;
							if (!isCompleted(outcome)) {
								finish(outcome);
								return;
							}
							index += 1;
							scheduleNext();
						});
					}, delay);
					if (sequence?.generation === token.generation) sequence.timer = timer;
					else cancelTimeout(timer);
				} catch (error) {
					safeWarn('Failed to schedule keyboard command step', error);
					finish({
						status: 'failed',
						failure: { message: 'Keyboard command scheduling failed.' },
					});
				}
			};
			scheduleNext();
		});
	};

	const runSteps = (steps: readonly CommandStep[]): Promise<InputOutcome> => {
		const token = createToken();
		if (!token) return Promise.resolve({ status: 'unavailable' });
		if (!exitSelection(token)) return Promise.resolve({ status: 'superseded' });
		try {
			closeCommandMenu?.();
		} catch (error) {
			safeWarn('Failed to close command menu', error);
		}
		if (!isCurrent(token)) return Promise.resolve({ status: 'superseded' });
		return runStepsWithToken(token, steps);
	};

	const collectMacroOperations = (macro: MacroDef): MacroOperation[] => {
		const operations: MacroOperation[] = [];
		runMacro(
			{ ...macro, script: `${macro.script}` },
			{
				sendBytes: (bytes) =>
					operations.push({ type: 'bytes', bytes: new Uint8Array(bytes) }),
				sendText: (value) =>
					operations.push({ type: 'text', value: `${value}` }),
				runSteps: (steps) =>
					operations.push({ type: 'steps', steps: steps.map(copyStep) }),
				onAction: (actionId) => operations.push({ type: 'action', actionId }),
			},
		);
		return operations;
	};

	const runMacroWithToken = async (
		token: RequestToken,
		macro: MacroDef,
	): Promise<InputOutcome> => {
		let operations: MacroOperation[];
		try {
			operations = collectMacroOperations(macro);
		} catch (error) {
			safeWarn('Keyboard macro failed', error);
			return {
				status: 'failed',
				failure: { message: 'Keyboard macro failed.' },
			};
		}
		for (const operation of operations) {
			let outcome: InputOutcome;
			if (operation.type === 'bytes') {
				outcome = await sendSegments(token, [operation.bytes]);
			} else if (operation.type === 'text') {
				outcome = await sendSegments(token, [encoder.encode(operation.value)]);
			} else if (operation.type === 'action') {
				outcome = await runActionWithToken(token, operation.actionId);
			} else {
				outcome = await runStepsWithToken(token, operation.steps);
			}
			if (!isCompleted(outcome)) return outcome;
		}
		return isCurrent(token)
			? { status: 'completed' }
			: { status: 'superseded' };
	};

	const completeSlot = (
		token: RequestToken,
		outcome: InputOutcome,
		accepted = isCompleted(outcome),
	): InputOutcome => {
		if (!accepted || !isCurrent(token)) return outcome;
		try {
			state.completeSlotPress();
			return isCurrent(token) ? outcome : { status: 'superseded' };
		} catch (error) {
			safeWarn('Failed to complete keyboard slot press', error);
			return isCurrent(token)
				? { status: 'failed', failure: { message: 'Keyboard input failed.' } }
				: { status: 'superseded' };
		}
	};

	return {
		sendBytes: (bytes) => beginInput([new Uint8Array(bytes)]),
		sendBytesWithModifiers: (bytes) =>
			beginInput([new Uint8Array(bytes)], { modifiers: true }),
		sendTextRaw: (value) => beginInput([encoder.encode(`${value}`)]),
		sendTextWithModifiers: (value) =>
			beginInput([encoder.encode(`${value}`)], { modifiers: true }),
		onWebViewInput: async ({ str, instanceId }) => {
			const copiedInstanceId = `${instanceId}`;
			const copiedValue = `${str}`;
			const token = createToken();
			if (!token || token.runtimeInstanceId !== copiedInstanceId) {
				return { status: 'unavailable' };
			}
			if (!isCurrent(token)) return { status: 'superseded' };
			if (!exitSelection(token)) return { status: 'superseded' };
			return sendSegments(token, [encoder.encode(copiedValue)]);
		},
		pasteClipboard: (value) =>
			beginInput(buildClipboardPasteSegments(`${value}`)),
		pasteTextEntry: async (value) => {
			const payload = buildTextEntryPastePayload(`${value}`);
			if (!payload.historyText) return { status: 'unavailable' };
			const historyText = payload.historyText;
			const token = createToken();
			if (!token) return { status: 'unavailable' };
			if (!exitSelection(token)) return { status: 'superseded' };
			const outcome = await sendSegments(
				token,
				payload.segments,
				scrollbackExitDelayMs,
				() => {
					try {
						state.recordAcceptedTextPaste(historyText);
					} catch (error) {
						safeWarn('Failed to record accepted text-entry paste', error);
					}
				},
			);
			return outcome;
		},
		executeCommanderCommand: (value) =>
			beginInput(buildCommanderExecuteSegments(`${value}`), {
				interSegmentDelayMs: scrollbackExitDelayMs,
			}),
		pasteCommanderText: (value) =>
			`${value}`.trim()
				? beginInput([encoder.encode(`${value}`)])
				: Promise.resolve({ status: 'unavailable' }),
		sendShortcut: (sequenceValue) =>
			beginInput([encoder.encode(`${sequenceValue}`)]),
		runCommandSteps: runSteps,
		runCommandPreset: (preset) => runSteps(preset.steps.map(copyStep)),
		handleSlotPress: async (slot) => {
			const copiedSlot = copyExecutableItem(slot);
			const token = createToken();
			if (!token) return { status: 'unavailable' };
			const explicitCopy =
				copiedSlot.type === 'action' &&
				copiedSlot.actionId === 'COPY_SELECTION';
			if (!explicitCopy && !exitSelection(token)) {
				return { status: 'superseded' };
			}
			let outcome: InputOutcome;
			let accepted = false;
			switch (copiedSlot.type) {
				case 'modifier':
					try {
						state.toggleModifier(copiedSlot.modifier);
						outcome = isCurrent(token)
							? { status: 'completed' }
							: { status: 'superseded' };
						accepted = isCompleted(outcome);
					} catch (error) {
						safeWarn('Keyboard modifier action failed', error);
						outcome = {
							status: 'failed',
							failure: { message: 'Keyboard modifier action failed.' },
						};
					}
					break;
				case 'text': {
					let bytes = encoder.encode(copiedSlot.text);
					try {
						bytes = new Uint8Array(state.applyModifiers(bytes));
					} catch (error) {
						safeWarn('Failed to apply keyboard modifiers', error);
						return {
							status: 'failed',
							failure: { message: 'Keyboard input failed.' },
						};
					}
					outcome = await sendSegments(token, [bytes], undefined, () => {
						accepted = true;
					});
					break;
				}
				case 'bytes': {
					const plan = planDetectedOpenShortcutPress(
						state.getSnapshot().keyboard?.id,
						copiedSlot,
					);
					if (!isCurrent(token)) return { status: 'superseded' };
					if (plan.type === 'action') {
						outcome = await runActionWithToken(token, plan.actionId);
						accepted = isCompleted(outcome);
					} else {
						let bytes = new Uint8Array(plan.bytes);
						try {
							bytes = new Uint8Array(state.applyModifiers(bytes));
						} catch (error) {
							safeWarn('Failed to apply keyboard modifiers', error);
							return {
								status: 'failed',
								failure: { message: 'Keyboard input failed.' },
							};
						}
						outcome = await sendSegments(token, [bytes], undefined, () => {
							accepted = true;
						});
					}
					break;
				}
				case 'macro': {
					const macro = state
						.getSnapshot()
						.macros.find((candidate) => candidate.id === copiedSlot.macroId);
					if (!macro) return { status: 'unavailable' };
					outcome = await runMacroWithToken(token, { ...macro });
					accepted = isCompleted(outcome);
					break;
				}
				case 'action': {
					let routed:
						| { actionId: ActionId; options: RunActionOptions }
						| undefined;
					runKeyboardActionSlot(copiedSlot, (actionId, options) => {
						routed = { actionId, options };
					});
					outcome = routed
						? await runActionWithToken(token, routed.actionId, routed.options)
						: { status: 'unavailable' };
					accepted = isCompleted(outcome);
					break;
				}
				default:
					return { status: 'unavailable' };
			}
			return completeSlot(token, outcome, accepted);
		},
		invalidate: (_reason) => {
			if (disposed) return;
			advanceGeneration();
		},
		dispose: () => {
			if (disposed) return;
			advanceGeneration();
			disposed = true;
		},
	};
}
