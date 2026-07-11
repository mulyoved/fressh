import { planDetectedOpenShortcutPress } from '@/lib/detected-open-actions';
import { runKeyboardActionSlot } from '@/lib/keyboard-action-run-options';
import { type ActionId, type RunActionOptions } from '@/lib/keyboard-actions';
import { type CommandStep, type MacroDef } from '@/lib/shell-config';
import {
	buildClipboardPasteSegments,
	buildCommanderExecuteSegments,
	buildTextEntryPastePayload,
} from '@/lib/terminal-input-payloads';

import {
	type CreateShellKeyboardInputCoreOptions,
	type KeyboardInputOutcome,
	type KeyboardInputTimerHandle,
	type ShellKeyboardInputCore,
} from './keyboard-input-contracts';
import {
	buildKeyboardStepSegments,
	collectKeyboardMacroOperations,
	copyKeyboardCommandStep,
	copyKeyboardExecutableItem,
	copyKeyboardSegments,
	createKeyboardSlotCompletion,
	isCompletedKeyboardInput,
	isKeyboardInputAuthorityCurrent,
	type KeyboardInputRequestToken,
	type KeyboardMacroOperation,
	snapshotKeyboardInputAuthority,
} from './keyboard-input-support';

export type {
	CreateShellKeyboardInputCoreOptions,
	ShellKeyboardInputCore,
	ShellKeyboardInputLogger,
	ShellKeyboardInputStatePort,
} from './keyboard-input-contracts';

const encoder = new TextEncoder();
const defaultStepDelayMs = 50;
const scrollbackExitDelayMs = 10;

type InputOutcome = KeyboardInputOutcome;
type TimerHandle = KeyboardInputTimerHandle;
type TokenCreation =
	| { token: KeyboardInputRequestToken }
	| { outcome: InputOutcome };

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

	const authorityDependencies = {
		getActivitySnapshot,
		getSourceKey,
		terminalView,
		getConfigState: () => state.getSnapshot().shellConfigState,
		warn: safeWarn,
	};

	const createToken = (): TokenCreation => {
		if (disposed) return { outcome: { status: 'unavailable' } };
		const tokenGeneration = advanceGeneration();
		const token = snapshotKeyboardInputAuthority(
			tokenGeneration,
			authorityDependencies,
		);
		if (token) return { token };
		return {
			outcome:
				!disposed && generation === tokenGeneration
					? { status: 'unavailable' }
					: { status: 'superseded' },
		};
	};

	const isCurrent = (token: KeyboardInputRequestToken): boolean => {
		const ownsGeneration = () => !disposed && token.generation === generation;
		return isKeyboardInputAuthorityCurrent(
			token,
			ownsGeneration,
			authorityDependencies,
		);
	};

	const exitSelection = (token: KeyboardInputRequestToken): InputOutcome => {
		if (!isCurrent(token)) return { status: 'superseded' };
		try {
			if (!state.getSnapshot().selectionModeEnabled) {
				return isCurrent(token)
					? { status: 'completed' }
					: { status: 'superseded' };
			}
			state.setSelectionModeEnabled(false);
			if (!isCurrent(token)) return { status: 'superseded' };
			terminalView.setSelectionModeEnabled(false);
			return isCurrent(token)
				? { status: 'completed' }
				: { status: 'superseded' };
		} catch (error) {
			safeWarn('Failed to exit terminal selection mode', error);
			return isCurrent(token)
				? {
						status: 'failed',
						failure: { message: 'Failed to exit terminal selection mode.' },
					}
				: { status: 'superseded' };
		}
	};

	const sendSegments = async (
		token: KeyboardInputRequestToken,
		segments: readonly Uint8Array<ArrayBuffer>[],
		interSegmentDelayMs?: number,
		onAccepted?: () => void,
	): Promise<InputOutcome> => {
		if (!isCurrent(token)) return { status: 'superseded' };
		const copied = copyKeyboardSegments(segments).filter(
			(segment) => segment.length > 0,
		);
		if (copied.length === 0) return { status: 'unavailable' };
		let pending: Promise<InputOutcome>;
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
		const created = createToken();
		if ('outcome' in created) return created.outcome;
		const { token } = created;
		const selectionOutcome = exitSelection(token);
		if (!isCompletedKeyboardInput(selectionOutcome)) return selectionOutcome;
		let copied = copyKeyboardSegments(segments);
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
		token: KeyboardInputRequestToken,
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

	const runStepsWithToken = (
		token: KeyboardInputRequestToken,
		steps: readonly CommandStep[],
		onAccepted?: () => void,
	): Promise<InputOutcome> => {
		const copiedSteps = steps.map(copyKeyboardCommandStep);
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
						const segments = buildKeyboardStepSegments(step, encoder);
						if (segments.length === 0) {
							if (!isCurrent(token)) {
								finish({ status: 'superseded' });
								return;
							}
							index += 1;
							scheduleNext();
							return;
						}
						void sendSegments(token, segments, undefined, onAccepted).then(
							(outcome) => {
								if (sequence?.generation !== token.generation) return;
								if (!isCompletedKeyboardInput(outcome)) {
									finish(outcome);
									return;
								}
								index += 1;
								scheduleNext();
							},
						);
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
		const copiedSteps = steps.map(copyKeyboardCommandStep);
		const created = createToken();
		if ('outcome' in created) return Promise.resolve(created.outcome);
		const { token } = created;
		const selectionOutcome = exitSelection(token);
		if (!isCompletedKeyboardInput(selectionOutcome))
			return Promise.resolve(selectionOutcome);
		try {
			closeCommandMenu?.();
		} catch (error) {
			safeWarn('Failed to close command menu', error);
		}
		if (!isCurrent(token)) return Promise.resolve({ status: 'superseded' });
		return runStepsWithToken(token, copiedSteps);
	};

	const runMacroWithToken = async (
		token: KeyboardInputRequestToken,
		macro: MacroDef,
		onAccepted?: () => void,
	): Promise<InputOutcome> => {
		let operations: KeyboardMacroOperation[];
		try {
			operations = collectKeyboardMacroOperations(macro);
		} catch (error) {
			safeWarn('Keyboard macro failed', error);
			return isCurrent(token)
				? {
						status: 'failed',
						failure: { message: 'Keyboard macro failed.' },
					}
				: { status: 'superseded' };
		}
		for (const operation of operations) {
			let outcome: InputOutcome;
			if (operation.type === 'bytes') {
				outcome = await sendSegments(
					token,
					[operation.bytes],
					undefined,
					onAccepted,
				);
			} else if (operation.type === 'text') {
				outcome = await sendSegments(
					token,
					[encoder.encode(operation.value)],
					undefined,
					onAccepted,
				);
			} else if (operation.type === 'action') {
				outcome = await runActionWithToken(token, operation.actionId);
			} else {
				outcome = await runStepsWithToken(token, operation.steps, onAccepted);
			}
			if (!isCompletedKeyboardInput(outcome)) return outcome;
		}
		return isCurrent(token)
			? { status: 'completed' }
			: { status: 'superseded' };
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
			const created = createToken();
			if ('outcome' in created) return created.outcome;
			const { token } = created;
			if (token.runtimeInstanceId !== copiedInstanceId) {
				return { status: 'unavailable' };
			}
			if (!isCurrent(token)) return { status: 'superseded' };
			const selectionOutcome = exitSelection(token);
			if (!isCompletedKeyboardInput(selectionOutcome)) return selectionOutcome;
			return sendSegments(token, [encoder.encode(copiedValue)]);
		},
		pasteClipboard: (value) =>
			beginInput(buildClipboardPasteSegments(`${value}`)),
		pasteTextEntry: async (value) => {
			const payload = buildTextEntryPastePayload(`${value}`);
			if (!payload.historyText) return { status: 'unavailable' };
			const historyText = payload.historyText;
			const created = createToken();
			if ('outcome' in created) return created.outcome;
			const { token } = created;
			const selectionOutcome = exitSelection(token);
			if (!isCompletedKeyboardInput(selectionOutcome)) return selectionOutcome;
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
		runCommandPreset: (preset) =>
			runSteps(preset.steps.map(copyKeyboardCommandStep)),
		handleSlotPress: async (slot) => {
			const copiedSlot = copyKeyboardExecutableItem(slot);
			const created = createToken();
			if ('outcome' in created) return created.outcome;
			const { token } = created;
			const explicitCopy =
				copiedSlot.type === 'action' &&
				copiedSlot.actionId === 'COPY_SELECTION';
			if (!explicitCopy) {
				const selectionOutcome = exitSelection(token);
				if (!isCompletedKeyboardInput(selectionOutcome))
					return selectionOutcome;
			}
			let outcome: InputOutcome;
			const completion = createKeyboardSlotCompletion({
				isCurrent: () => isCurrent(token),
				complete: state.completeSlotPress,
				warn: safeWarn,
			});
			switch (copiedSlot.type) {
				case 'modifier':
					try {
						state.toggleModifier(copiedSlot.modifier);
						outcome = isCurrent(token)
							? { status: 'completed' }
							: { status: 'superseded' };
					} catch (error) {
						safeWarn('Keyboard modifier action failed', error);
						outcome = isCurrent(token)
							? {
									status: 'failed',
									failure: { message: 'Keyboard modifier action failed.' },
								}
							: { status: 'superseded' };
					}
					break;
				case 'text': {
					let bytes = encoder.encode(copiedSlot.text);
					try {
						bytes = new Uint8Array(state.applyModifiers(bytes));
					} catch (error) {
						safeWarn('Failed to apply keyboard modifiers', error);
						return isCurrent(token)
							? {
									status: 'failed',
									failure: { message: 'Keyboard input failed.' },
								}
							: { status: 'superseded' };
					}
					outcome = await sendSegments(token, [bytes], undefined, () => {
						completion.commit();
					});
					break;
				}
				case 'bytes': {
					let plan;
					try {
						plan = planDetectedOpenShortcutPress(
							state.getSnapshot().keyboard?.id,
							copiedSlot,
						);
					} catch (error) {
						safeWarn('Failed to snapshot keyboard byte slot', error);
						return isCurrent(token)
							? {
									status: 'failed',
									failure: { message: 'Keyboard input failed.' },
								}
							: { status: 'superseded' };
					}
					if (!isCurrent(token)) return { status: 'superseded' };
					if (plan.type === 'action') {
						outcome = await runActionWithToken(token, plan.actionId);
					} else {
						let bytes = new Uint8Array(plan.bytes);
						try {
							bytes = new Uint8Array(state.applyModifiers(bytes));
						} catch (error) {
							safeWarn('Failed to apply keyboard modifiers', error);
							return isCurrent(token)
								? {
										status: 'failed',
										failure: { message: 'Keyboard input failed.' },
									}
								: { status: 'superseded' };
						}
						outcome = await sendSegments(token, [bytes], undefined, () => {
							completion.commit();
						});
					}
					break;
				}
				case 'macro': {
					let macro: MacroDef | undefined;
					try {
						macro = state
							.getSnapshot()
							.macros.find((candidate) => candidate.id === copiedSlot.macroId);
					} catch (error) {
						safeWarn('Failed to snapshot keyboard macro slot', error);
						return isCurrent(token)
							? {
									status: 'failed',
									failure: { message: 'Keyboard macro failed.' },
								}
							: { status: 'superseded' };
					}
					if (!macro) {
						return isCurrent(token)
							? { status: 'unavailable' }
							: { status: 'superseded' };
					}
					outcome = await runMacroWithToken(token, macro, completion.commit);
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
					break;
				}
				default:
					return { status: 'unavailable' };
			}
			return completion.finish(outcome);
		},
		invalidate: (_reason) => {
			if (disposed) return;
			advanceGeneration();
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			advanceGeneration();
		},
	};
}
