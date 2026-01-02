import { type KeyboardSlot, type MacroDef } from '@/generated/keyboard-config';
import { type ActionId } from '@/lib/keyboard-actions';

// Runtime helpers for executing generated keyboard slots and macros.
type MacroPayload =
	| { type: 'command'; value: string; enter?: boolean }
	| { type: 'text'; value: string; enter?: boolean }
	| { type: 'sequence'; value: string }
	| { type: 'action'; actionId: ActionId };

const textEncoder = new TextEncoder();

function encodeText(value: string): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(value);
}

export function parseMacroScript(script: string): MacroPayload | null {
	const trimmed = script.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		if (!parsed || typeof parsed !== 'object') return null;
		if (parsed.type === 'command' && typeof parsed.value === 'string') {
			return {
				type: 'command',
				value: parsed.value,
				enter:
					parsed.enter === undefined ? true : Boolean(parsed.enter),
			};
		}
		if (parsed.type === 'text' && typeof parsed.value === 'string') {
			return {
				type: 'text',
				value: parsed.value,
				enter:
					parsed.enter === undefined ? false : Boolean(parsed.enter),
			};
		}
		if (parsed.type === 'sequence' && typeof parsed.value === 'string') {
			return { type: 'sequence', value: parsed.value };
		}
		if (parsed.type === 'action') {
			const actionId =
				typeof parsed.actionId === 'string'
					? parsed.actionId
					: typeof parsed.name === 'string'
						? parsed.name
						: typeof parsed.action === 'string'
							? parsed.action
							: null;
			if (actionId) {
				return { type: 'action', actionId };
			}
		}
	} catch {
		return null;
	}
	return null;
}

export function runMacro(
	macro: MacroDef,
	{
		sendBytes,
		sendText,
		onAction,
	}: {
		sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
		sendText: (value: string) => void;
		onAction: (actionId: ActionId) => void;
	},
) {
	const parsed = parseMacroScript(macro.script);
	if (!parsed) {
		sendText(macro.script);
		return;
	}

	switch (parsed.type) {
		case 'command': {
			sendText(parsed.value);
			if (parsed.enter) sendBytes(encodeText('\r'));
			return;
		}
		case 'text': {
			sendText(parsed.value);
			if (parsed.enter) sendBytes(encodeText('\r'));
			return;
		}
		case 'sequence': {
			sendBytes(encodeText(parsed.value));
			return;
		}
		case 'action': {
			onAction(parsed.actionId);
			return;
		}
		default:
			return;
	}
}

export function runSlotItem(
	item: KeyboardSlot,
	macros: MacroDef[],
	{
		sendBytes,
		sendText,
		onAction,
	}: {
		sendBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
		sendText: (value: string) => void;
		onAction: (actionId: ActionId) => void;
	},
) {
	switch (item.type) {
		case 'text': {
			sendText(item.text);
			return;
		}
		case 'bytes': {
			sendBytes(new Uint8Array(item.bytes));
			return;
		}
		case 'macro': {
			const macro = macros.find((m) => m.id === item.macroId);
			if (!macro) return;
			runMacro(macro, { sendBytes, sendText, onAction });
			return;
		}
		case 'action': {
			onAction(item.actionId);
			return;
		}
		default:
			return;
	}
}
