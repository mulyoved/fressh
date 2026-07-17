import {
	createScrollbackLiveInputCoordinator,
	type ScrollbackLiveInputAuthority,
} from '../../src/lib/shell-controllers/scrollback-live-input-coordinator';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';
import {
	type TerminalInputLease,
	type TerminalRuntimeKey,
} from '../../src/lib/shell-controllers/terminal-transport';

const targetKey = createShellTargetKey('transport' as never, 'main');

export function createLiveInputFixture() {
	const sent: number[][][] = [];
	const events: string[] = [];
	const warnings: string[] = [];
	let currentCleanup: Promise<boolean> | null = null;
	let startedCleanup: Promise<boolean> | null = null;
	let generation = 1;
	let remoteGeneration = 1;
	let remoteActive = false;
	let scrollbackActive = false;
	let scrollbackPhase: 'dragging' | 'active' = 'active';
	let localModeRevision = 0;
	let targetRevision = 1;
	let disposed = false;
	let instanceId: string | null = 'instance-1';
	let runtimeKey: TerminalRuntimeKey | null = 'runtime-1' as TerminalRuntimeKey;
	let activity = {
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 3,
	};
	const lease = {
		runtimeKey: 'runtime-1',
		writerGeneration: 1,
	} as unknown as TerminalInputLease;
	let leaseCurrent = true;
	let sendError: unknown = null;
	let inactiveClearCount = 0;
	let frozenStartAuthority: ScrollbackLiveInputAuthority | null = null;
	let currentCleanupGetter = () => currentCleanup;
	let startCleanup = () => startedCleanup;
	const context = {
		targetKey,
		targetName: 'main',
		activity: {
			getSnapshot: () => activity,
			subscribe: () => () => {},
		},
		terminalTransport: {
			captureLease: () => lease,
			isLeaseCurrent: () => leaseCurrent,
			sendBatch: async (
				_lease: never,
				segments: readonly Uint8Array<ArrayBufferLike>[],
				options?: {
					interSegmentDelayMs?: number;
					isCurrent?: () => boolean;
				},
			) => {
				events.push('send');
				if (options?.isCurrent?.() === false) return;
				sent.push(segments.map((segment) => Array.from(segment)));
				if (sendError) throw sendError;
			},
		},
		terminalView: {
			getRuntimeKey: () => runtimeKey,
			getRuntimeInstanceId: () => instanceId,
		},
		logger: { warn: (message: string) => warnings.push(message) },
		getErrorMessage: (error: unknown) =>
			error instanceof Error ? error.message : String(error),
	};
	const coordinator = createScrollbackLiveInputCoordinator({
		advanceFreshness: () => {
			generation += 1;
		},
		clearInactive: () => {
			inactiveClearCount += 1;
			return startedCleanup ?? currentCleanup;
		},
		getCurrentState: () => ({
			context,
			disposed,
			liveInputGeneration: generation,
			localModeRevision,
			remoteCopyModeActive: remoteActive,
			remoteCopyModeGeneration: remoteGeneration,
			runtimeInstanceId: instanceId,
			scrollbackActive,
			scrollbackPhase,
			targetOwnershipRevision: targetRevision,
		}),
		getCurrentCleanup: () => currentCleanupGetter(),
		startCleanup: () => {
			const cleanup = startCleanup();
			return {
				authority:
					frozenStartAuthority ??
					({
						localModeRevision,
						localModeSnapshot: {
							active: scrollbackActive,
							phase: scrollbackPhase,
						},
						remoteCopyModeGeneration: remoteGeneration,
						targetOwnershipRevision: targetRevision,
					} satisfies ScrollbackLiveInputAuthority),
				cleanup,
			};
		},
		scrollbackExitDelayMs: 10,
		scrollbackExitKeyPayload: new Uint8Array([0x71]),
	});
	return {
		activity: (next: Partial<typeof activity>) =>
			(activity = { ...activity, ...next }),
		context,
		coordinator,
		dispose: () => (disposed = true),
		events,
		invalidate: () => (generation += 1),
		inactiveClearCount: () => inactiveClearCount,
		freezeStartAuthority: () => {
			frozenStartAuthority = {
				localModeRevision,
				localModeSnapshot: {
					active: scrollbackActive,
					phase: scrollbackPhase,
				},
				remoteCopyModeGeneration: remoteGeneration,
				targetOwnershipRevision: targetRevision,
			};
		},
		lease: (current: boolean) => (leaseCurrent = current),
		liveGeneration: () => generation,
		remote: (active: boolean) => {
			remoteActive = active;
			remoteGeneration += 1;
		},
		settleRemoteCleanup: () => {
			remoteActive = false;
		},
		replaceRuntime: (next: string) => {
			instanceId = next;
			runtimeKey = `runtime-${next}` as TerminalRuntimeKey;
			generation += 1;
		},
		replaceTarget: () => (targetRevision += 1),
		sent,
		setCleanup: (value: Promise<boolean> | null) => {
			currentCleanup = value;
		},
		setCurrentCleanupGetter: (getter: () => Promise<boolean> | null) => {
			currentCleanupGetter = getter;
		},
		setStartCleanup: (start: () => Promise<boolean> | null) => {
			startCleanup = start;
		},
		setStartedCleanup: (value: Promise<boolean> | null) => {
			startedCleanup = value;
		},
		setSendError: (error: unknown) => (sendError = error),
		setScrollbackActive: (active: boolean) => {
			if (scrollbackActive !== active) localModeRevision += 1;
			scrollbackActive = active;
		},
		setScrollbackPhase: (phase: typeof scrollbackPhase) => {
			if (scrollbackPhase !== phase) localModeRevision += 1;
			scrollbackPhase = phase;
		},
		warnings,
	};
}
