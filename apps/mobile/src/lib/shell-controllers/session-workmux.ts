import { type ConnectionDiagnosticEvent } from '../connection-diagnostics';
import { type MdevBridgeOperationRequest } from '../workmux-bridge-operations';
import {
	createWorkmuxControlChannel,
	type WorkmuxControlChannel,
	type WorkmuxControlCommandResult,
	type WorkmuxScrollMove,
	type WorkmuxScrollTarget,
} from '../workmux-control-channel';
import { type ControllerOutcome } from './controller-core';
import {
	type RetiringWorkmuxCleanupPort,
	type ShellWorkmuxPort,
} from './session-contracts';
import { type ShellDiagnosticPort } from './session-diagnostics';
import { type ShellTargetKey } from './source-keys';

type ShellSessionWorkmuxInput = {
	key: ShellTargetKey;
	connection: Parameters<typeof createWorkmuxControlChannel>[0]['connection'];
	diagnostics: ShellDiagnosticPort;
	createChannel(input: {
		connection: Parameters<typeof createWorkmuxControlChannel>[0]['connection'];
		trace: { event(event: ConnectionDiagnosticEvent): void };
	}): WorkmuxControlChannel;
	cleanupTimeoutMs?: number;
	setTimeout(task: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
};

export function createShellSessionWorkmuxInput({
	key,
	connection,
	diagnostics,
}: Pick<
	ShellSessionWorkmuxInput,
	'key' | 'connection' | 'diagnostics'
>): ShellSessionWorkmuxInput {
	return {
		key,
		connection,
		diagnostics,
		createChannel: createWorkmuxControlChannel,
		setTimeout: (task, delayMs) => setTimeout(task, delayMs),
		clearTimeout: (timer) =>
			clearTimeout(timer as ReturnType<typeof setTimeout>),
	};
}

export type ShellSessionWorkmuxOwner = {
	activate(): void;
	getPort(): ShellWorkmuxPort;
	replace(input: ShellSessionWorkmuxInput): void;
	dispose(reason: 'reconnect' | 'unmount'): void;
	drain(): Promise<void>;
};

type CleanupRegistration = {
	cleanup(port: RetiringWorkmuxCleanupPort): Promise<void>;
};

type OwnedWorkmux = {
	channel: WorkmuxControlChannel | null;
	readonly input: ShellSessionWorkmuxInput;
	readonly cleanups: Map<string, CleanupRegistration>;
	port: ShellWorkmuxPort;
	active: boolean;
	cleanupOpen: boolean;
	retirementScheduled: boolean;
};

type OwnerMutation =
	| { kind: 'replace'; input: ShellSessionWorkmuxInput }
	| { kind: 'dispose'; reason: 'reconnect' | 'unmount' };

type Retirement = {
	owned: OwnedWorkmux;
	reason: 'reconnect' | 'unmount';
	registrations: [string, CleanupRegistration][];
	afterRetire?(): void;
};

const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;

function failedOutcome(result: WorkmuxControlCommandResult): ControllerOutcome<{
	message: string;
	failureClass?: WorkmuxControlCommandResult['failureClass'];
}> & { output?: string } {
	return {
		status: 'failed',
		failure: {
			message: result.error || result.output || 'Workmux command failed.',
			...(result.failureClass ? { failureClass: result.failureClass } : {}),
		},
		...(result.output ? { output: result.output } : {}),
	};
}

function toCommandOutcome(
	result: WorkmuxControlCommandResult,
): ControllerOutcome<{
	message: string;
	failureClass?: WorkmuxControlCommandResult['failureClass'];
}> & { output?: string } {
	return result.success
		? {
				status: 'completed',
				...(result.output ? { output: result.output } : {}),
			}
		: failedOutcome(result);
}

function thrownCommandOutcome(
	error: unknown,
): ControllerOutcome<{ message: string }> {
	return {
		status: 'failed',
		failure: {
			message: error instanceof Error ? error.message : String(error),
		},
	};
}

export function createShellSessionWorkmuxOwner(
	initialInput: ShellSessionWorkmuxInput,
	options: { deferActivation?: boolean } = {},
): ShellSessionWorkmuxOwner {
	let disposed = false;
	let transitioning = false;
	let mutations: OwnerMutation[] = [];
	let retirementQueue: Retirement[] = [];
	let processingRetirement = false;
	let resolveRetirementDrain: (() => void) | null = null;
	let retirementDrain = Promise.resolve();
	let pendingReplacement: ShellSessionWorkmuxInput | null = null;
	let current = createOwnedWorkmux(
		initialInput,
		options.deferActivation !== true,
	);

	function warnSafely(
		owned: OwnedWorkmux,
		message: string,
		error?: unknown,
	): void {
		try {
			owned.input.diagnostics.warn(message, error);
		} catch {
			// Resource retirement must not depend on diagnostics.
		}
	}

	function createOwnedWorkmux(
		input: ShellSessionWorkmuxInput,
		activateImmediately = true,
	): OwnedWorkmux {
		const owned = {
			channel: null,
			input,
			cleanups: new Map<string, CleanupRegistration>(),
			port: null as unknown as ShellWorkmuxPort,
			active: true,
			cleanupOpen: false,
			retirementScheduled: false,
		} satisfies OwnedWorkmux;

		const runCommand = async (
			invoke: (
				channel: WorkmuxControlChannel,
			) => Promise<WorkmuxControlCommandResult>,
		): Promise<
			ControllerOutcome<{
				message: string;
				failureClass?: WorkmuxControlCommandResult['failureClass'];
			}> & { output?: string }
		> => {
			const channel = owned.channel;
			if (!owned.active) return { status: 'superseded' };
			if (channel === null) return { status: 'unavailable' };
			try {
				const result = await invoke(channel);
				if (!owned.active) return { status: 'superseded' };
				return toCommandOutcome(result);
			} catch (error) {
				return owned.active
					? thrownCommandOutcome(error)
					: { status: 'superseded' };
			}
		};

		const runScroll = async (
			invoke: (
				channel: WorkmuxControlChannel,
			) => Promise<WorkmuxControlCommandResult>,
		): ReturnType<typeof runCommand> => {
			const channel = owned.channel;
			if (!owned.active) return Promise.resolve({ status: 'superseded' });
			if (channel === null) return Promise.resolve({ status: 'unavailable' });
			try {
				const result = await invoke(channel);
				return owned.active
					? toCommandOutcome(result)
					: { status: 'superseded' };
			} catch (error) {
				return owned.active
					? thrownCommandOutcome(error)
					: { status: 'superseded' };
			}
		};

		owned.port = {
			key: input.key,
			command: (argv: string[], options?: { timeoutMs?: number }) =>
				runCommand((channel) => channel.command(argv, options)),
			operation: (
				request: MdevBridgeOperationRequest,
				options?: { timeoutMs?: number },
			) => runCommand((channel) => channel.operation(request, options)),
			scroll: {
				enter: (scrollInput: WorkmuxScrollTarget) =>
					runScroll((channel) => channel.scroll.enter(scrollInput)),
				move: (scrollInput: WorkmuxScrollMove) =>
					runScroll((channel) => channel.scroll.move(scrollInput)),
				exit: (scrollInput: WorkmuxScrollTarget) =>
					runScroll((channel) => channel.scroll.exit(scrollInput)),
			},
			registerBeforeDispose: (owner, cleanup) => {
				if (!owned.active) return () => {};
				const registration = { cleanup };
				owned.cleanups.set(owner, registration);
				return () => {
					if (owned.cleanups.get(owner) === registration) {
						owned.cleanups.delete(owner);
					}
				};
			},
		};
		if (activateImmediately) activateOwned(owned);
		return owned;
	}

	function activateOwned(owned: OwnedWorkmux): void {
		if (!owned.active || owned.channel !== null) return;
		const { input } = owned;
		try {
			owned.channel = input.createChannel({
				connection: input.connection,
				trace: {
					event: (event) => {
						try {
							input.diagnostics.event(event);
						} catch {
							// Channel diagnostics cannot affect control operations.
						}
					},
				},
			});
		} catch (error) {
			owned.channel = null;
			warnSafely(owned, 'Workmux control channel factory failed', error);
		}
	}

	function createRetiringPort(owned: OwnedWorkmux): RetiringWorkmuxCleanupPort {
		return {
			exitScroll: async (input) => {
				const channel = owned.channel;
				if (!owned.cleanupOpen) return { status: 'superseded' };
				if (channel === null) return { status: 'unavailable' };
				try {
					const result = await channel.scroll.exit(input);
					if (!owned.cleanupOpen) return { status: 'superseded' };
					return result.success
						? { status: 'completed' }
						: { status: 'unavailable' };
				} catch {
					return owned.cleanupOpen
						? { status: 'unavailable' }
						: { status: 'superseded' };
				}
			},
		};
	}

	async function runCleanups(
		owned: OwnedWorkmux,
		registrations: [string, CleanupRegistration][],
	): Promise<void> {
		const retiringPort = createRetiringPort(owned);
		for (const [owner, registration] of registrations) {
			if (!owned.cleanupOpen) return;
			try {
				await registration.cleanup(retiringPort);
			} catch (error) {
				if (!owned.cleanupOpen) return;
				warnSafely(
					owned,
					`Workmux ${owner} cleanup failed before channel disposal`,
					error,
				);
			}
		}
	}

	async function retire(
		owned: OwnedWorkmux,
		reason: 'reconnect' | 'unmount',
		registrations: [string, CleanupRegistration][],
	): Promise<void> {
		let cleanupTimer: unknown = null;
		let settled = false;
		let timedOut = false;
		owned.cleanupOpen = true;
		try {
			const cleanup = runCleanups(owned, registrations).then(() => {
				if (settled) return;
				settled = true;
				owned.cleanupOpen = false;
			});
			const cleanupTimeoutMs =
				owned.input.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
			const timeout = new Promise<void>((resolve) => {
				cleanupTimer = owned.input.setTimeout(
					() => {
						if (settled || timedOut) return;
						timedOut = true;
						settled = true;
						owned.cleanupOpen = false;
						cleanupTimer = null;
						warnSafely(
							owned,
							`Workmux cleanup timed out after ${cleanupTimeoutMs}ms before channel disposal`,
						);
						resolve();
					},
					Math.max(0, cleanupTimeoutMs),
				);
				const maybeNodeTimer = cleanupTimer as { unref?: () => void } | null;
				maybeNodeTimer?.unref?.();
			});
			await Promise.race([cleanup, timeout]);
		} finally {
			settled = true;
			owned.cleanupOpen = false;
			const timerToClear = cleanupTimer;
			cleanupTimer = null;
			if (timerToClear !== null) {
				try {
					owned.input.clearTimeout(timerToClear);
				} catch (error) {
					warnSafely(owned, 'Workmux cleanup timer clearing failed', error);
				}
			}
			try {
				await owned.channel?.dispose({ reason });
			} catch (error) {
				warnSafely(owned, 'Workmux control channel dispose failed', error);
			}
		}
	}

	function processNextRetirement(): void {
		const retirement = retirementQueue.shift();
		if (!retirement) {
			processingRetirement = false;
			resolveRetirementDrain?.();
			resolveRetirementDrain = null;
			return;
		}
		processingRetirement = true;
		const finishRetirement = () => {
			try {
				retirement.afterRetire?.();
			} catch (error) {
				warnSafely(
					retirement.owned,
					'Workmux successor construction failed',
					error,
				);
			} finally {
				processNextRetirement();
			}
		};
		void retire(
			retirement.owned,
			retirement.reason,
			retirement.registrations,
		).then(finishRetirement, finishRetirement);
	}

	function enqueueRetirement(retirement: Retirement): void {
		retirementQueue.push(retirement);
		if (resolveRetirementDrain === null) {
			retirementDrain = new Promise<void>((resolve) => {
				resolveRetirementDrain = resolve;
			});
		}
		if (!processingRetirement) processNextRetirement();
	}

	function scheduleRetirement(
		owned: OwnedWorkmux,
		reason: 'reconnect' | 'unmount',
		afterRetire?: () => void,
	): void {
		if (owned.retirementScheduled) return;
		owned.retirementScheduled = true;
		if (owned.channel !== null) {
			try {
				owned.channel.prepareDispose({ reason });
			} catch (error) {
				warnSafely(
					owned,
					'Workmux control channel prepare-dispose failed',
					error,
				);
			}
		}
		owned.active = false;
		const registrations = [...owned.cleanups.entries()];
		owned.cleanups.clear();
		if (owned.channel !== null) {
			enqueueRetirement({
				owned,
				reason,
				registrations,
				...(afterRetire ? { afterRetire } : {}),
			});
		} else {
			afterRetire?.();
		}
	}

	function exposePendingReplacement(): void {
		if (disposed || pendingReplacement === null) return;
		const input = pendingReplacement;
		pendingReplacement = null;
		current = createOwnedWorkmux(input);
	}

	function applyMutation(mutation: OwnerMutation): void {
		if (mutation.kind === 'replace') {
			if (disposed) return;
			pendingReplacement = mutation.input;
			scheduleRetirement(current, 'reconnect', exposePendingReplacement);
			return;
		}
		if (disposed) return;
		disposed = true;
		pendingReplacement = null;
		scheduleRetirement(current, mutation.reason);
	}

	function mutate(mutation: OwnerMutation): void {
		if (disposed) return;
		if (transitioning) {
			mutations.push(mutation);
			return;
		}
		transitioning = true;
		try {
			applyMutation(mutation);
			while (mutations.length > 0) {
				const next = mutations.shift();
				if (next) applyMutation(next);
			}
		} finally {
			transitioning = false;
			if (disposed) mutations = [];
		}
	}

	return {
		activate: () => activateOwned(current),
		getPort: () => current.port,
		replace: (input) => mutate({ kind: 'replace', input }),
		dispose: (reason) => mutate({ kind: 'dispose', reason }),
		drain: () => retirementDrain,
	};
}
