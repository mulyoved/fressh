import { type WorkmuxScrollbackCommandExecutor } from '../workmux-scrollback-executor';
import { type ShellActivitySnapshot } from './activity-core';
import {
	type ShellScrollbackContext,
	type ShellScrollbackLogger,
} from './scrollback-core';

export type ScrollbackCleanupOwnership = Readonly<{
	targetOwnershipRevision: number;
	remoteCopyModeGeneration: number;
	targetKey: ShellScrollbackContext['targetKey'];
	targetName: string;
}>;

export type ScrollbackEnterRequestToken = Readonly<{
	activityGeneration: number;
	context: ShellScrollbackContext;
	executor: WorkmuxScrollbackCommandExecutor;
	instanceId: string;
	remoteCopyModeGeneration: number;
	requestGeneration: number;
	targetOwnershipRevision: number;
}>;

type CurrentState = Readonly<{
	context: ShellScrollbackContext | null;
	disposed: boolean;
	executor: WorkmuxScrollbackCommandExecutor | null;
	remoteCopyModeGeneration: number;
	requestGeneration: number;
	runtimeInstanceId: string | null;
	targetOwnershipRevision: number;
}>;

export function createScrollbackEntryCoordinator({
	getCurrentState,
	isTerminalInstanceCurrent,
	registerRollbackCleanup,
	remoteCopyModeActive,
	remoteCopyModeGeneration,
	warn,
}: {
	getCurrentState(): CurrentState;
	isTerminalInstanceCurrent(
		context: ShellScrollbackContext,
		instanceId: string,
	): boolean;
	registerRollbackCleanup(input: {
		cleanup: Promise<boolean>;
		logger: ShellScrollbackLogger;
		ownership: ScrollbackCleanupOwnership;
	}): void;
	remoteCopyModeActive: { current: boolean };
	remoteCopyModeGeneration: { current: number };
	warn(logger: ShellScrollbackLogger, message: string, error?: unknown): void;
}) {
	const attributedRequests = new WeakSet<object>();
	const pendingRollbacks = new WeakMap<
		WorkmuxScrollbackCommandExecutor,
		Readonly<{
			cleanup: Promise<boolean>;
			targetKey: ShellScrollbackContext['targetKey'];
			targetName: string;
			targetOwnershipRevision: number;
		}>
	>();

	const isInternallyCurrent = (token: ScrollbackEnterRequestToken): boolean => {
		const current = getCurrentState();
		return (
			!current.disposed &&
			current.requestGeneration === token.requestGeneration &&
			current.context === token.context &&
			current.executor === token.executor &&
			current.runtimeInstanceId === token.instanceId &&
			current.targetOwnershipRevision === token.targetOwnershipRevision
		);
	};

	const validate = (token: ScrollbackEnterRequestToken): boolean => {
		if (!isInternallyCurrent(token)) return false;
		if (!isTerminalInstanceCurrent(token.context, token.instanceId))
			return false;
		if (!isInternallyCurrent(token)) return false;
		let activity: ShellActivitySnapshot;
		try {
			activity = token.context.getActivitySnapshot();
		} catch (error) {
			warn(token.context.logger, 'Scrollback activity check failed', error);
			return false;
		}
		return (
			isInternallyCurrent(token) &&
			activity.generation === token.activityGeneration &&
			activity.interactive &&
			activity.appActive
		);
	};

	const rollback = (token: ScrollbackEnterRequestToken) => {
		const existing = pendingRollbacks.get(token.executor);
		if (
			existing?.targetOwnershipRevision === token.targetOwnershipRevision &&
			existing.targetKey === token.context.targetKey &&
			existing.targetName === token.context.targetName
		) {
			return existing.cleanup;
		}
		const current = getCurrentState();
		const semanticTargetCurrent =
			!current.disposed &&
			current.targetOwnershipRevision === token.targetOwnershipRevision &&
			current.context?.targetKey === token.context.targetKey &&
			current.context.targetName === token.context.targetName;
		const acquiredDuringRollback =
			semanticTargetCurrent && !remoteCopyModeActive.current;
		if (acquiredDuringRollback) {
			remoteCopyModeGeneration.current += 1;
			remoteCopyModeActive.current = true;
		}
		const ownership: ScrollbackCleanupOwnership = {
			targetOwnershipRevision: token.targetOwnershipRevision,
			remoteCopyModeGeneration:
				acquiredDuringRollback || isInternallyCurrent(token)
					? remoteCopyModeGeneration.current
					: token.remoteCopyModeGeneration,
			targetKey: token.context.targetKey,
			targetName: token.context.targetName,
		};
		let cleanup: Promise<boolean> | null = null;
		try {
			cleanup = token.executor.reset({
				targetName: token.context.targetName,
				failurePolicy: 'suppress',
			});
		} catch (error) {
			warn(
				token.context.logger,
				'Workmux scrollback enter rollback failed',
				error,
			);
			return null;
		}
		if (!cleanup) return null;
		const pending = {
			cleanup,
			targetKey: token.context.targetKey,
			targetName: token.context.targetName,
			targetOwnershipRevision: token.targetOwnershipRevision,
		};
		pendingRollbacks.set(token.executor, pending);
		const clearIfCurrent = () => {
			if (pendingRollbacks.get(token.executor) === pending) {
				pendingRollbacks.delete(token.executor);
			}
		};
		void cleanup.then(clearIfCurrent, clearIfCurrent);
		registerRollbackCleanup({
			cleanup,
			logger: token.context.logger,
			ownership,
		});
		return cleanup;
	};

	return {
		isAttributedOwnerCurrent(owner: unknown): boolean | null {
			if (
				typeof owner !== 'object' ||
				owner === null ||
				!attributedRequests.has(owner)
			) {
				return null;
			}
			return isInternallyCurrent(owner as ScrollbackEnterRequestToken);
		},
		isInternallyCurrent,
		release(token: ScrollbackEnterRequestToken): void {
			attributedRequests.delete(token);
		},
		rollback,
		track(token: ScrollbackEnterRequestToken): void {
			attributedRequests.add(token);
		},
		validate,
	};
}
