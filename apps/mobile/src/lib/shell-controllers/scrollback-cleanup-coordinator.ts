import {
	registerTmuxScrollbackRemoteCopyModeExitCleanup,
	resetTmuxScrollbackRuntimeState,
} from '../tmux-scrollback';
import { type TmuxScrollbackLineAccumulator } from '../workmux-scrollback-batch';
import { type WorkmuxScrollbackCommandExecutor } from '../workmux-scrollback-executor';
import { type WorkmuxScrollbackLiveInputCleanupBarrier } from '../workmux-scrollback-live-input';
import {
	type ScrollbackCleanupOwnership,
	type ShellScrollbackContext,
	type ShellScrollbackLogger,
} from './scrollback-contracts';
import {
	type ScrollbackRemoteCopyModeOwner,
	type ScrollbackRemoteCopyModeToken,
} from './scrollback-remote-copy-mode-owner';

type ResetOperationKey = Readonly<{
	failurePolicy: 'notify' | 'suppress';
	invocationRevision: number;
	remoteCopyModeGeneration: number;
	requiresDurableTargetExit: boolean;
	targetOwnershipRevision: number;
}>;

export type ScrollbackResetResult = Readonly<{
	cleanup: Promise<boolean> | null;
	remoteCopyModeGeneration: number;
	targetOwnershipRevision: number;
}>;

export function createScrollbackCleanupCoordinator({
	cleanupBarrier,
	getCurrentState,
	lineAccumulator,
	remoteCopyMode,
	warn,
}: {
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	getCurrentState(): {
		context: ShellScrollbackContext | null;
		disposed: boolean;
		executor: WorkmuxScrollbackCommandExecutor | null;
		targetOwnershipRevision: number;
	};
	lineAccumulator: TmuxScrollbackLineAccumulator;
	remoteCopyMode: ScrollbackRemoteCopyModeOwner;
	warn(
		logger: ShellScrollbackLogger | undefined,
		message: string,
		error?: unknown,
	): void;
}) {
	type PendingResetOperation = ResetOperationKey &
		Readonly<{ cleanup: Promise<boolean> }>;
	const pendingResetOperations = new WeakMap<
		WorkmuxScrollbackCommandExecutor,
		PendingResetOperation
	>();
	let nextResetInvocationRevision = 0;

	const captureOwnership = (
		context: ShellScrollbackContext,
	): ScrollbackCleanupOwnership => {
		const current = getCurrentState();
		return {
			targetOwnershipRevision: current.targetOwnershipRevision,
			remoteCopyModeGeneration: remoteCopyMode.generation(),
			targetKey: context.targetKey,
			targetName: context.targetName,
		};
	};

	const isFailureCurrent = (ownership: ScrollbackCleanupOwnership): boolean => {
		const current = getCurrentState();
		return (
			!current.disposed &&
			current.targetOwnershipRevision === ownership.targetOwnershipRevision &&
			current.context?.targetKey === ownership.targetKey &&
			current.context.targetName === ownership.targetName
		);
	};

	const isSuccessCurrent = (ownership: ScrollbackCleanupOwnership): boolean =>
		isFailureCurrent(ownership) &&
		remoteCopyMode.generation() === ownership.remoteCopyModeGeneration;

	const register = ({
		cleanup,
		failureMessage,
		logger,
		ownership,
		remoteWasActive,
		restoreRemoteOnFailure,
		currentAfterDispose = false,
		clearRemoteOnSuccess = true,
		reportResolvedFalse = true,
	}: {
		cleanup: Promise<boolean> | null | undefined;
		failureMessage: string;
		logger: ShellScrollbackLogger | undefined;
		ownership: ScrollbackCleanupOwnership | null;
		remoteWasActive: boolean;
		restoreRemoteOnFailure: boolean;
		currentAfterDispose?: boolean;
		clearRemoteOnSuccess?: boolean;
		reportResolvedFalse?: boolean;
	}): Promise<boolean> | null => {
		if (!cleanup) return null;
		const token: ScrollbackRemoteCopyModeToken = Object.freeze({
			generation:
				ownership?.remoteCopyModeGeneration ?? remoteCopyMode.generation(),
		});
		const registerWithBarrier = (
			barrier: WorkmuxScrollbackLiveInputCleanupBarrier,
		) =>
			registerTmuxScrollbackRemoteCopyModeExitCleanup({
				barrier,
				cleanup,
				remoteCopyMode: {
					isOwned: remoteCopyMode.isOwned,
					settle: (owned) => {
						if (owned && restoreRemoteOnFailure) remoteCopyMode.restore();
						else remoteCopyMode.settle(token, owned);
					},
				},
				remoteCopyModeWasActive: remoteWasActive,
				freshness: currentAfterDispose
					? { kind: 'always' }
					: {
							kind: 'predicates',
							isSuccessCurrent: () =>
								ownership !== null && isSuccessCurrent(ownership),
							isFailureCurrent: () =>
								ownership !== null && isFailureCurrent(ownership),
						},
				failureOwnership: restoreRemoteOnFailure
					? { kind: 'restore' }
					: { kind: 'ignore' },
				successOwnership: clearRemoteOnSuccess ? 'clear' : 'preserve',
				failureReporting: {
					kind: 'report',
					report: (error, failure) => {
						if (failure.kind === 'rejected' || reportResolvedFalse) {
							const currentLogger =
								ownership !== null && isFailureCurrent(ownership)
									? getCurrentState().context?.logger
									: logger;
							warn(currentLogger, failureMessage, error);
						}
					},
				},
			});
		try {
			return registerWithBarrier(cleanupBarrier);
		} catch (error) {
			warn(logger, failureMessage, error);
			if (
				restoreRemoteOnFailure &&
				(currentAfterDispose ||
					(ownership !== null && isFailureCurrent(ownership)))
			) {
				remoteCopyMode.restore();
			}
			return registerWithBarrier({
				current: () => null,
				track: (value) => value ?? null,
			});
		}
	};

	const reset = ({
		failurePolicy,
		ownerContext,
		remoteWasActive,
	}: {
		failurePolicy: 'notify' | 'suppress';
		ownerContext: ShellScrollbackContext;
		remoteWasActive: boolean;
	}): ScrollbackResetResult => {
		const current = getCurrentState();
		const executor = current.executor;
		if (!executor)
			return {
				cleanup: null,
				remoteCopyModeGeneration: remoteCopyMode.generation(),
				targetOwnershipRevision: current.targetOwnershipRevision,
			};
		const pending = pendingResetOperations.get(executor);
		if (
			pending?.targetOwnershipRevision === current.targetOwnershipRevision &&
			pending.remoteCopyModeGeneration === remoteCopyMode.generation() &&
			pending.requiresDurableTargetExit === remoteWasActive &&
			pending.failurePolicy === failurePolicy
		) {
			return {
				cleanup: pending.cleanup,
				remoteCopyModeGeneration: pending.remoteCopyModeGeneration,
				targetOwnershipRevision: pending.targetOwnershipRevision,
			};
		}
		const remoteCopyModeToken = remoteCopyMode.transition();
		const ownership = captureOwnership(ownerContext);
		const operationKey: ResetOperationKey = {
			failurePolicy,
			invocationRevision: ++nextResetInvocationRevision,
			remoteCopyModeGeneration: remoteCopyModeToken.generation,
			requiresDurableTargetExit: remoteWasActive,
			targetOwnershipRevision: current.targetOwnershipRevision,
		};
		let cleanup: Promise<boolean> | null = null;
		try {
			cleanup = resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor: executor,
				targetName: remoteWasActive ? ownerContext.targetName : undefined,
				failurePolicy,
			});
		} catch (error) {
			warn(ownerContext.logger, 'Workmux scrollback reset failed', error);
			if (remoteWasActive && isFailureCurrent(ownership)) {
				remoteCopyMode.settle(remoteCopyModeToken, true);
			}
			return {
				cleanup: null,
				remoteCopyModeGeneration: operationKey.remoteCopyModeGeneration,
				targetOwnershipRevision: operationKey.targetOwnershipRevision,
			};
		}
		if (
			cleanup &&
			operationKey.targetOwnershipRevision ===
				getCurrentState().targetOwnershipRevision &&
			operationKey.remoteCopyModeGeneration === remoteCopyMode.generation() &&
			getCurrentState().executor === executor
		) {
			const existing = pendingResetOperations.get(executor);
			if (
				!existing ||
				existing.invocationRevision <= operationKey.invocationRevision
			) {
				const recorded = { ...operationKey, cleanup };
				pendingResetOperations.set(executor, recorded);
				const clearIfCurrent = () => {
					if (pendingResetOperations.get(executor) === recorded) {
						pendingResetOperations.delete(executor);
					}
				};
				void cleanup.then(clearIfCurrent, clearIfCurrent);
			}
		}
		void register({
			cleanup,
			failureMessage: 'Workmux scrollback reset failed',
			logger: ownerContext.logger,
			ownership,
			remoteWasActive,
			restoreRemoteOnFailure: remoteWasActive,
			reportResolvedFalse: false,
		});
		return {
			cleanup,
			remoteCopyModeGeneration: operationKey.remoteCopyModeGeneration,
			targetOwnershipRevision: operationKey.targetOwnershipRevision,
		};
	};

	return { captureOwnership, isFailureCurrent, register, reset };
}
