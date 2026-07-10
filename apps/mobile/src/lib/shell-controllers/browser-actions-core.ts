import {
	resolveBrowserActionsPaneContext,
	resolveBrowserActionsPanePath,
	resolveBrowserActionsWorkspace,
	runBrowserActionsDiffityShareWithContext,
	type BrowserActionsWorkspace,
} from '../browser-actions-controller-actions';
import { cleanupBrowserActionRequests } from '../browser-actions-request-cleanup';
import {
	runDetectedOpenControllerRequest,
	runGuardedDetectedOpenPickerSelectionRequest,
	type DetectedOpenCandidate,
} from '../detected-open-actions';
import {
	parseHostBrowserUrlInput,
	type HostBrowserOpenMode,
	type HostBrowserUrlSlot,
	type TmuxPaneContext,
} from '../host-browser-actions';
import { runHostDiffityOpenRequest } from '../host-diffity-open-request';
import { type GitHubRepositoryTarget } from '../repo-feature-request';
import { type RequestIdHandle } from '../request-id';
import {
	createDiffBrowserActionErrorInput,
	type BrowserActionErrorInput,
} from '../shell-browser-action-error-inputs';
import {
	resolveGitHubRepositoryContext,
	runGitHubTargetOpenRequest,
} from '../shell-github-target-request';
import {
	runHostUrlReadRequest,
	type HostUrlReadModalState,
} from '../shell-host-url-read-request';
import { runHostUrlSubmitRequest } from '../shell-host-url-submit-request';
import {
	createControllerPublisher,
	type ControllerCore,
} from './controller-core';
import { type ShellTargetKey } from './source-keys';

export type HostUrlModalMode = 'edit' | 'open-missing';

export type HostUrlModalStateValue = {
	mode: HostUrlModalMode;
	slot: HostBrowserUrlSlot;
	panePath: string;
	initialValue: string;
};

export type DetectedOpenPickerState = {
	context: TmuxPaneContext;
	candidates: DetectedOpenCandidate[];
};

export type BrowserActionsState = {
	open: boolean;
	hostUrl: HostUrlModalStateValue | null;
	hostUrlSubmitting: boolean;
	hostUrlError: string | null;
	detectedOpenPicker: DetectedOpenPickerState | null;
};

export type BrowserActionsControllerCore =
	ControllerCore<BrowserActionsState> & {
		setSourceKey(sourceKey: ShellTargetKey): void;
		open(): boolean;
		close(): void;
		openGitHubTarget(target: GitHubRepositoryTarget): Promise<void>;
		openDiffity(): Promise<void>;
		openDetected(mode: HostBrowserOpenMode): boolean;
		selectDetected(candidate: DetectedOpenCandidate): Promise<void>;
		closeDetectedPicker(): void;
		openUrlSlot(slot: HostBrowserUrlSlot): void;
		editUrlSlot(slot: HostBrowserUrlSlot): void;
		closeHostUrl(): boolean;
		submitHostUrl(value: string): void;
		invalidateHostUrlReads(): void;
		resolvePaneContext(): Promise<TmuxPaneContext>;
		resolvePanePath(): Promise<string>;
		resolveWorkspace(): Promise<BrowserActionsWorkspace>;
		resolveCurrentGitHubRepository(): Promise<string>;
		runHostBrowserCommand(command: string, timeoutMs?: number): Promise<string>;
	};

export type BrowserActionsControllerCoreDependencies = {
	initialSourceKey: ShellTargetKey;
	requestOpen(onOpen: () => void): boolean;
	getTmuxEnabled(): boolean;
	getTmuxTarget(): string;
	runHostBrowserCommand(command: string, timeoutMs: number): Promise<string>;
	runWorkmuxCommand(argv: string[], timeoutMs: number): Promise<string>;
	openAndroidUrl(url: string): Promise<void>;
	showError(input: BrowserActionErrorInput): void;
	getErrorMessage(error: unknown): string;
};

const CLOSED_STATE: BrowserActionsState = {
	open: false,
	hostUrl: null,
	hostUrlSubmitting: false,
	hostUrlError: null,
	detectedOpenPicker: null,
};

class SupersededBrowserActionError extends Error {
	constructor() {
		super('Browser action was superseded.');
		this.name = 'SupersededBrowserActionError';
	}
}

type RequestCapture = {
	generation: number;
	sourceKey: ShellTargetKey;
};

type ManagedRequestId = RequestIdHandle & {
	beginCompletion(): Promise<void>;
	completeCurrent(): void;
	cancelQueuedCompletion(): void;
};

function createManagedRequestId(input: {
	capture(): RequestCapture;
	isCaptureCurrent(capture: RequestCapture): boolean;
}): ManagedRequestId {
	let currentId = 0;
	let currentCapture: RequestCapture | null = null;
	let queuedCompletion: (() => void) | null = null;
	const completions = new Map<number, () => void>();

	const complete = (id: number) => {
		const resolve = completions.get(id);
		if (!resolve) return;
		completions.delete(id);
		resolve();
	};
	const invalidate = () => {
		complete(currentId);
		currentId += 1;
		currentCapture = null;
	};

	return {
		next: () => {
			invalidate();
			currentCapture = input.capture();
			if (queuedCompletion) {
				completions.set(currentId, queuedCompletion);
				queuedCompletion = null;
			}
			return currentId;
		},
		isCurrent: (id) => {
			const current =
				id === currentId &&
				currentCapture !== null &&
				input.isCaptureCurrent(currentCapture);
			if (!current) complete(id);
			return current;
		},
		invalidate,
		beginCompletion: () =>
			new Promise<void>((resolve) => {
				if (queuedCompletion) queuedCompletion();
				queuedCompletion = resolve;
			}),
		completeCurrent: () => complete(currentId),
		cancelQueuedCompletion: () => {
			if (!queuedCompletion) return;
			const resolve = queuedCompletion;
			queuedCompletion = null;
			resolve();
		},
	};
}

export function createBrowserActionsControllerCore(
	deps: BrowserActionsControllerCoreDependencies,
): BrowserActionsControllerCore {
	const publisher = createControllerPublisher(CLOSED_STATE);
	let sourceKey = deps.initialSourceKey;
	let generation = 0;
	let disposed = false;

	const capture = (): RequestCapture => ({ generation, sourceKey });
	const isCaptureCurrent = (request: RequestCapture) =>
		!disposed &&
		request.generation === generation &&
		request.sourceKey === sourceKey;
	const assertCurrent = (request: RequestCapture) => {
		if (!isCaptureCurrent(request)) {
			throw new SupersededBrowserActionError();
		}
	};
	const guardedAwait = async <T>(work: () => Promise<T>): Promise<T> => {
		const request = capture();
		assertCurrent(request);
		const value = await work();
		assertCurrent(request);
		return value;
	};
	const publish = (next: BrowserActionsState) => {
		if (disposed) return;
		publisher.publish(next);
	};
	const patch = (next: Partial<BrowserActionsState>) => {
		publish({ ...publisher.getSnapshot(), ...next });
	};

	const requestFactoryInput = { capture, isCaptureCurrent };
	const hostUrlReadRequestId = createManagedRequestId(requestFactoryInput);
	const hostUrlSubmitRequestId = createManagedRequestId(requestFactoryInput);
	const browserGitHubTargetRequestId =
		createManagedRequestId(requestFactoryInput);
	const hostDiffityRequestId = createManagedRequestId(requestFactoryInput);
	const hostDetectedOpenRequestId = createManagedRequestId(requestFactoryInput);
	const hostDetectedOpenPickerSelectionRequestId =
		createManagedRequestId(requestFactoryInput);
	const hostUrlSubmitInFlightRef = { current: false };
	const hostDiffityInFlightRef = { current: false };
	const hostDetectedOpenInFlightRef = { current: false };

	const runHostBrowserCommand = (command: string, timeoutMs = 30_000) =>
		guardedAwait(() => deps.runHostBrowserCommand(command, timeoutMs));
	const runWorkmuxCommand = (argv: string[], timeoutMs: number) =>
		guardedAwait(() => deps.runWorkmuxCommand(argv, timeoutMs));
	const openAndroidUrl = (url: string) =>
		guardedAwait(() => deps.openAndroidUrl(url));
	const contextDependencies = () => ({
		tmuxEnabled: deps.getTmuxEnabled(),
		tmuxTarget: deps.getTmuxTarget(),
		runHostBrowserCommand,
		runWorkmuxCommand,
		getErrorMessage: deps.getErrorMessage,
	});
	const resolvePanePath = () =>
		guardedAwait(() => resolveBrowserActionsPanePath(contextDependencies()));
	const resolvePaneContext = () =>
		guardedAwait(() => resolveBrowserActionsPaneContext(contextDependencies()));
	const resolveWorkspace = () =>
		guardedAwait(() => resolveBrowserActionsWorkspace(contextDependencies()));
	const resolveCurrentGitHubRepositoryContext = () =>
		guardedAwait(() =>
			resolveGitHubRepositoryContext({
				resolvePanePath,
				runHostBrowserCommand,
				getErrorMessage: deps.getErrorMessage,
			}),
		);

	const resetHostUrl = () => {
		hostUrlReadRequestId.invalidate();
		hostUrlSubmitRequestId.invalidate();
		hostUrlSubmitInFlightRef.current = false;
		patch({
			hostUrl: null,
			hostUrlSubmitting: false,
			hostUrlError: null,
		});
	};
	const resetDetectedOpen = () => {
		hostDetectedOpenRequestId.invalidate();
		hostDetectedOpenInFlightRef.current = false;
		hostDetectedOpenPickerSelectionRequestId.invalidate();
		patch({ detectedOpenPicker: null });
	};
	const cleanupRequests = () => {
		cleanupBrowserActionRequests({
			hostUrlReadRequestId,
			hostUrlSubmitRequestId,
			hostUrlSubmitInFlightRef,
			browserGitHubTargetRequestId,
			hostDiffityRequestId,
			hostDiffityInFlightRef,
			hostDetectedOpenRequestId,
			hostDetectedOpenInFlightRef,
			hostDetectedOpenPickerSelectionRequestId,
		});
	};
	const invalidate = () => {
		if (disposed) return;
		generation += 1;
		cleanupRequests();
		publish(CLOSED_STATE);
	};

	const showError = (input: BrowserActionErrorInput) => {
		if (disposed) return;
		deps.showError(input);
	};
	const readUrlSlot = (mode: 'open' | 'edit', slot: HostBrowserUrlSlot) => {
		if (disposed) return;
		resetDetectedOpen();
		runHostUrlReadRequest({
			mode,
			slot,
			requestId: hostUrlReadRequestId,
			resolvePanePath,
			runHostBrowserCommand,
			openAndroidUrl,
			setOpen: (open) => patch({ open }),
			setHostUrlModalState: (hostUrl: HostUrlReadModalState | null) =>
				patch({ hostUrl }),
			setHostUrlModalError: (hostUrlError) => patch({ hostUrlError }),
			showError,
			getErrorMessage: deps.getErrorMessage,
		});
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		setSourceKey: (nextSourceKey) => {
			if (disposed || sourceKey === nextSourceKey) return;
			sourceKey = nextSourceKey;
			invalidate();
		},
		open: () => {
			if (disposed) return false;
			hostUrlReadRequestId.invalidate();
			return deps.requestOpen(() => {
				if (disposed) return;
				resetHostUrl();
				patch({ open: true });
			});
		},
		close: () => patch({ open: false }),
		openGitHubTarget: (target) => {
			if (disposed) return Promise.resolve();
			resetDetectedOpen();
			const completion = browserGitHubTargetRequestId.beginCompletion();
			runGitHubTargetOpenRequest({
				target,
				requestId: browserGitHubTargetRequestId,
				resolveRepositoryContext: resolveCurrentGitHubRepositoryContext,
				openAndroidUrl: async (url) => {
					await openAndroidUrl(url);
					browserGitHubTargetRequestId.completeCurrent();
				},
				showError: (input) => {
					showError(input);
					browserGitHubTargetRequestId.completeCurrent();
				},
				getErrorMessage: deps.getErrorMessage,
			});
			return completion;
		},
		openDiffity: () => {
			if (disposed) return Promise.resolve();
			resetDetectedOpen();
			const completion = hostDiffityRequestId.beginCompletion();
			const accepted = runHostDiffityOpenRequest({
				hostDiffityInFlightRef,
				hostDiffityRequestId,
				runDiffityShare: () =>
					guardedAwait(() =>
						runBrowserActionsDiffityShareWithContext(contextDependencies()),
					),
				openAndroidUrl: async (url) => {
					await openAndroidUrl(url);
					hostDiffityRequestId.completeCurrent();
				},
				showError: (title, message) => {
					showError({ action: 'Diff', title, message });
					hostDiffityRequestId.completeCurrent();
				},
				showErrorReport: (report) => {
					showError(createDiffBrowserActionErrorInput(report));
					hostDiffityRequestId.completeCurrent();
				},
				getErrorMessage: deps.getErrorMessage,
			});
			if (!accepted) hostDiffityRequestId.cancelQueuedCompletion();
			return completion;
		},
		openDetected: (mode) => {
			if (disposed) return false;
			hostDetectedOpenPickerSelectionRequestId.invalidate();
			patch({ detectedOpenPicker: null });
			const result = runDetectedOpenControllerRequest({
				mode,
				inFlightRef: hostDetectedOpenInFlightRef,
				requestId: hostDetectedOpenRequestId,
				resolvePaneContext,
				runHostBrowserCommand,
				setOpen: (open) => patch({ open }),
				openUrl: openAndroidUrl,
				setPickerCandidates: (candidates, context) =>
					patch({ detectedOpenPicker: { candidates, context } }),
				showError: (title, message) =>
					showError({
						action: mode === 'pick' ? 'Pick' : 'Open',
						title,
						message,
					}),
				showErrorReport: (report) =>
					showError({
						action: mode === 'pick' ? 'Pick' : 'Open',
						...report,
					}),
				getErrorMessage: deps.getErrorMessage,
			});
			return result.accepted;
		},
		selectDetected: async (candidate) => {
			if (disposed) return;
			const state = publisher.getSnapshot().detectedOpenPicker;
			if (!state) return;
			const id = hostDetectedOpenPickerSelectionRequestId.next();
			patch({ detectedOpenPicker: null });
			await runGuardedDetectedOpenPickerSelectionRequest({
				id,
				requestId: hostDetectedOpenPickerSelectionRequestId,
				candidate,
				context: state.context,
				runHostBrowserCommand,
				openUrl: openAndroidUrl,
				getErrorMessage: deps.getErrorMessage,
				showPickError: (error) => showError({ action: 'Pick', ...error }),
			});
		},
		closeDetectedPicker: () => patch({ detectedOpenPicker: null }),
		openUrlSlot: (slot) => readUrlSlot('open', slot),
		editUrlSlot: (slot) => readUrlSlot('edit', slot),
		closeHostUrl: () => {
			if (disposed) return true;
			if (
				hostUrlSubmitInFlightRef.current ||
				publisher.getSnapshot().hostUrlSubmitting
			) {
				return false;
			}
			resetHostUrl();
			return true;
		},
		submitHostUrl: (value) => {
			if (disposed) return;
			const state = publisher.getSnapshot().hostUrl;
			if (!state) return;
			const parsed = parseHostBrowserUrlInput(value);
			if (parsed.type === 'empty') {
				patch({ hostUrl: null, hostUrlError: null });
				return;
			}
			if (parsed.type === 'invalid') {
				patch({ hostUrlError: parsed.message });
				return;
			}
			runHostUrlSubmitRequest({
				state,
				url: parsed.url,
				hostUrlSubmitInFlightRef,
				hostUrlSubmitRequestId,
				runHostBrowserCommand,
				openAndroidUrl,
				setHostUrlModalState: (hostUrl) => patch({ hostUrl }),
				setHostUrlModalSubmitting: (hostUrlSubmitting) =>
					patch({ hostUrlSubmitting }),
				setHostUrlModalError: (hostUrlError) => patch({ hostUrlError }),
				showError,
				getErrorMessage: deps.getErrorMessage,
			});
		},
		invalidateHostUrlReads: () => hostUrlReadRequestId.invalidate(),
		resolvePaneContext,
		resolvePanePath,
		resolveWorkspace,
		resolveCurrentGitHubRepository: async () => {
			const request = capture();
			const { repository } = await resolveCurrentGitHubRepositoryContext();
			assertCurrent(request);
			return repository;
		},
		runHostBrowserCommand,
		invalidate,
		dispose: () => {
			if (disposed) return;
			generation += 1;
			cleanupRequests();
			publisher.publish(CLOSED_STATE);
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
