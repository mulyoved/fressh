import { type ControllerInvalidationReason } from './controller-core';

export type KeyboardControllerAdmission = {
	setup(): number | null;
	cleanup(generation: number | null): void;
	invalidate(reason: ControllerInvalidationReason): number | null;
	dispose(): void;
	isCurrent(generation: number | null): boolean;
	getGeneration(): number | null;
};

export function createKeyboardControllerAdmission(
	invalidate: (reason: ControllerInvalidationReason) => void,
): KeyboardControllerAdmission {
	let generation = 0;
	let admitted: number | null = null;
	let disposed = false;
	return {
		setup: () => {
			if (disposed) return null;
			generation += 1;
			admitted = generation;
			return generation;
		},
		cleanup: (ownedGeneration) => {
			if (admitted !== ownedGeneration) return;
			admitted = null;
			invalidate('unmount');
		},
		invalidate: (reason) => {
			if (disposed || admitted === null) return null;
			invalidate(reason);
			generation += 1;
			admitted = generation;
			return generation;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			admitted = null;
		},
		isCurrent: (ownedGeneration) =>
			ownedGeneration !== null && admitted === ownedGeneration,
		getGeneration: () => admitted,
	};
}

export type KeyboardAnimationController = {
	replace(identity: string | null, name: string | null): boolean;
	cancel(): void;
};

export function createKeyboardAnimationController(input: {
	initialIdentity: string | null;
	isAdmitted(): boolean;
	setName(name: string | null): void;
	setOpacity(value: number): void;
	start(
		configuration: {
			duration: number;
			delay: number;
			useNativeDriver: boolean;
		},
		completion: (result: { finished: boolean }) => void,
	): () => void;
}): KeyboardAnimationController {
	const identities = createKeyboardAnimationIdentityTracker(
		input.initialIdentity,
	);
	let generation = 0;
	let stop: (() => void) | null = null;
	return {
		replace: (identity, name) => {
			if (!identities.replace(identity) || name === null || !input.isAdmitted())
				return false;
			generation += 1;
			const owned = generation;
			stop?.();
			input.setName(name);
			input.setOpacity(1);
			stop = input.start(
				{ duration: 800, delay: 400, useNativeDriver: true },
				({ finished }) => {
					if (finished && owned === generation && input.isAdmitted())
						input.setName(null);
				},
			);
			return true;
		},
		cancel: () => {
			generation += 1;
			stop?.();
			stop = null;
		},
	};
}

export type KeyboardAnimationIdentityTracker = {
	replace(identity: string | null): boolean;
};

export function createKeyboardAnimationIdentityTracker(
	initialIdentity: string | null,
): KeyboardAnimationIdentityTracker {
	let identity = initialIdentity;
	return {
		replace: (nextIdentity) => {
			if (nextIdentity === identity) return false;
			identity = nextIdentity;
			return nextIdentity !== null;
		},
	};
}

export function applyKeyboardSelectionMode(input: {
	enabled: boolean;
	platformOS: string;
	isCurrent(): boolean;
	setSelectionMode(enabled: boolean): void;
	setTerminalSystemKeyboard(enabled: boolean): void;
	dismissKeyboard(): void;
	clearKeyboardVisibility(): void;
	setSystemKeyboard(enabled: boolean): void;
	warn(message: string, error: unknown): void;
}): void {
	try {
		input.setSelectionMode(input.enabled);
	} catch (error) {
		input.warn('Failed to change selection state', error);
		return;
	}
	if (!input.isCurrent() || input.platformOS !== 'android') return;
	try {
		input.setTerminalSystemKeyboard(!input.enabled);
	} catch (error) {
		input.warn('Failed to change terminal system keyboard mode', error);
		return;
	}
	if (!input.isCurrent()) return;
	if (input.enabled) {
		try {
			input.dismissKeyboard();
		} catch (error) {
			input.warn('Failed to dismiss system keyboard for selection mode', error);
		}
		if (!input.isCurrent()) return;
		input.clearKeyboardVisibility();
	}
	if (!input.isCurrent()) return;
	try {
		input.setSystemKeyboard(!input.enabled);
	} catch (error) {
		input.warn('Failed to publish system keyboard mode', error);
	}
}

export type KeyboardClipboardPorts = {
	isAdmitted(): boolean;
	getInstanceId(): string | null;
	getSelection(): Promise<string>;
	isCurrentInstance(instanceId: string): boolean;
	writeClipboard(text: string): Promise<void>;
	exitSelectionState(): void;
	exitSelectionView(): void;
	completeSlotPress(): void;
	warn(message: string, error: unknown): void;
};

export type KeyboardClipboardAuthority = {
	copy(ports: KeyboardClipboardPorts): Promise<void>;
	noteSelection(text: string): void;
	invalidate(): void;
};

export function createKeyboardClipboardAuthority(): KeyboardClipboardAuthority {
	let operation = 0;
	let lastCopied = '';
	let queued = Promise.resolve();
	const safeWarn = (
		ports: KeyboardClipboardPorts,
		message: string,
		error: unknown,
	) => {
		try {
			ports.warn(message, error);
		} catch {
			// Diagnostics cannot own clipboard authority.
		}
	};
	const safeCurrent = (
		ports: KeyboardClipboardPorts,
		id: number,
		instanceId: string,
	) => {
		if (id !== operation || !ports.isAdmitted()) return false;
		try {
			return ports.isCurrentInstance(instanceId);
		} catch (error) {
			safeWarn(
				ports,
				'Failed to validate terminal instance for selection copy',
				error,
			);
			return false;
		}
	};
	return {
		copy: async (ports) => {
			const id = ++operation;
			if (!ports.isAdmitted()) return;
			let instanceId: string | null;
			try {
				instanceId = ports.getInstanceId();
			} catch (error) {
				safeWarn(
					ports,
					'Failed to read terminal instance for selection copy',
					error,
				);
				return;
			}
			if (!instanceId) return;
			let text: string;
			try {
				text = await ports.getSelection();
			} catch (error) {
				safeWarn(ports, 'Failed to read terminal selection', error);
				return;
			}
			if (!text || text === lastCopied || !safeCurrent(ports, id, instanceId))
				return;
			await queued;
			if (!safeCurrent(ports, id, instanceId)) return;
			let release = () => {};
			queued = new Promise<void>((resolve) => {
				release = resolve;
			});
			try {
				await ports.writeClipboard(text);
			} catch (error) {
				safeWarn(
					ports,
					'Failed to write terminal selection to clipboard',
					error,
				);
				return;
			} finally {
				release();
			}
			if (!safeCurrent(ports, id, instanceId)) return;
			lastCopied = text;
			try {
				ports.exitSelectionState();
			} catch (error) {
				safeWarn(ports, 'Failed to exit selection state after copy', error);
			}
			if (!safeCurrent(ports, id, instanceId)) return;
			try {
				ports.exitSelectionView();
			} catch (error) {
				safeWarn(
					ports,
					'Failed to exit terminal selection view after copy',
					error,
				);
			}
			if (!safeCurrent(ports, id, instanceId)) return;
			try {
				ports.completeSlotPress();
			} catch (error) {
				safeWarn(
					ports,
					'Failed to complete one-shot keyboard after copy',
					error,
				);
			}
		},
		noteSelection: (text) => {
			if (text !== lastCopied) lastCopied = '';
		},
		invalidate: () => {
			operation += 1;
		},
	};
}

export function subscribeKeyboardVisibility(input: {
	platformOS: string;
	addListener(
		event: 'keyboardDidShow' | 'keyboardDidHide',
		listener: () => void,
	): { remove(): void };
	onVisibility(visible: boolean): void;
}): () => void {
	if (input.platformOS !== 'android') return () => {};
	const show = input.addListener('keyboardDidShow', () =>
		input.onVisibility(true),
	);
	const hide = input.addListener('keyboardDidHide', () =>
		input.onVisibility(false),
	);
	return () => {
		show.remove();
		hide.remove();
	};
}
