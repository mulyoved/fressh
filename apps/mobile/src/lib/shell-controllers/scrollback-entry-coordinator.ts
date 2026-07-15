import { type ScrollTraceSink } from '../scroll-trace';
import { handleTmuxScrollbackEnterRequested } from '../tmux-scrollback';
import { type WorkmuxScrollbackCommandExecutor } from '../workmux-scrollback-executor';
import { type ShellActivitySnapshot } from './activity-core';
import {
	type ScrollbackCleanupOwnership,
	type ScrollbackEnterRequestedEvent,
	type ScrollbackRequestAuthority,
	type ShellScrollbackContext,
	type ShellScrollbackLogger,
} from './scrollback-contracts';
import { createScrollbackOperationOwnerRegistry } from './scrollback-operation-owner';

export type ScrollbackEnterRequestToken = ScrollbackRequestAuthority<
	WorkmuxScrollbackCommandExecutor,
	string
> &
	Readonly<{
		activityGeneration: number;
		remoteCopyModeGeneration: number;
		requestGeneration: number;
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
	clearLocalState,
	isTerminalInstanceCurrent,
	registerRollbackCleanup,
	remoteCopyModeActive,
	remoteCopyModeGeneration,
	reserveRequestGeneration,
	trace,
	warn,
}: {
	clearLocalState(context: ShellScrollbackContext): void;
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
	reserveRequestGeneration(): number;
	trace(
		context: ShellScrollbackContext,
		event: Parameters<ScrollTraceSink>[0],
	): void;
	warn(logger: ShellScrollbackLogger, message: string, error?: unknown): void;
}) {
	const attributedRequests =
		createScrollbackOperationOwnerRegistry<ScrollbackEnterRequestToken>();
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
			activity = token.context.activity.getSnapshot();
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

	const run = async (event: ScrollbackEnterRequestedEvent): Promise<void> => {
		const requestGeneration = reserveRequestGeneration();
		const initial = getCurrentState();
		const context = initial.context;
		const executor = initial.executor;
		if (
			initial.disposed ||
			context === null ||
			executor === null ||
			initial.runtimeInstanceId !== event.instanceId
		)
			return;
		const baseCurrent = () => {
			const current = getCurrentState();
			return (
				!current.disposed &&
				current.requestGeneration === requestGeneration &&
				current.context === context &&
				current.executor === executor &&
				current.runtimeInstanceId === event.instanceId &&
				current.targetOwnershipRevision === initial.targetOwnershipRevision
			);
		};
		if (!isTerminalInstanceCurrent(context, event.instanceId) || !baseCurrent())
			return;
		let activity: ShellActivitySnapshot;
		try {
			activity = context.activity.getSnapshot();
		} catch (error) {
			warn(context.logger, 'Scrollback activity check failed', error);
			return;
		}
		if (!baseCurrent()) return;
		const token: ScrollbackEnterRequestToken = Object.freeze({
			activityGeneration: activity.generation,
			context,
			executor,
			instanceId: event.instanceId,
			remoteCopyModeGeneration: remoteCopyModeGeneration.current,
			requestGeneration,
			targetOwnershipRevision: initial.targetOwnershipRevision,
		});
		if (!activity.interactive || !activity.appActive) {
			if (isInternallyCurrent(token)) clearLocalState(context);
			return;
		}
		if (!validate(token)) return;
		let selectionModeEnabled: boolean;
		try {
			selectionModeEnabled = context.terminalView.getSelectionModeEnabled();
		} catch (error) {
			warn(context.logger, 'Scrollback selection check failed', error);
			return;
		}
		if (!validate(token)) return;
		const operationOwner = attributedRequests.create(token);
		try {
			await handleTmuxScrollbackEnterRequested({
				event,
				isAppActive: activity.appActive,
				currentInstanceId: event.instanceId,
				shellAvailable: context.shellAvailable,
				selectionModeEnabled,
				tmuxEnabled: context.tmuxEnabled,
				connectionAvailable: context.connectionAvailable,
				targetName: context.targetName,
				commandExecutor: executor,
				remoteCopyModeActiveRef: remoteCopyModeActive,
				remoteCopyModeGenerationRef: remoteCopyModeGeneration,
				clearLocalScrollbackUiState: () => clearLocalState(context),
				sendScrollbackEnterAck: (requestId, instanceId) =>
					context.terminalView.sendScrollbackEnterAck(requestId, instanceId),
				isRequestCurrent: () => validate(token),
				operationOwner,
				onEnterCommandSettled: () => attributedRequests.release(operationOwner),
				rollbackEnteredCopyMode: () => rollback(token),
				trace: (traceEvent) => trace(context, traceEvent),
			});
		} catch (error) {
			warn(context.logger, 'Workmux scrollback enter failed', error);
			if (validate(token)) clearLocalState(context);
		} finally {
			attributedRequests.release(operationOwner);
		}
	};

	return {
		isAttributedOwnerCurrent(
			owner: Parameters<typeof attributedRequests.resolve>[0],
		): boolean | null {
			const token = attributedRequests.resolve(owner);
			return token ? isInternallyCurrent(token) : null;
		},
		isInternallyCurrent,
		release(owner: Parameters<typeof attributedRequests.release>[0]): void {
			attributedRequests.release(owner);
		},
		rollback,
		run,
		track(token: ScrollbackEnterRequestToken) {
			return attributedRequests.create(token);
		},
		validate,
	};
}
