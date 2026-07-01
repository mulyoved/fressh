import { type ConnectionDiagnosticError } from './types';

const CIRCULAR_PLACEHOLDER = '[Circular]';
const UNREADABLE_VALUE_MESSAGE = '[Unreadable]';
const PRIVATE_KEY_OMITTED_MESSAGE = '[Private key material omitted]';
export const UNREADABLE_ERROR_MESSAGE = '[Unserializable error]';

const PRIVATE_KEY_BLOCK_PATTERN =
	/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu;

export function omitPrivateKeyMaterial(value: string): string {
	return value.replace(PRIVATE_KEY_BLOCK_PATTERN, PRIVATE_KEY_OMITTED_MESSAGE);
}

export function safeDiagnosticString(
	value: unknown,
	fallback = UNREADABLE_ERROR_MESSAGE,
): string {
	try {
		if (typeof value === 'string') return omitPrivateKeyMaterial(value);
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (typeof value === 'bigint') return `${value}n`;
		if (typeof value === 'symbol') {
			return `[Symbol ${value.description ?? ''}]`;
		}
		if (typeof value === 'undefined') return 'undefined';
		if (value === null) return 'null';
		return fallback;
	} catch {
		return fallback;
	}
}

function snapshotDiagnosticValueInternal(
	value: unknown,
	path: WeakSet<object>,
): unknown {
	try {
		if (value === null) return null;
		if (
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			typeof value === 'undefined'
		) {
			return value;
		}
		if (typeof value === 'string') return safeDiagnosticString(value);
		if (typeof value === 'bigint') return `${value}n`;
		if (typeof value === 'function') {
			return '[Function]';
		}
		if (typeof value === 'symbol') {
			return safeDiagnosticString(`[Symbol ${value.description ?? ''}]`);
		}
		if (typeof value !== 'object') return safeDiagnosticString(value);

		if (path.has(value)) return CIRCULAR_PLACEHOLDER;

		if (Array.isArray(value)) {
			const copy: unknown[] = [];
			path.add(value);
			try {
				for (const item of value) {
					copy.push(snapshotDiagnosticValueInternal(item, path));
				}
			} finally {
				path.delete(value);
			}
			return copy;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return UNREADABLE_VALUE_MESSAGE;
		}

		const copy: Record<string, unknown> = {};
		path.add(value);
		try {
			for (const key of Object.keys(value)) {
				try {
					copy[safeDiagnosticString(key, key)] = snapshotDiagnosticValueInternal(
						(value as Record<string, unknown>)[key],
						path,
					);
				} catch {
					copy[safeDiagnosticString(key, key)] = UNREADABLE_VALUE_MESSAGE;
				}
			}
		} finally {
			path.delete(value);
		}
		return copy;
	} catch {
		return UNREADABLE_VALUE_MESSAGE;
	}
}

export function snapshotDiagnosticValue<T>(value: T): T {
	return snapshotDiagnosticValueInternal(value, new WeakSet()) as T;
}

export function serializeConnectionDiagnosticError(
	error: unknown,
): ConnectionDiagnosticError {
	const errorLike = isErrorLike(error);
	const name = readStringField(error, 'name');
	const message = readStringField(error, 'message');
	const tag = readStringField(error, 'tag');
	const inner = readObjectField(error, 'inner');

	if (
		errorLike ||
		name !== undefined ||
		message !== undefined ||
		tag !== undefined ||
		inner !== undefined
	) {
		const defaultName = errorLike ? 'Error' : 'NonError';
		const serializedError: ConnectionDiagnosticError = {
			name: name && name.length > 0 ? name : defaultName,
			message: message ?? tag ?? UNREADABLE_ERROR_MESSAGE,
		};
		const stack = readStringField(error, 'stack');

		if (stack !== undefined) serializedError.stack = stack;
		if (tag !== undefined) serializedError.tag = tag;
		if (inner !== undefined) {
			serializedError.inner = snapshotDiagnosticValue(inner);
		}

		return serializedError;
	}

	return {
		name: 'NonError',
		message: safeDiagnosticString(error),
	};
}

function isErrorLike(error: unknown): error is Error {
	try {
		return error instanceof Error;
	} catch {
		return false;
	}
}

export function readStringField(
	value: unknown,
	field: string,
): string | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'string'
			? safeDiagnosticString(fieldValue)
			: undefined;
	} catch {
		return undefined;
	}
}

export function readNumberField(
	value: unknown,
	field: string,
): number | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'number' && Number.isFinite(fieldValue)
			? fieldValue
			: undefined;
	} catch {
		return undefined;
	}
}

export function readBooleanField(
	value: unknown,
	field: string,
): boolean | undefined {
	try {
		const fieldValue = readObjectField(value, field);
		return typeof fieldValue === 'boolean' ? fieldValue : undefined;
	} catch {
		return undefined;
	}
}

export function readObjectField(value: unknown, field: string): unknown {
	try {
		if (
			value === null ||
			(typeof value !== 'object' && typeof value !== 'function')
		) {
			return undefined;
		}

		return (value as Record<string, unknown>)[field];
	} catch {
		return undefined;
	}
}
