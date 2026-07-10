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

type RequestCompletionToken = {
	promise: Promise<void>;
	resolve(): void;
	requestId: number | null;
};

type ManagedRequestId = RequestIdHandle & {
	prepare(capture: RequestCapture): void;
	beginCompletion(capture: RequestCapture): RequestCompletionToken;
	complete(token: RequestCompletionToken): void;
	cancelPrepared(token?: RequestCompletionToken): void;
};

function createManagedRequestId(input: {
	capture(): RequestCapture;
	isCaptureCurrent(capture: RequestCapture): boolean;
}): ManagedRequestId {
	let currentId = 0;
	let currentCapture: RequestCapture | null = null;
	let currentCompletion: RequestCompletionToken | null = null;
	let prepared: {
		capture: RequestCapture;
		completion: RequestCompletionToken | null;
	} | null = null;

	const supersedeCurrent = () => {
		currentCompletion?.resolve();
		currentCompletion = null;
		currentId += 1;
		currentCapture = null;
	};
	const invalidate = () => {
		supersedeCurrent();
		prepared?.completion?.resolve();
		prepared = null;
	};
	const prepare = (
		requestCapture: RequestCapture,
		completion: RequestCompletionToken | null,
	) => {
		prepared?.completion?.resolve();
		prepared = { capture: requestCapture, completion };
	};

	return {
		next: () => {
			supersedeCurrent();
			const next = prepared ?? {
				capture: input.capture(),
				completion: null,
			};
			prepared = null;
			currentCapture = next.capture;
			currentCompletion = next.completion;
			if (currentCompletion) currentCompletion.requestId = currentId;
			return currentId;
		},
		isCurrent: (id) => {
			const current =
				id === currentId &&
				currentCapture !== null &&
				input.isCaptureCurrent(currentCapture);
			if (!current && currentCompletion?.requestId === id) {
				currentCompletion.resolve();
				currentCompletion = null;
			}
			return current;
		},
		invalidate,
		prepare: (requestCapture) => prepare(requestCapture, null),
		beginCompletion: (requestCapture) => {
			let settled = false;
			let resolvePromise!: () => void;
			const token: RequestCompletionToken = {
				promise: new Promise<void>((resolve) => {
					resolvePromise = resolve;
				}),
				resolve: () => {
					if (settled) return;
					settled = true;
					resolvePromise();
				},
				requestId: null,
			};
			prepare(requestCapture, token);
			return token;
		},
		complete: (token) => {
			token.resolve();
			if (currentCompletion === token) currentCompletion = null;
		},
		cancelPrepared: (token) => {
			if (prepared && (!token || prepared.completion === token)) {
				prepared.completion?.resolve();
				prepared = null;
				return;
			}
			token?.resolve();
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
	const guardedAwait = async <T>(
		request: RequestCapture,
		work: () => Promise<T>,
	): Promise<T> => {
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

	const runHostBrowserCommandFor = (
		request: RequestCapture,
		command: string,
		timeoutMs = 30_000,
	) =>
		guardedAwait(request, () => deps.runHostBrowserCommand(command, timeoutMs));
	const runWorkmuxCommandFor = (
		request: RequestCapture,
		argv: string[],
		timeoutMs: number,
	) => guardedAwait(request, () => deps.runWorkmuxCommand(argv, timeoutMs));
	const openAndroidUrlFor = (request: RequestCapture, url: string) =>
		guardedAwait(request, () => deps.openAndroidUrl(url));
	const contextDependencies = (request: RequestCapture) => ({
		tmuxEnabled: deps.getTmuxEnabled(),
		tmuxTarget: deps.getTmuxTarget(),
		runHostBrowserCommand: (command: string, timeoutMs: number) =>
			runHostBrowserCommandFor(request, command, timeoutMs),
		runWorkmuxCommand: (argv: string[], timeoutMs: number) =>
			runWorkmuxCommandFor(request, argv, timeoutMs),
		getErrorMessage: deps.getErrorMessage,
	});
	const resolvePanePathFor = (request: RequestCapture) =>
		guardedAwait(request, () =>
			resolveBrowserActionsPanePath(contextDependencies(request)),
		);
	const resolvePaneContextFor = (request: RequestCapture) =>
		guardedAwait(request, () =>
			resolveBrowserActionsPaneContext(contextDependencies(request)),
		);
	const resolveWorkspaceFor = (request: RequestCapture) =>
		guardedAwait(request, () =>
			resolveBrowserActionsWorkspace(contextDependencies(request)),
		);
	const resolveCurrentGitHubRepositoryContextFor = (request: RequestCapture) =>
		guardedAwait(request, () =>
			resolveGitHubRepositoryContext({
				resolvePanePath: () => resolvePanePathFor(request),
				runHostBrowserCommand: (command, timeoutMs) =>
					runHostBrowserCommandFor(request, command, timeoutMs),
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
	const showErrorFor = (
		request: RequestCapture,
		input: BrowserActionErrorInput,
	) => {
		if (!isCaptureCurrent(request)) return;
		showError(input);
	};
	const readUrlSlot = (mode: 'open' | 'edit', slot: HostBrowserUrlSlot) => {
		if (disposed) return;
		resetDetectedOpen();
		const request = capture();
		hostUrlReadRequestId.prepare(request);
		runHostUrlReadRequest({
			mode,
			slot,
			requestId: hostUrlReadRequestId,
			resolvePanePath: () => resolvePanePathFor(request),
			runHostBrowserCommand: (command, timeoutMs) =>
				runHostBrowserCommandFor(request, command, timeoutMs),
			openAndroidUrl: (url) => openAndroidUrlFor(request, url),
			setOpen: (open) => patch({ open }),
			setHostUrlModalState: (hostUrl: HostUrlReadModalState | null) =>
				patch({ hostUrl }),
			setHostUrlModalError: (hostUrlError) => patch({ hostUrlError }),
			showError: (input) => showErrorFor(request, input),
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
			const request = capture();
			const completion = browserGitHubTargetRequestId.beginCompletion(request);
			runGitHubTargetOpenRequest({
				target,
				requestId: browserGitHubTargetRequestId,
				resolveRepositoryContext: () =>
					resolveCurrentGitHubRepositoryContextFor(request),
				openAndroidUrl: async (url) => {
					await openAndroidUrlFor(request, url);
					browserGitHubTargetRequestId.complete(completion);
				},
				showError: (input) => {
					showErrorFor(request, input);
					browserGitHubTargetRequestId.complete(completion);
				},
				getErrorMessage: deps.getErrorMessage,
			});
			return completion.promise;
		},
		openDiffity: () => {
			if (disposed) return Promise.resolve();
			resetDetectedOpen();
			const request = capture();
			const completion = hostDiffityRequestId.beginCompletion(request);
			const accepted = runHostDiffityOpenRequest({
				hostDiffityInFlightRef,
				hostDiffityRequestId,
				runDiffityShare: () =>
					guardedAwait(request, () =>
						runBrowserActionsDiffityShareWithContext(
							contextDependencies(request),
						),
					),
				openAndroidUrl: async (url) => {
					await openAndroidUrlFor(request, url);
					hostDiffityRequestId.complete(completion);
				},
				showError: (title, message) => {
					showErrorFor(request, { action: 'Diff', title, message });
					hostDiffityRequestId.complete(completion);
				},
				showErrorReport: (report) => {
					showErrorFor(request, createDiffBrowserActionErrorInput(report));
					hostDiffityRequestId.complete(completion);
				},
				getErrorMessage: deps.getErrorMessage,
			});
			if (!accepted) hostDiffityRequestId.cancelPrepared(completion);
			return completion.promise;
		},
		openDetected: (mode) => {
			if (disposed) return false;
			hostDetectedOpenPickerSelectionRequestId.invalidate();
			patch({ detectedOpenPicker: null });
			const request = capture();
			hostDetectedOpenRequestId.prepare(request);
			const result = runDetectedOpenControllerRequest({
				mode,
				inFlightRef: hostDetectedOpenInFlightRef,
				requestId: hostDetectedOpenRequestId,
				resolvePaneContext: () => resolvePaneContextFor(request),
				runHostBrowserCommand: (command, timeoutMs) =>
					runHostBrowserCommandFor(request, command, timeoutMs),
				setOpen: (open) => patch({ open }),
				openUrl: (url) => openAndroidUrlFor(request, url),
				setPickerCandidates: (candidates, context) =>
					patch({ detectedOpenPicker: { candidates, context } }),
				showError: (title, message) =>
					showErrorFor(request, {
						action: mode === 'pick' ? 'Pick' : 'Open',
						title,
						message,
					}),
				showErrorReport: (report) =>
					showErrorFor(request, {
						action: mode === 'pick' ? 'Pick' : 'Open',
						...report,
					}),
				getErrorMessage: deps.getErrorMessage,
			});
			if (!result.accepted) hostDetectedOpenRequestId.cancelPrepared();
			return result.accepted;
		},
		selectDetected: async (candidate) => {
			if (disposed) return;
			const state = publisher.getSnapshot().detectedOpenPicker;
			if (!state) return;
			const request = capture();
			hostDetectedOpenPickerSelectionRequestId.prepare(request);
			const id = hostDetectedOpenPickerSelectionRequestId.next();
			patch({ detectedOpenPicker: null });
			await runGuardedDetectedOpenPickerSelectionRequest({
				id,
				requestId: hostDetectedOpenPickerSelectionRequestId,
				candidate,
				context: state.context,
				runHostBrowserCommand: (command, timeoutMs) =>
					runHostBrowserCommandFor(request, command, timeoutMs),
				openUrl: (url) => openAndroidUrlFor(request, url),
				getErrorMessage: deps.getErrorMessage,
				showPickError: (error) =>
					showErrorFor(request, { action: 'Pick', ...error }),
			});
		},
		closeDetectedPicker: () => {
			hostDetectedOpenPickerSelectionRequestId.invalidate();
			patch({ detectedOpenPicker: null });
		},
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
			const request = capture();
			hostUrlSubmitRequestId.prepare(request);
			const accepted = runHostUrlSubmitRequest({
				state,
				url: parsed.url,
				hostUrlSubmitInFlightRef,
				hostUrlSubmitRequestId,
				runHostBrowserCommand: (command, timeoutMs) =>
					runHostBrowserCommandFor(request, command, timeoutMs),
				openAndroidUrl: (url) => openAndroidUrlFor(request, url),
				setHostUrlModalState: (hostUrl) => patch({ hostUrl }),
				setHostUrlModalSubmitting: (hostUrlSubmitting) =>
					patch({ hostUrlSubmitting }),
				setHostUrlModalError: (hostUrlError) => patch({ hostUrlError }),
				showError: (input) => showErrorFor(request, input),
				getErrorMessage: deps.getErrorMessage,
			});
			if (!accepted) hostUrlSubmitRequestId.cancelPrepared();
		},
		invalidateHostUrlReads: () => hostUrlReadRequestId.invalidate(),
		resolvePaneContext: () => {
			const request = capture();
			return resolvePaneContextFor(request);
		},
		resolvePanePath: () => {
			const request = capture();
			return resolvePanePathFor(request);
		},
		resolveWorkspace: () => {
			const request = capture();
			return resolveWorkspaceFor(request);
		},
		resolveCurrentGitHubRepository: async () => {
			const request = capture();
			const { repository } =
				await resolveCurrentGitHubRepositoryContextFor(request);
			return repository;
		},
		runHostBrowserCommand: (command, timeoutMs) => {
			const request = capture();
			return runHostBrowserCommandFor(request, command, timeoutMs);
		},
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
