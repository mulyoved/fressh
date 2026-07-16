import { type WorkmuxScrollbackCommandExecutor } from '../workmux-scrollback-executor';
import { type ScrollbackResetResult } from './scrollback-cleanup-coordinator';
import {
	type ScrollbackRequestAuthority,
	type ShellScrollbackContext,
	type ShellScrollbackState,
} from './scrollback-contracts';
import {
	type ScrollbackLiveInputAuthority,
	type ScrollbackLiveInputCleanupStart,
} from './scrollback-live-input-coordinator';

type ClearAuthority =
	ScrollbackRequestAuthority<WorkmuxScrollbackCommandExecutor> & {
		isCurrent(): boolean;
	};

export function createScrollbackClearCoordinator({
	getCurrentState,
	reset,
	runClearLocal,
}: {
	getCurrentState(): {
		context: ShellScrollbackContext | null;
		disposed: boolean;
		executor: WorkmuxScrollbackCommandExecutor | null;
		localModeRevision: number;
		remoteCopyModeActive: boolean;
		remoteCopyModeGeneration: number;
		runtimeInstanceId: string | null;
		snapshot: ShellScrollbackState;
		targetOwnershipRevision: number;
	};
	reset(input: {
		failurePolicy: 'notify' | 'suppress';
		ownerContext: ShellScrollbackContext;
		remoteWasActive: boolean;
	}): ScrollbackResetResult;
	runClearLocal(
		context: ShellScrollbackContext,
		authority: ClearAuthority,
	): void;
}) {
	const captureAuthority = (
		ownerContext: ShellScrollbackContext,
	): ClearAuthority | null => {
		const current = getCurrentState();
		const ownerExecutor = current.executor;
		const instanceId = current.runtimeInstanceId;
		const ownerTargetOwnershipRevision = current.targetOwnershipRevision;
		if (
			current.disposed ||
			current.context !== ownerContext ||
			ownerExecutor === null
		)
			return null;
		return {
			context: ownerContext,
			executor: ownerExecutor,
			instanceId,
			targetOwnershipRevision: ownerTargetOwnershipRevision,
			isCurrent: () => {
				const latest = getCurrentState();
				return (
					!latest.disposed &&
					latest.context === ownerContext &&
					latest.executor === ownerExecutor &&
					latest.runtimeInstanceId === instanceId &&
					latest.targetOwnershipRevision === ownerTargetOwnershipRevision
				);
			},
		};
	};

	const captureCurrentAuthority = (): ScrollbackLiveInputAuthority => {
		const current = getCurrentState();
		return {
			localModeRevision: current.localModeRevision,
			localModeSnapshot: {
				active: current.snapshot.active,
				phase: current.snapshot.phase,
			},
			remoteCopyModeGeneration: current.remoteCopyModeGeneration,
			targetOwnershipRevision: current.targetOwnershipRevision,
		};
	};

	const clearLocal = (ownerContext: ShellScrollbackContext): void => {
		const authority = captureAuthority(ownerContext);
		if (authority) runClearLocal(ownerContext, authority);
	};

	const start = (
		ownerContext: ShellScrollbackContext,
		failurePolicy: 'notify' | 'suppress' = 'notify',
		providedAuthority?: ClearAuthority | null,
	): ScrollbackLiveInputCleanupStart | null => {
		const authority = providedAuthority ?? captureAuthority(ownerContext);
		if (!authority) return null;
		const before = getCurrentState();
		const ownsLocalNormalization =
			before.snapshot.active || before.snapshot.phase !== 'active';
		const localAuthority = {
			localModeRevision:
				before.localModeRevision + (ownsLocalNormalization ? 1 : 0),
			localModeSnapshot: ownsLocalNormalization
				? { active: false, phase: 'active' as const }
				: {
						active: before.snapshot.active,
						phase: before.snapshot.phase,
					},
		};
		runClearLocal(ownerContext, authority);
		if (!authority.isCurrent())
			return {
				authority: {
					...localAuthority,
					remoteCopyModeGeneration: getCurrentState().remoteCopyModeGeneration,
					targetOwnershipRevision: authority.targetOwnershipRevision,
				},
				cleanup: null,
			};
		const resetResult = reset({
			failurePolicy,
			ownerContext,
			remoteWasActive: getCurrentState().remoteCopyModeActive,
		});
		return {
			authority: {
				...localAuthority,
				remoteCopyModeGeneration: resetResult.remoteCopyModeGeneration,
				targetOwnershipRevision: resetResult.targetOwnershipRevision,
			},
			cleanup: resetResult.cleanup,
		};
	};

	const clear = (
		ownerContext: ShellScrollbackContext,
		failurePolicy: 'notify' | 'suppress' = 'notify',
		providedAuthority?: ClearAuthority | null,
	): Promise<boolean> | null =>
		start(ownerContext, failurePolicy, providedAuthority)?.cleanup ?? null;

	const startCurrent = (): ScrollbackLiveInputCleanupStart => {
		const current = getCurrentState();
		const started = current.context ? start(current.context) : null;
		return started ?? { authority: captureCurrentAuthority(), cleanup: null };
	};

	return { captureAuthority, clear, clearLocal, startCurrent };
}
