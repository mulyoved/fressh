import { type ActionId } from '@/lib/keyboard-actions';
import { runMacro } from '@/lib/keyboard-runtime';
import {
	type CommandStep,
	type KeyboardExecutableItem,
	type MacroDef,
} from '@/lib/shell-config';

import { type ShellActivitySnapshot } from './activity-core';
import { type ControllerOutcome } from './controller-core';
import { type ShellTerminalRuntimeView } from './terminal-hook-runtime';

type InputOutcome = ControllerOutcome<{ message: string }>;

export type KeyboardInputRequestToken = Readonly<{
	generation: number;
	sourceKey: unknown;
	activityGeneration: number;
	runtimeKey: unknown;
	runtimeInstanceId: string;
	configState: unknown;
}>;

type KeyboardInputAuthorityDependencies = {
	getActivitySnapshot(): ShellActivitySnapshot;
	getSourceKey(): unknown;
	terminalView: Pick<
		ShellTerminalRuntimeView,
		'getRuntimeKey' | 'getRuntimeInstanceId' | 'isCurrentInstance'
	>;
	getConfigState(): unknown;
	warn(message: string, error: unknown): void;
};

export function snapshotKeyboardInputAuthority(
	generation: number,
	ownsGeneration: () => boolean,
	dependencies: KeyboardInputAuthorityDependencies,
):
	| { token: KeyboardInputRequestToken }
	| { status: 'unavailable' | 'superseded' } {
	if (!ownsGeneration()) return { status: 'superseded' };
	try {
		const activity = dependencies.getActivitySnapshot();
		if (!ownsGeneration()) return { status: 'superseded' };
		if (!activity.interactive) return { status: 'unavailable' };
		const runtimeKey = dependencies.terminalView.getRuntimeKey();
		if (!ownsGeneration()) return { status: 'superseded' };
		if (runtimeKey === null) return { status: 'unavailable' };
		const runtimeInstanceId = dependencies.terminalView.getRuntimeInstanceId();
		if (!ownsGeneration()) return { status: 'superseded' };
		if (runtimeInstanceId === null) return { status: 'unavailable' };
		const sourceKey = dependencies.getSourceKey();
		if (!ownsGeneration()) return { status: 'superseded' };
		if (sourceKey === null || sourceKey === undefined) {
			return { status: 'unavailable' };
		}
		const configState = dependencies.getConfigState();
		if (!ownsGeneration()) return { status: 'superseded' };
		return {
			token: Object.freeze({
				generation,
				sourceKey,
				activityGeneration: activity.generation,
				runtimeKey,
				runtimeInstanceId,
				configState,
			}),
		};
	} catch (error) {
		dependencies.warn('Failed to snapshot keyboard input authority', error);
		return {
			status: ownsGeneration() ? 'unavailable' : 'superseded',
		};
	}
}

export function isKeyboardInputAuthorityCurrent(
	token: KeyboardInputRequestToken,
	ownsGeneration: () => boolean,
	dependencies: KeyboardInputAuthorityDependencies,
): boolean {
	if (!ownsGeneration()) return false;
	try {
		const activity = dependencies.getActivitySnapshot();
		if (
			!ownsGeneration() ||
			!activity.interactive ||
			activity.generation !== token.activityGeneration
		) {
			return false;
		}
		const sourceKey = dependencies.getSourceKey();
		if (!ownsGeneration() || sourceKey !== token.sourceKey) return false;
		const runtimeKey = dependencies.terminalView.getRuntimeKey();
		if (!ownsGeneration() || runtimeKey !== token.runtimeKey) return false;
		const runtimeInstanceId = dependencies.terminalView.getRuntimeInstanceId();
		if (!ownsGeneration() || runtimeInstanceId !== token.runtimeInstanceId) {
			return false;
		}
		const instanceCurrent = dependencies.terminalView.isCurrentInstance(
			token.runtimeInstanceId,
		);
		if (!ownsGeneration() || !instanceCurrent) return false;
		const configState = dependencies.getConfigState();
		return ownsGeneration() && configState === token.configState;
	} catch (error) {
		dependencies.warn('Failed to validate keyboard input authority', error);
		return false;
	}
}

export type KeyboardMacroOperation =
	| { type: 'bytes'; bytes: Uint8Array<ArrayBuffer> }
	| { type: 'text'; value: string }
	| { type: 'steps'; steps: CommandStep[] }
	| { type: 'action'; actionId: ActionId };

export function copyKeyboardCommandStep(step: CommandStep): CommandStep {
	return step.type === 'text' ? { ...step, data: `${step.data}` } : { ...step };
}

export function copyKeyboardSegments(
	segments: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer>[] {
	return segments.map((segment) => new Uint8Array(segment));
}

export function copyKeyboardExecutableItem(
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

export function isCompletedKeyboardInput(outcome: InputOutcome): boolean {
	return outcome.status === 'completed';
}

export function buildKeyboardStepSegments(
	step: CommandStep,
	encoder: TextEncoder,
): Uint8Array<ArrayBuffer>[] {
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
	return Array.from({ length: step.repeat ?? 1 }, () => encoder.encode(value));
}

export function collectKeyboardMacroOperations(
	macro: MacroDef,
): KeyboardMacroOperation[] {
	const operations: KeyboardMacroOperation[] = [];
	runMacro(
		{ ...macro, script: `${macro.script}` },
		{
			sendBytes: (bytes) =>
				operations.push({ type: 'bytes', bytes: new Uint8Array(bytes) }),
			sendText: (value) => operations.push({ type: 'text', value: `${value}` }),
			runSteps: (steps) =>
				operations.push({
					type: 'steps',
					steps: steps.map(copyKeyboardCommandStep),
				}),
			onAction: (actionId) => operations.push({ type: 'action', actionId }),
		},
	);
	return operations;
}

export function createKeyboardSlotCompletion({
	isCurrent,
	complete,
	warn,
}: {
	isCurrent(): boolean;
	complete(): void;
	warn(message: string, error: unknown): void;
}) {
	let phase: 'pending' | 'completed' | 'failed' = 'pending';
	const commit = () => {
		if (phase !== 'pending' || !isCurrent()) return;
		try {
			complete();
			phase = 'completed';
		} catch (error) {
			phase = 'failed';
			warn('Failed to complete keyboard slot press', error);
		}
	};
	return {
		commit,
		finish: (outcome: InputOutcome): InputOutcome => {
			if (isCompletedKeyboardInput(outcome)) commit();
			if (phase === 'failed') {
				return isCurrent()
					? { status: 'failed', failure: { message: 'Keyboard input failed.' } }
					: { status: 'superseded' };
			}
			return isCurrent() ? outcome : { status: 'superseded' };
		},
	};
}
