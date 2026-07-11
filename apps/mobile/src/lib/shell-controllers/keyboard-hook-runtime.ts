import {
	type ControllerInvalidationReason,
	type ControllerOutcome,
} from './controller-core';

export type KeyboardActivityTransitionController = {
	reconcile(
		interactive: boolean,
		actions: {
			setupInitialKeyboard(): void;
			resumeFromAppState(): void;
		},
		rememberVisibility: () => void,
	): void;
};

export function createKeyboardActivityTransitionController(
	initialInteractive: boolean,
): KeyboardActivityTransitionController {
	let previousInteractive = initialInteractive;
	let initialized = false;
	return {
		reconcile: (interactive, actions, rememberVisibility) => {
			if (previousInteractive && !interactive) rememberVisibility();
			if (interactive) {
				if (!initialized) {
					initialized = true;
					actions.setupInitialKeyboard();
				} else if (!previousInteractive) {
					actions.resumeFromAppState();
				}
			}
			previousInteractive = interactive;
		},
	};
}

export function invalidateKeyboardControllerDomains(
	reason: ControllerInvalidationReason,
	domains: readonly ((reason: ControllerInvalidationReason) => void)[],
): void {
	for (const invalidate of domains) {
		try {
			invalidate(reason);
		} catch {
			/* Each sibling domain still receives invalidation. */
		}
	}
}

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
	let lifecycleOwner: number | null = null;
	let mounted = false;
	let disposed = false;
	let transaction = 0;
	return {
		setup: () => {
			if (disposed) return null;
			generation += 1;
			admitted = generation;
			lifecycleOwner = generation;
			mounted = true;
			return generation;
		},
		cleanup: (ownedGeneration) => {
			if (disposed || lifecycleOwner !== ownedGeneration) return;
			transaction += 1;
			mounted = false;
			lifecycleOwner = null;
			admitted = null;
			try {
				invalidate('unmount');
			} catch {
				/* Domain cleanup is contained. */
			}
		},
		invalidate: (reason) => {
			if (disposed || !mounted) return null;
			const ownedTransaction = ++transaction;
			admitted = null;
			try {
				invalidate(reason);
			} catch {
				/* Reopen deterministically after contained domain failure. */
			} finally {
				if (
					!disposed &&
					mounted &&
					transaction === ownedTransaction &&
					admitted === null
				) {
					generation += 1;
					admitted = generation;
				}
			}
			return admitted;
		},
		dispose: () => {
			if (disposed) return;
			transaction += 1;
			disposed = true;
			mounted = false;
			lifecycleOwner = null;
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
	getAdmissionGeneration(): number | null;
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
			const admission = input.getAdmissionGeneration();
			if (!identities.replace(identity) || name === null || admission === null)
				return false;
			generation += 1;
			const owned = generation;
			stop?.();
			input.setName(name);
			input.setOpacity(1);
			stop = input.start(
				{ duration: 800, delay: 400, useNativeDriver: true },
				({ finished }) => {
					if (
						finished &&
						owned === generation &&
						input.getAdmissionGeneration() === admission
					)
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
	warn(message: string, error: unknown): void;
};

export type KeyboardClipboardOutcome = ControllerOutcome<{ message: string }>;

export type KeyboardClipboardAuthority = {
	copy(ports: KeyboardClipboardPorts): Promise<KeyboardClipboardOutcome>;
	noteSelection(text: string, instanceId?: string | null): void;
	invalidate(): void;
};

export function createKeyboardClipboardAuthority(): KeyboardClipboardAuthority {
	let request = 0;
	let operation = 0;
	let completedCopy = 0;
	let lastCopied: {
		instanceId: string;
		text: string;
		completion: number;
	} | null = null;
	let activeWrite: {
		instanceId: string;
		text: string;
		release(): void;
		result: Promise<KeyboardClipboardOutcome>;
	} | null = null;
	const detachWrite = () => {
		activeWrite?.release();
		activeWrite = null;
	};
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
			const requestId = ++request;
			const completedCopyAtStart = completedCopy;
			if (!ports.isAdmitted()) return { status: 'unavailable' };
			let instanceId: string | null;
			try {
				instanceId = ports.getInstanceId();
			} catch (error) {
				safeWarn(
					ports,
					'Failed to read terminal instance for selection copy',
					error,
				);
				return {
					status: 'failed',
					failure: { message: 'Failed to copy terminal selection.' },
				};
			}
			if (!instanceId) return { status: 'unavailable' };
			let text: string;
			try {
				text = await ports.getSelection();
			} catch (error) {
				safeWarn(ports, 'Failed to read terminal selection', error);
				return {
					status: 'failed',
					failure: { message: 'Failed to copy terminal selection.' },
				};
			}
			if (!text) return { status: 'unavailable' };
			if (activeWrite?.instanceId === instanceId && activeWrite.text === text)
				return activeWrite.result;
			if (requestId !== request) return { status: 'superseded' };
			if (lastCopied?.instanceId === instanceId && lastCopied.text === text)
				return lastCopied.completion > completedCopyAtStart
					? { status: 'completed' }
					: { status: 'unavailable' };
			detachWrite();
			const id = ++operation;
			if (!safeCurrent(ports, id, instanceId)) return { status: 'superseded' };
			let release = () => {};
			const detached = new Promise<void>((resolve) => {
				release = resolve;
			});
			const result = (async (): Promise<KeyboardClipboardOutcome> => {
				try {
					await Promise.race([ports.writeClipboard(text), detached]);
				} catch (error) {
					safeWarn(
						ports,
						'Failed to write terminal selection to clipboard',
						error,
					);
					return id === operation
						? {
								status: 'failed',
								failure: { message: 'Failed to copy terminal selection.' },
							}
						: { status: 'superseded' };
				}
				if (id !== operation) return { status: 'superseded' };
				if (!safeCurrent(ports, id, instanceId))
					return { status: 'superseded' };
				try {
					ports.exitSelectionState();
				} catch (error) {
					safeWarn(ports, 'Failed to exit selection state after copy', error);
				}
				if (!safeCurrent(ports, id, instanceId))
					return { status: 'superseded' };
				try {
					ports.exitSelectionView();
				} catch (error) {
					safeWarn(
						ports,
						'Failed to exit terminal selection view after copy',
						error,
					);
				}
				if (!safeCurrent(ports, id, instanceId))
					return { status: 'superseded' };
				completedCopy += 1;
				lastCopied = { instanceId, text, completion: completedCopy };
				return { status: 'completed' };
			})().finally(() => {
				if (activeWrite?.release === release) activeWrite = null;
			});
			activeWrite = { instanceId, text, release, result };
			return result;
		},
		noteSelection: (text, instanceId) => {
			if (
				lastCopied &&
				(instanceId === undefined || instanceId === lastCopied.instanceId) &&
				text !== lastCopied.text
			)
				lastCopied = null;
		},
		invalidate: () => {
			request += 1;
			operation += 1;
			detachWrite();
			lastCopied = null;
		},
	};
}

export function createKeyboardPasteClipboardCommand<Token>(input: {
	captureAuthority(): Token | null;
	isCurrent(token: Token): boolean;
	readClipboard(): Promise<string>;
	paste(text: string): Promise<unknown>;
	warn(message: string, error: unknown): void;
}): () => Promise<void> {
	const safeWarn = (message: string, error: unknown) => {
		try {
			input.warn(message, error);
		} catch {
			/* Diagnostics are contained. */
		}
	};
	return async () => {
		let token: Token | null;
		try {
			token = input.captureAuthority();
		} catch (error) {
			safeWarn('Failed to capture clipboard paste authority', error);
			return;
		}
		if (token === null) return;
		let text: string;
		try {
			text = await input.readClipboard();
		} catch (error) {
			safeWarn('Failed to read clipboard', error);
			return;
		}
		try {
			if (!input.isCurrent(token)) return;
		} catch (error) {
			safeWarn('Failed to validate clipboard paste authority', error);
			return;
		}
		try {
			await input.paste(text);
		} catch (error) {
			safeWarn('Failed to paste clipboard', error);
		}
	};
}

export function runKeyboardFireAndForget(
	task: () => void | PromiseLike<unknown>,
	isCurrent: () => boolean,
	warn: (message: string, error: unknown) => void,
): void {
	const report = (error: unknown) => {
		try {
			if (isCurrent()) warn('Keyboard action failed', error);
		} catch {
			/* Contained. */
		}
	};
	try {
		Promise.resolve(task()).catch(report);
	} catch (error) {
		report(error);
	}
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
	let hide: { remove(): void };
	try {
		hide = input.addListener('keyboardDidHide', () =>
			input.onVisibility(false),
		);
	} catch (error) {
		try {
			show.remove();
		} catch {
			/* Preserve registration failure. */
		}
		throw error;
	}
	return () => {
		try {
			show.remove();
		} catch {
			/* Hide removal must still run. */
		}
		try {
			hide.remove();
		} catch {
			/* Cleanup is contained. */
		}
	};
}
