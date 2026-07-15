import { type ScrollTraceSink } from './scroll-trace';
import { type ScrollbackOperationOwner } from './shell-controllers/scrollback-operation-owner';
import { formatWorkmuxAppBoundaryFailureMessage } from './workmux-app-commands';
import { type WorkmuxControlChannel } from './workmux-control-channel';
import {
	coalesceWorkmuxScrollbackPendingPageCommands,
	mergeWorkmuxScrollbackPageCommands,
	type WorkmuxScrollbackPageCommand,
} from './workmux-scrollback-batch';

export type WorkmuxScrollbackCommandResult = {
	success: boolean;
	output: string;
	error?: string;
};

type WorkmuxScrollbackCommandKind = 'enter' | 'scroll';
export type WorkmuxScrollbackFailurePolicy = 'notify' | 'suppress';

export type WorkmuxScrollbackFailureContext = {
	commandKind: 'enter' | 'scroll' | 'exit';
	operationOwner?: ScrollbackOperationOwner;
};

export type WorkmuxScrollbackTraceEvent = Parameters<ScrollTraceSink>[0];

export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (
		targetName: string,
		operationOwner?: ScrollbackOperationOwner,
	) => Promise<boolean>;
	enqueueScrollBatch: (
		commands: WorkmuxScrollbackPageCommand[],
	) => Promise<boolean>;
	reset: (options?: {
		targetName?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => Promise<boolean> | null;
	dispose: (options?: { targetName?: string }) => Promise<boolean> | null;
};

export type WorkmuxScrollbackCommandExecutorInput = {
	scrollTransport: WorkmuxControlChannel['scroll'];
	onFailure: (
		message: string,
		context: WorkmuxScrollbackFailureContext,
	) => void;
	onDisposeExitFailure?: (message: string) => void;
	onTrace?: ScrollTraceSink;
};

export function formatWorkmuxScrollbackCommandFailureMessage(result: {
	success: boolean;
	output: string;
	error?: string;
}): string | null {
	if (result.success) return null;
	return formatWorkmuxAppBoundaryFailureMessage(
		result.error || result.output || '',
	);
}

async function runSingleOperation(
	operation: () => Promise<WorkmuxScrollbackCommandResult>,
): Promise<WorkmuxScrollbackCommandResult> {
	try {
		return await operation();
	} catch (error) {
		return {
			success: false,
			output: '',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function createWorkmuxScrollbackCommandExecutor({
	scrollTransport,
	onFailure,
	onDisposeExitFailure,
	onTrace,
}: WorkmuxScrollbackCommandExecutorInput): WorkmuxScrollbackCommandExecutor {
	let tail: Promise<unknown> = Promise.resolve();
	let closed = false;
	let disposed = false;
	let workGeneration = 0;
	let exitGeneration = 0;
	let pendingEnterOperations = 0;
	let pendingSerializedOperations = 0;
	const enterGenerations = new Map<
		number,
		{
			pending: number;
			cancellation?: {
				failurePolicy: WorkmuxScrollbackFailurePolicy;
				succeeded: boolean;
			};
		}
	>();
	let scrollDrainQueued = false;
	let pendingScrollBatch: {
		commands: WorkmuxScrollbackPageCommand[];
		generation: number;
		resolvers: ((value: boolean) => void)[];
	} | null = null;

	const notifyFailure = (
		message: string,
		context: WorkmuxScrollbackFailureContext,
	) => {
		try {
			onFailure(message, context);
		} catch {
			// Failure notification is best-effort; command promises must still settle.
		}
	};

	const notifyDisposeExitFailure = (message: string) => {
		try {
			onDisposeExitFailure?.(message);
		} catch {
			// Failure notification is best-effort; command promises must still settle.
		}
	};

	const trace = (event: WorkmuxScrollbackTraceEvent) => {
		try {
			onTrace?.(event);
		} catch {
			// Trace logging must not affect command execution.
		}
	};

	const clearPendingScrollBatches = () => {
		if (pendingScrollBatch) {
			trace({
				event: 'executor.batch.clear',
				commandCount: pendingScrollBatch.commands.length,
				pendingResolvers: pendingScrollBatch.resolvers.length,
				generation: pendingScrollBatch.generation,
			});
		}
		for (const resolve of pendingScrollBatch?.resolvers ?? []) {
			resolve(false);
		}
		pendingScrollBatch = null;
	};

	const enqueueSerialized = <T>(operation: () => Promise<T>) => {
		pendingSerializedOperations += 1;
		trace({
			event: 'executor.queue.enqueue',
			queueDepth: pendingSerializedOperations,
		});
		const next = tail.then(operation, operation).finally(() => {
			pendingSerializedOperations -= 1;
			trace({
				event: 'executor.queue.settle',
				queueDepth: pendingSerializedOperations,
			});
		});
		tail = next.catch(() => {});
		return next;
	};

	const isWorkActive = (operationGeneration: number) =>
		!disposed && operationGeneration === workGeneration;
	const isExitActive = (operationGeneration: number) =>
		!disposed && operationGeneration === exitGeneration;

	const runCommands = async ({
		operations,
		commandKind,
		operationGeneration,
		rollbackTargetName,
		operationOwner,
		durableExit = false,
		failurePolicy = 'notify',
	}: {
		operations: (() => Promise<WorkmuxScrollbackCommandResult>)[];
		commandKind: WorkmuxScrollbackCommandKind;
		operationGeneration: number;
		rollbackTargetName?: string;
		operationOwner?: ScrollbackOperationOwner;
		durableExit?: boolean;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => {
		const isActive = durableExit ? isExitActive : isWorkActive;
		if (disposed) return false;
		for (const [commandIndex, operation] of operations.entries()) {
			if (!isActive(operationGeneration)) return false;
			const startedAt = Date.now();
			trace({
				event: 'executor.command.start',
				commandKind: durableExit ? 'exit' : commandKind,
				commandIndex,
				commandCount: operations.length,
				durableExit,
				operationGeneration,
				queueDepth: pendingSerializedOperations,
			});
			const result = await runSingleOperation(operation);
			trace({
				event: 'executor.command.end',
				commandKind: durableExit ? 'exit' : commandKind,
				commandIndex,
				commandCount: operations.length,
				durableExit,
				operationGeneration,
				success: result.success,
				durationMs: Date.now() - startedAt,
				outputLength: result.output.length,
				error: result.error,
				queueDepth: pendingSerializedOperations,
			});
			if (!isActive(operationGeneration)) {
				const cancellation =
					enterGenerations.get(operationGeneration)?.cancellation;
				const canceledFailurePolicy =
					cancellation?.failurePolicy ?? failurePolicy;
				const failureMessage =
					formatWorkmuxScrollbackCommandFailureMessage(result);
				if (failureMessage && commandKind === 'enter' && !disposed) {
					if (cancellation) cancellation.succeeded = false;
					if (canceledFailurePolicy === 'notify') {
						notifyFailure(failureMessage, {
							commandKind: 'enter',
							operationOwner,
						});
					} else {
						notifyDisposeExitFailure(failureMessage);
					}
				}
				if (commandKind === 'enter' && result.success && rollbackTargetName) {
					const rollbackResult = await runSingleOperation(() =>
						scrollTransport.exit({ sessionName: rollbackTargetName }),
					);
					const rollbackFailureMessage =
						formatWorkmuxScrollbackCommandFailureMessage(rollbackResult);
					if (cancellation && rollbackFailureMessage) {
						cancellation.succeeded = false;
					}
					if (rollbackFailureMessage) {
						if (canceledFailurePolicy === 'notify') {
							notifyFailure(rollbackFailureMessage, {
								commandKind: 'exit',
								operationOwner,
							});
						} else {
							notifyDisposeExitFailure(rollbackFailureMessage);
						}
					}
				}
				return false;
			}
			const failureMessage =
				formatWorkmuxScrollbackCommandFailureMessage(result);
			if (!failureMessage) continue;
			clearPendingScrollBatches();
			if (failurePolicy === 'notify') {
				notifyFailure(failureMessage, {
					commandKind: durableExit ? 'exit' : commandKind,
					operationOwner,
				});
			} else {
				notifyDisposeExitFailure(failureMessage);
			}
			return false;
		}
		return true;
	};

	const runScrollCommands = ({
		commands,
		operationGeneration,
	}: {
		commands: WorkmuxScrollbackPageCommand[];
		operationGeneration: number;
	}) => {
		const operations = mergeWorkmuxScrollbackPageCommands(commands).map(
			(command) => () =>
				scrollTransport.move({
					sessionName: command.sessionName,
					direction: command.direction,
					unit: command.unit ?? 'page',
					count: command.count,
				}),
		);
		return runCommands({
			operations,
			commandKind: 'scroll',
			operationGeneration,
		});
	};

	const reset = (options?: {
		targetName?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => {
		const hadPendingEnter = pendingEnterOperations > 0;
		const hadSerializedWork = pendingSerializedOperations > 0;
		const canceledGeneration = workGeneration;
		const enterGeneration = enterGenerations.get(canceledGeneration);
		const cancellation = enterGeneration
			? (enterGeneration.cancellation ??= {
					failurePolicy: options?.failurePolicy ?? 'notify',
					succeeded: true,
				})
			: undefined;
		workGeneration += 1;
		clearPendingScrollBatches();
		const targetName = options?.targetName;
		if (disposed) return null;
		if (!targetName) {
			if (!hadPendingEnter || !hadSerializedWork) return null;
			return enqueueSerialized(async () => cancellation?.succeeded ?? true);
		}

		exitGeneration += 1;
		const operationGeneration = exitGeneration;
		return enqueueSerialized(() =>
			runCommands({
				operations: [() => scrollTransport.exit({ sessionName: targetName })],
				commandKind: 'scroll',
				operationGeneration,
				durableExit: true,
				failurePolicy: options?.failurePolicy,
			}),
		);
	};

	return {
		runEnterCommand: (
			targetName: string,
			operationOwner?: ScrollbackOperationOwner,
		) =>
			closed || disposed
				? Promise.resolve(false)
				: (() => {
						pendingEnterOperations += 1;
						const operationGeneration = workGeneration;
						const enterGeneration = enterGenerations.get(
							operationGeneration,
						) ?? {
							pending: 0,
						};
						enterGeneration.pending += 1;
						enterGenerations.set(operationGeneration, enterGeneration);
						return enqueueSerialized(async () => {
							try {
								return await runCommands({
									operations: [
										() => scrollTransport.enter({ sessionName: targetName }),
									],
									commandKind: 'enter',
									operationGeneration,
									rollbackTargetName: targetName,
									operationOwner,
								});
							} finally {
								pendingEnterOperations -= 1;
								enterGeneration.pending -= 1;
								if (enterGeneration.pending === 0) {
									enterGenerations.delete(operationGeneration);
								}
							}
						});
					})(),
		enqueueScrollBatch: (commands: WorkmuxScrollbackPageCommand[]) => {
			if (closed || disposed) return Promise.resolve(false);
			if (commands.length === 0) return Promise.resolve(true);
			const promise = new Promise<boolean>((resolve) => {
				if (
					pendingScrollBatch &&
					pendingScrollBatch.generation === workGeneration
				) {
					const previousCommandCount = pendingScrollBatch.commands.length;
					pendingScrollBatch.commands =
						coalesceWorkmuxScrollbackPendingPageCommands([
							...pendingScrollBatch.commands,
							...commands,
						]);
					pendingScrollBatch.resolvers.push(resolve);
					trace({
						event: 'executor.batch.coalesce',
						inputCommandCount: commands.length,
						previousCommandCount,
						commandCount: pendingScrollBatch.commands.length,
						pendingResolvers: pendingScrollBatch.resolvers.length,
						generation: pendingScrollBatch.generation,
					});
					return;
				}
				clearPendingScrollBatches();
				pendingScrollBatch = {
					commands: mergeWorkmuxScrollbackPageCommands(commands),
					generation: workGeneration,
					resolvers: [resolve],
				};
				trace({
					event: 'executor.batch.enqueue',
					inputCommandCount: commands.length,
					commandCount: pendingScrollBatch.commands.length,
					pendingResolvers: pendingScrollBatch.resolvers.length,
					generation: pendingScrollBatch.generation,
				});
			});

			if (!scrollDrainQueued) {
				scrollDrainQueued = true;
				trace({
					event: 'executor.drain.schedule',
					queueDepth: pendingSerializedOperations,
				});
				void enqueueSerialized(async () => {
					scrollDrainQueued = false;
					trace({
						event: 'executor.drain.start',
						queueDepth: pendingSerializedOperations,
					});
					if (disposed) {
						clearPendingScrollBatches();
						return false;
					}
					const batch = pendingScrollBatch;
					pendingScrollBatch = null;
					if (!batch) return true;
					let success = false;
					try {
						success = await runScrollCommands({
							commands: batch.commands,
							operationGeneration: batch.generation,
						});
					} finally {
						trace({
							event: 'executor.drain.end',
							success,
							commandCount: batch.commands.length,
							pendingResolvers: batch.resolvers.length,
							generation: batch.generation,
							queueDepth: pendingSerializedOperations,
						});
						for (const resolve of batch.resolvers) {
							resolve(success);
						}
					}
					return success;
				});
			}

			return promise;
		},
		reset,
		dispose: (options?: { targetName?: string }) => {
			closed = true;
			const exit = reset({
				targetName: options?.targetName,
				failurePolicy: 'suppress',
			});
			if (exit) {
				void exit.finally(() => {
					disposed = true;
				});
			} else {
				disposed = true;
			}
			return exit;
		},
	};
}
