import { type ModifierKey } from '@/lib/shell-config';

type KeyboardModifierContract = Readonly<{
	canApplyTo(bytes: Uint8Array<ArrayBuffer>): boolean;
	apply(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
	orderPreference: number;
}>;

const escapeByte = 27;

const shiftModifier: KeyboardModifierContract = Object.freeze({
	orderPreference: 5,
	canApplyTo: (bytes) => bytes.some((byte) => byte >= 97 && byte <= 122),
	apply: (bytes) => {
		const next = new Uint8Array(bytes.length);
		for (let index = 0; index < bytes.length; index += 1) {
			const byte = bytes[index];
			if (byte === undefined) continue;
			next[index] = byte >= 97 && byte <= 122 ? byte - 32 : byte;
		}
		return next;
	},
});

function mapByteToCtrl(byte: number): number | null {
	if (byte === 32) return 0;
	const uppercase = byte & 0b1101_1111;
	if (uppercase >= 64 && uppercase <= 95) return uppercase & 0x1f;
	if (byte === 63) return 127;
	return null;
}

const ctrlModifier: KeyboardModifierContract = Object.freeze({
	orderPreference: 10,
	canApplyTo: (bytes) => {
		const firstByte = bytes[0];
		return firstByte !== undefined && mapByteToCtrl(firstByte) !== null;
	},
	apply: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) return bytes;
		const ctrlByte = mapByteToCtrl(firstByte);
		return ctrlByte === null ? bytes : new Uint8Array([ctrlByte]);
	},
});

const altModifier: KeyboardModifierContract = Object.freeze({
	orderPreference: 20,
	canApplyTo: (bytes) => bytes.length > 0 && bytes[0] !== escapeByte,
	apply: (bytes) => {
		const result = new Uint8Array(bytes.length + 1);
		result[0] = escapeByte;
		result.set(bytes, 1);
		return result;
	},
});

const cmdModifier: KeyboardModifierContract = Object.freeze({
	orderPreference: 30,
	canApplyTo: () => false,
	apply: (bytes) => bytes,
});

const keyboardModifiers: Readonly<
	Record<ModifierKey, KeyboardModifierContract>
> = Object.freeze({
	SHIFT: shiftModifier,
	CTRL: ctrlModifier,
	ALT: altModifier,
	CMD: cmdModifier,
});

export function applyKeyboardModifiers(
	bytes: Uint8Array<ArrayBuffer>,
	activeModifiers: readonly ModifierKey[],
): Uint8Array<ArrayBuffer> {
	let next = new Uint8Array(bytes);
	for (const modifier of activeModifiers
		.map((key) => keyboardModifiers[key])
		.sort((left, right) => left.orderPreference - right.orderPreference)) {
		if (modifier.canApplyTo(next)) next = modifier.apply(next);
	}
	return next;
}
