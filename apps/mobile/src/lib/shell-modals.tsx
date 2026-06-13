import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from 'react';
import { Alert } from 'react-native';
import {
	resolveBrowserActionsPaneContext,
	resolveBrowserActionsPanePath,
	resolveBrowserActionsWorkspace,
	runBrowserActionsDiffityShareWithContext,
	type BrowserActionsWorkspace,
} from '@/lib/browser-actions-controller-actions';
import { cleanupBrowserActionRequests } from '@/lib/browser-actions-request-cleanup';
import {
	runDetectedOpenControllerRequest,
	runGuardedDetectedOpenPickerSelectionRequest,
	type DetectedOpenCandidate,
} from '@/lib/detected-open-actions';
import { showBrowserActionErrorReport } from './browser-action-error-alert';
import { createBrowserActionErrorReport } from './browser-action-error-report';
import {
	getHostBrowserUrlSlotLabel,
	HOST_BROWSER_NO_CONNECTION_MESSAGE,
	parseHostBrowserUrlInput,
	type HostBrowserOpenMode,
	type TmuxPaneContext,
	type HostBrowserUrlSlot,
} from './host-browser-actions';
import { runHostCommandWithBoundary } from './host-command-router';
import { runHostDiffityOpenRequest } from './host-diffity-open-request';
import { rootLogger } from './logger';
import {
	buildCreateGitHubIssueCommand,
	buildFeatureRequestSubmittedAlert,
	type GitHubRepositoryTarget,
} from './repo-feature-request';
import { useRequestId } from './request-id';
import {
	createDiffBrowserActionErrorInput,
	type BrowserActionErrorInput,
} from './shell-browser-action-error-inputs';
import {
	resolveGitHubRepositoryContext,
	runGitHubTargetOpenRequest,
} from './shell-github-target-request';
import { runHostUrlReadRequest } from './shell-host-url-read-request';
import { runHostUrlSubmitRequest } from './shell-host-url-submit-request';
import { type DiscoveredSkill } from './skill-discovery';
import { skillDiscoveryCache } from './skill-discovery-cache-native';
import { loadSkillSelectorProject } from './skill-selector-loader';

const logger = rootLogger.extend('ShellModals');

export type SimpleModalHandle = {
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
};

export type TextEntryModalHandle = SimpleModalHandle & {
	openRef: RefObject<boolean>;
};

export type ShellSimpleModalsHandle = {
	commandMenu: SimpleModalHandle;
	commander: SimpleModalHandle;
	textEntry: TextEntryModalHandle;
	configure: SimpleModalHandle;
};

export function useShellSimpleModals(): ShellSimpleModalsHandle {
	const [commandMenuOpen, setCommandMenuOpen] = useState(false);
	const [commanderOpen, setCommanderOpen] = useState(false);
	const [textEntryOpen, setTextEntryOpen] = useState(false);
	const [configureOpen, setConfigureOpen] = useState(false);

	const textEntryOpenRef = useRef(false);
	// Sync ref with state so callers (Wispr handlers in detail.tsx) that read
	// it inside callbacks see the latest value without going through deps.
	textEntryOpenRef.current = textEntryOpen;

	const openCommandMenu = useCallback(() => {
		setCommandMenuOpen(true);
	}, []);
	const closeCommandMenu = useCallback(() => {
		setCommandMenuOpen(false);
	}, []);

	const openCommander = useCallback(() => {
		setCommanderOpen(true);
	}, []);
	const closeCommander = useCallback(() => {
		setCommanderOpen(false);
	}, []);

	const openTextEntry = useCallback(() => {
		textEntryOpenRef.current = true;
		setTextEntryOpen(true);
	}, []);
	const closeTextEntry = useCallback(() => {
		textEntryOpenRef.current = false;
		setTextEntryOpen(false);
	}, []);

	const openConfigure = useCallback(() => {
		setConfigureOpen(true);
	}, []);
	const closeConfigure = useCallback(() => {
		setConfigureOpen(false);
	}, []);

	const commandMenu = useMemo<SimpleModalHandle>(
		() => ({
			open: commandMenuOpen,
			onOpen: openCommandMenu,
			onClose: closeCommandMenu,
		}),
		[commandMenuOpen, openCommandMenu, closeCommandMenu],
	);

	const commander = useMemo<SimpleModalHandle>(
		() => ({
			open: commanderOpen,
			onOpen: openCommander,
			onClose: closeCommander,
		}),
		[commanderOpen, openCommander, closeCommander],
	);

	const textEntry = useMemo<TextEntryModalHandle>(
		() => ({
			open: textEntryOpen,
			openRef: textEntryOpenRef,
			onOpen: openTextEntry,
			onClose: closeTextEntry,
		}),
		[textEntryOpen, openTextEntry, closeTextEntry],
	);

	const configure = useMemo<SimpleModalHandle>(
		() => ({
			open: configureOpen,
			onOpen: openConfigure,
			onClose: closeConfigure,
		}),
		[configureOpen, openConfigure, closeConfigure],
	);

	return { commandMenu, commander, textEntry, configure };
}

export type SkillSelectorModalProps = {
	open: boolean;
	skills: DiscoveredSkill[];
	projectName: string | null;
	projectRoot: string | null;
	updatedAt: string | null;
	isLoading: boolean;
	isRefreshing: boolean;
	error: string | null;
	refreshError: string | null;
	onClose: () => void;
	onRetry: () => void;
	onRefresh: () => void;
	onSelect: (skill: DiscoveredSkill) => void;
};

export type SkillSelectorControllerHandle = {
	modalProps: SkillSelectorModalProps;
	open: () => void;
	close: () => void;
};

export function useSkillSelectorController<TConnection>(deps: {
	connection: TConnection | null;
	tmuxEnabled: boolean;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	resolveHostBrowserWorkspace: () => Promise<BrowserActionsWorkspace>;
	sendTextRaw: (text: string) => void;
	sourceKey: string;
	stableConnectionId: string;
	tmuxTarget: string;
	getErrorMessage: (error: unknown) => string;
	closeOtherModals: () => boolean;
}): SkillSelectorControllerHandle {
	const {
		connection,
		tmuxEnabled,
		runHostBrowserCommand,
		resolveHostBrowserWorkspace,
		sendTextRaw,
		sourceKey,
		stableConnectionId,
		tmuxTarget,
		getErrorMessage,
		closeOtherModals,
	} = deps;

	const [open, setOpen] = useState(false);
	const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
	const [projectName, setProjectName] = useState<string | null>(null);
	const [projectRoot, setProjectRoot] = useState<string | null>(null);
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshError, setRefreshError] = useState<string | null>(null);

	const requestId = useRequestId();
	const activeSourceKeyRef = useRef<string | null>(null);
	const lastSourceKeyRef = useRef(sourceKey);
	const currentSourceKeyRef = useRef(sourceKey);
	currentSourceKeyRef.current = sourceKey;
	const visibleSkillsRef = useRef<DiscoveredSkill[]>([]);
	visibleSkillsRef.current = skills;

	const visible = open && activeSourceKeyRef.current === sourceKey;

	const close = useCallback(() => {
		requestId.invalidate();
		activeSourceKeyRef.current = null;
		setOpen(false);
		setIsLoading(false);
		setIsRefreshing(false);
		setError(null);
		setRefreshError(null);
		setSkills([]);
		setProjectName(null);
		setProjectRoot(null);
		setUpdatedAt(null);
	}, [requestId]);

	const load = useCallback(
		async (options?: { forceRefresh?: boolean }) => {
			const forceRefresh = options?.forceRefresh ?? false;
			const requestSourceKey = currentSourceKeyRef.current;
			const id = requestId.next();
			const refreshVisibleSkills =
				forceRefresh && visibleSkillsRef.current.length > 0;
			activeSourceKeyRef.current = requestSourceKey;
			setError(null);
			setRefreshError(null);
			if (refreshVisibleSkills) {
				setIsRefreshing(true);
			} else {
				setIsLoading(true);
				setSkills([]);
				setProjectName(null);
				setProjectRoot(null);
				setUpdatedAt(null);
			}

			try {
				if (!connection) {
					throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
				}
				if (!tmuxEnabled) {
					throw new Error('Skill selector requires a tmux-enabled connection.');
				}
				const result = await loadSkillSelectorProject({
					cache: skillDiscoveryCache,
					stableConnectionId,
					tmuxTarget,
					resolveWorkspace: async () => {
						const workspace = await resolveHostBrowserWorkspace();
						if (currentSourceKeyRef.current !== requestSourceKey) {
							throw new Error('Skill selector source changed.');
						}
						return workspace;
					},
					runCommand: (command) => runHostBrowserCommand(command, 10_000),
					forceRefresh,
				});
				if (
					requestId.isCurrent(id) &&
					activeSourceKeyRef.current === requestSourceKey &&
					currentSourceKeyRef.current === requestSourceKey
				) {
					setProjectName(result.projectName);
					setProjectRoot(result.projectRoot);
					setUpdatedAt(result.updatedAt);
					setSkills(result.skills);
				}
			} catch (err) {
				if (
					requestId.isCurrent(id) &&
					activeSourceKeyRef.current === requestSourceKey &&
					currentSourceKeyRef.current === requestSourceKey
				) {
					if (refreshVisibleSkills) {
						setRefreshError(getErrorMessage(err));
					} else {
						setError(getErrorMessage(err));
					}
				}
			} finally {
				if (
					requestId.isCurrent(id) &&
					activeSourceKeyRef.current === requestSourceKey &&
					currentSourceKeyRef.current === requestSourceKey
				) {
					setIsLoading(false);
					setIsRefreshing(false);
				}
			}
		},
		[
			connection,
			getErrorMessage,
			requestId,
			resolveHostBrowserWorkspace,
			runHostBrowserCommand,
			stableConnectionId,
			tmuxEnabled,
			tmuxTarget,
		],
	);

	const openController = useCallback(() => {
		if (!closeOtherModals()) return;
		setOpen(true);
		void load();
	}, [closeOtherModals, load]);

	const refresh = useCallback(() => {
		void load({ forceRefresh: true });
	}, [load]);

	const handleSelect = useCallback(
		(skill: DiscoveredSkill) => {
			if (activeSourceKeyRef.current !== currentSourceKeyRef.current) {
				close();
				return;
			}
			sendTextRaw(`$${skill.name} `);
			close();
		},
		[close, sendTextRaw],
	);

	useLayoutEffect(() => {
		if (lastSourceKeyRef.current === sourceKey) return;
		lastSourceKeyRef.current = sourceKey;
		if (open) {
			close();
		}
	}, [close, open, sourceKey]);

	useEffect(() => {
		return () => {
			requestId.invalidate();
		};
	}, [requestId]);

	const modalProps = useMemo<SkillSelectorModalProps>(
		() => ({
			open: visible,
			skills,
			projectName,
			projectRoot,
			updatedAt,
			isLoading,
			isRefreshing,
			error,
			refreshError,
			onClose: close,
			onRetry: refresh,
			onRefresh: refresh,
			onSelect: handleSelect,
		}),
		[
			close,
			error,
			handleSelect,
			isLoading,
			isRefreshing,
			projectName,
			projectRoot,
			refresh,
			refreshError,
			skills,
			updatedAt,
			visible,
		],
	);

	return useMemo<SkillSelectorControllerHandle>(
		() => ({
			modalProps,
			open: openController,
			close,
		}),
		[close, modalProps, openController],
	);
}

export type FeatureRequestModalProps = {
	open: boolean;
	isSubmitting: boolean;
	targetRepository: string | null;
	isResolvingTarget: boolean;
	error: string | undefined;
	onClose: () => boolean;
	onSubmit: (description: string, repository: string) => Promise<void>;
};

export type FeatureRequestControllerHandle = {
	modalProps: FeatureRequestModalProps;
	open: () => void;
	close: () => boolean;
	markSourceStale: () => void;
};

export type FeatureRequestControllerDeps<TConnection> = {
	connection: TConnection | null;
	resolveCurrentGitHubRepository: () => Promise<string>;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<{
		success: boolean;
		output: string;
		error?: string;
		issueUrl?: string;
	}>;
	getErrorMessage: (error: unknown) => string;
	logger: {
		info: (message: string, payload?: unknown) => void;
		error: (message: string, payload?: unknown) => void;
	};
	closeOtherModals: () => void;
};

export function useFeatureRequestController<TConnection>(
	deps: FeatureRequestControllerDeps<TConnection>,
): FeatureRequestControllerHandle {
	const {
		connection,
		resolveCurrentGitHubRepository,
		executeSideChannelCommand,
		getErrorMessage,
		logger,
		closeOtherModals,
	} = deps;

	const [open, setOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [targetRepository, setTargetRepository] = useState<string | null>(null);
	const [isResolvingTarget, setIsResolvingTarget] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const resolveRequestId = useRequestId();
	const submitRequestId = useRequestId();
	const submitInFlightRef = useRef(false);
	const sourceStaleRef = useRef(false);

	const reset = useCallback(() => {
		setOpen(false);
		setIsSubmitting(false);
		setIsResolvingTarget(false);
		setTargetRepository(null);
		setError(undefined);
	}, []);

	const cancelRequests = useCallback(() => {
		resolveRequestId.invalidate();
		submitRequestId.invalidate();
	}, [resolveRequestId, submitRequestId]);

	const close = useCallback((): boolean => {
		if (submitInFlightRef.current || isSubmitting) {
			return false;
		}
		cancelRequests();
		sourceStaleRef.current = false;
		reset();
		return true;
	}, [cancelRequests, isSubmitting, reset]);

	const openController = useCallback(() => {
		if (isSubmitting) return;
		const id = resolveRequestId.next();
		submitRequestId.invalidate();
		closeOtherModals();
		reset();
		setOpen(true);

		void (async () => {
			setIsResolvingTarget(true);
			try {
				const repository = await resolveCurrentGitHubRepository();
				if (!resolveRequestId.isCurrent(id)) return;
				setTargetRepository(repository);
				setError(undefined);
			} catch (err) {
				if (!resolveRequestId.isCurrent(id)) return;
				setTargetRepository(null);
				setError(getErrorMessage(err));
			} finally {
				if (resolveRequestId.isCurrent(id)) {
					setIsResolvingTarget(false);
				}
			}
		})();
	}, [
		closeOtherModals,
		getErrorMessage,
		isSubmitting,
		reset,
		resolveCurrentGitHubRepository,
		resolveRequestId,
		submitRequestId,
	]);

	const submit = useCallback(
		async (description: string, repository: string) => {
			if (submitInFlightRef.current) return;
			const id = submitRequestId.next();
			if (!connection) {
				setError('No SSH connection available');
				return;
			}
			if (!repository) {
				setError('Could not resolve GitHub repository for current window.');
				return;
			}

			submitInFlightRef.current = true;
			sourceStaleRef.current = false;
			setIsSubmitting(true);
			setError(undefined);

			const command = buildCreateGitHubIssueCommand({
				description,
				repository,
			});

			try {
				const result = await executeSideChannelCommand(
					connection,
					command,
					60_000,
				);
				if (!submitRequestId.isCurrent(id)) return;
				if (sourceStaleRef.current) {
					reset();
					sourceStaleRef.current = false;
					return;
				}
				if (result.success) {
					logger.info('Feature request submitted successfully', {
						output: result.output,
						issueUrl: result.issueUrl,
					});
					setOpen(false);
					setError(undefined);
					sourceStaleRef.current = false;
					const alert = buildFeatureRequestSubmittedAlert({
						issueUrl: result.issueUrl ?? null,
					});
					Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
				} else {
					const errorMsg =
						result.error ||
						'Failed to create issue. Make sure gh and claude CLIs are installed and authenticated on the remote host.';
					logger.error('Feature request failed', { error: errorMsg });
					if (!submitRequestId.isCurrent(id)) return;
					setError(errorMsg);
				}
			} catch (err) {
				const errorMsg =
					err instanceof Error ? err.message : 'Unknown error occurred';
				logger.error('Feature request error', { error: err });
				if (!submitRequestId.isCurrent(id)) return;
				if (sourceStaleRef.current) {
					reset();
					sourceStaleRef.current = false;
					return;
				}
				setError(errorMsg);
			} finally {
				if (submitRequestId.isCurrent(id)) {
					submitInFlightRef.current = false;
					setIsSubmitting(false);
				}
			}
		},
		[
			connection,
			executeSideChannelCommand,
			logger,
			reset,
			submitRequestId,
		],
	);

	const markSourceStale = useCallback(() => {
		if (submitInFlightRef.current) {
			sourceStaleRef.current = true;
		} else {
			close();
		}
	}, [close]);

	useEffect(() => {
		return () => {
			cancelRequests();
			submitInFlightRef.current = false;
			sourceStaleRef.current = false;
		};
	}, [cancelRequests]);

	const modalProps = useMemo<FeatureRequestModalProps>(
		() => ({
			open,
			isSubmitting,
			targetRepository,
			isResolvingTarget,
			error,
			onClose: close,
			onSubmit: submit,
		}),
		[
			close,
			error,
			isResolvingTarget,
			isSubmitting,
			open,
			submit,
			targetRepository,
		],
	);

	return useMemo<FeatureRequestControllerHandle>(
		() => ({
			modalProps,
			open: openController,
			close,
			markSourceStale,
		}),
		[close, markSourceStale, modalProps, openController],
	);
}

export type HostUrlModalMode = 'edit' | 'open-missing';

export type HostUrlModalStateValue = {
	mode: HostUrlModalMode;
	slot: HostBrowserUrlSlot;
	panePath: string;
	initialValue: string;
};

export type BrowserActionsModalProps = {
	open: boolean;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenDetectedAuto: () => boolean;
	onOpenDetectedPick: () => boolean;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
};

export type HostUrlModalProps = {
	open: boolean;
	slot: HostBrowserUrlSlot | null;
	slotLabel: string;
	initialValue: string;
	mode: HostUrlModalMode;
	isSubmitting: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (value: string) => void;
};

export type DetectedOpenPickerModalProps = {
	open: boolean;
	candidates: readonly DetectedOpenCandidate[];
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
};

export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	detectedOpenPickerProps: DetectedOpenPickerModalProps;
	open: () => void;
	close: () => void;
	resolveHostBrowserPaneContext: () => Promise<TmuxPaneContext>;
	resolveHostBrowserPanePath: () => Promise<string>;
	resolveHostBrowserWorkspace: () => Promise<BrowserActionsWorkspace>;
	resolveCurrentGitHubRepository: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	invalidateHostUrlReads: () => void;
	invalidateAll: () => void;
};

export type BrowserActionsControllerDeps<TConnection> = {
	connection: TConnection | null;
	tmuxEnabled: boolean;
	tmuxTarget: string;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<{ success: boolean; output: string; error?: string }>;
	runWorkmuxCommand: (
		connection: TConnection,
		argv: string[],
		timeoutMs: number,
	) => Promise<string>;
	getErrorMessage: (error: unknown) => string;
	closeOtherModals: () => boolean;
};

export function useBrowserActionsController<TConnection>(
	deps: BrowserActionsControllerDeps<TConnection>,
): BrowserActionsControllerHandle {
	const {
		connection,
		tmuxEnabled,
		tmuxTarget,
		executeSideChannelCommand,
		runWorkmuxCommand,
		getErrorMessage,
		closeOtherModals,
	} = deps;

	const [open, setOpen] = useState(false);
	const [hostUrlModalState, setHostUrlModalState] =
		useState<HostUrlModalStateValue | null>(null);
	const [hostUrlModalSubmitting, setHostUrlModalSubmitting] = useState(false);
	const [hostUrlModalError, setHostUrlModalError] = useState<string | null>(
		null,
	);
	const [detectedOpenPickerState, setDetectedOpenPickerState] = useState<{
		context: TmuxPaneContext;
		candidates: DetectedOpenCandidate[];
	} | null>(null);

	const hostUrlReadRequestId = useRequestId();
	const hostUrlSubmitRequestId = useRequestId();
	const hostUrlSubmitInFlightRef = useRef(false);
	const browserGitHubTargetRequestId = useRequestId();
	const hostDiffityRequestId = useRequestId();
	const hostDiffityInFlightRef = useRef(false);
	const hostDetectedOpenRequestId = useRequestId();
	const hostDetectedOpenInFlightRef = useRef(false);
	const hostDetectedOpenPickerSelectionRequestId = useRequestId();

	const showError = useCallback(
		(input: BrowserActionErrorInput) => {
			showBrowserActionErrorReport(
				createBrowserActionErrorReport({
					...input,
					connectionPresent: Boolean(connection),
					tmuxEnabled,
					tmuxTarget,
				}),
				{
					alert: (title, message, buttons) =>
						Alert.alert(title, message, buttons),
					copyText: async (text) => {
						await Clipboard.setStringAsync(text);
					},
					warn: (message, error) => logger.warn(message, error),
				},
			);
		},
		[connection, tmuxEnabled, tmuxTarget],
	);

	const runHostBrowserCommand = useCallback(
		async (command: string, timeoutMs = 30_000) => {
			return runHostCommandWithBoundary({
				connection,
				command,
				timeoutMs,
				executeSideChannelCommand,
				runWorkmuxCommand,
			});
		},
		[connection, executeSideChannelCommand, runWorkmuxCommand],
	);

	const runWorkmuxBrowserCommand = useCallback(
		async (argv: string[], timeoutMs: number) => {
			if (!connection) throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
			return runWorkmuxCommand(connection, argv, timeoutMs);
		},
		[connection, runWorkmuxCommand],
	);

	const resolveHostBrowserPanePath = useCallback(async () => {
		return resolveBrowserActionsPanePath({
			tmuxEnabled,
			tmuxTarget,
			runHostBrowserCommand,
			runWorkmuxCommand: runWorkmuxBrowserCommand,
			getErrorMessage,
		});
	}, [
		getErrorMessage,
		runHostBrowserCommand,
		runWorkmuxBrowserCommand,
		tmuxEnabled,
		tmuxTarget,
	]);

	const resolveHostBrowserPaneContext = useCallback(async () => {
		return resolveBrowserActionsPaneContext({
			tmuxEnabled,
			tmuxTarget,
			runHostBrowserCommand,
			runWorkmuxCommand: runWorkmuxBrowserCommand,
			getErrorMessage,
		});
	}, [
		getErrorMessage,
		runHostBrowserCommand,
		runWorkmuxBrowserCommand,
		tmuxEnabled,
		tmuxTarget,
	]);

	const resolveHostBrowserWorkspace = useCallback(async () => {
		return resolveBrowserActionsWorkspace({
			tmuxEnabled,
			tmuxTarget,
			runHostBrowserCommand,
			runWorkmuxCommand: runWorkmuxBrowserCommand,
			getErrorMessage,
		});
	}, [
		getErrorMessage,
		runHostBrowserCommand,
		runWorkmuxBrowserCommand,
		tmuxEnabled,
		tmuxTarget,
	]);

	const resolveCurrentGitHubRepositoryContext = useCallback(async () => {
		return resolveGitHubRepositoryContext({
			resolvePanePath: resolveHostBrowserPanePath,
			runHostBrowserCommand,
			getErrorMessage,
		});
	}, [getErrorMessage, resolveHostBrowserPanePath, runHostBrowserCommand]);

	const resolveCurrentGitHubRepository = useCallback(async () => {
		const { repository } = await resolveCurrentGitHubRepositoryContext();
		return repository;
	}, [resolveCurrentGitHubRepositoryContext]);

	const openAndroidUrl = useCallback(
		async (url: string) => {
			try {
				await Linking.openURL(url);
			} catch (error) {
				throw new Error(
					`Android could not open ${url}: ${getErrorMessage(error)}`,
				);
			}
		},
		[getErrorMessage],
	);

	const invalidateHostUrlReads = useCallback(() => {
		hostUrlReadRequestId.invalidate();
	}, [hostUrlReadRequestId]);

	const resetHostUrlModal = useCallback(() => {
		hostUrlReadRequestId.invalidate();
		hostUrlSubmitRequestId.invalidate();
		hostUrlSubmitInFlightRef.current = false;
		setHostUrlModalState(null);
		setHostUrlModalSubmitting(false);
		setHostUrlModalError(null);
	}, [hostUrlReadRequestId, hostUrlSubmitRequestId]);

	const resetDetectedOpenRequests = useCallback(() => {
		hostDetectedOpenRequestId.invalidate();
		hostDetectedOpenInFlightRef.current = false;
		hostDetectedOpenPickerSelectionRequestId.invalidate();
		setDetectedOpenPickerState(null);
	}, [hostDetectedOpenPickerSelectionRequestId, hostDetectedOpenRequestId]);

	const openController = useCallback(() => {
		invalidateHostUrlReads();
		if (!closeOtherModals()) return;
		resetHostUrlModal();
		setOpen(true);
	}, [closeOtherModals, invalidateHostUrlReads, resetHostUrlModal]);

	const handleOpenGitHubTarget = useCallback(
		(target: GitHubRepositoryTarget) => {
			resetDetectedOpenRequests();
			runGitHubTargetOpenRequest({
				target,
				requestId: browserGitHubTargetRequestId,
				resolveRepositoryContext: resolveCurrentGitHubRepositoryContext,
				openAndroidUrl,
				showError,
				getErrorMessage,
			});
		},
		[
			browserGitHubTargetRequestId,
			getErrorMessage,
			openAndroidUrl,
			resetDetectedOpenRequests,
			resolveCurrentGitHubRepositoryContext,
			showError,
		],
	);

	const handleOpenGitHubIssuesTarget = useCallback(
		() => handleOpenGitHubTarget('issues'),
		[handleOpenGitHubTarget],
	);
	const handleOpenGitHubPullsTarget = useCallback(
		() => handleOpenGitHubTarget('pulls'),
		[handleOpenGitHubTarget],
	);

	const handleOpenHostDiffity = useCallback(() => {
		resetDetectedOpenRequests();
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef,
			hostDiffityRequestId,
			runDiffityShare: () =>
				runBrowserActionsDiffityShareWithContext({
					tmuxEnabled,
					tmuxTarget,
					runHostBrowserCommand,
					runWorkmuxCommand: runWorkmuxBrowserCommand,
					getErrorMessage,
				}),
			openAndroidUrl,
			showError: (title, message) =>
				showError({
					action: 'Diff',
					title,
					message,
				}),
			showErrorReport: (report) =>
				showError(createDiffBrowserActionErrorInput(report)),
			getErrorMessage,
		});
	}, [
		getErrorMessage,
		hostDiffityRequestId,
		openAndroidUrl,
		resetDetectedOpenRequests,
		runHostBrowserCommand,
		runWorkmuxBrowserCommand,
		showError,
		tmuxEnabled,
		tmuxTarget,
	]);

	const handleOpenDetected = useCallback(
		(mode: HostBrowserOpenMode): boolean => {
			hostDetectedOpenPickerSelectionRequestId.invalidate();
			setDetectedOpenPickerState(null);
			const result = runDetectedOpenControllerRequest({
				mode,
				inFlightRef: hostDetectedOpenInFlightRef,
				requestId: hostDetectedOpenRequestId,
				resolvePaneContext: resolveHostBrowserPaneContext,
				runHostBrowserCommand,
				setOpen,
				openUrl: openAndroidUrl,
				setPickerCandidates: (candidates, context) => {
					setDetectedOpenPickerState({ candidates, context });
				},
				showError: (title, message) =>
					showError({
						action: mode === 'pick' ? 'Pick' : 'Open',
						title,
						message,
					}),
				showErrorReport: (report) =>
					showError({
						action: mode === 'pick' ? 'Pick' : 'Open',
						title: report.title,
						message: report.message,
						panePath: report.panePath,
						command: report.command,
					}),
				getErrorMessage,
			});
			return result.accepted;
		},
		[
			getErrorMessage,
			hostDetectedOpenRequestId,
			hostDetectedOpenPickerSelectionRequestId,
			openAndroidUrl,
			resolveHostBrowserPaneContext,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleOpenDetectedAuto = useCallback(
		() => handleOpenDetected('auto'),
		[handleOpenDetected],
	);

	const handleOpenDetectedPick = useCallback(
		() => handleOpenDetected('pick'),
		[handleOpenDetected],
	);

	const handleCloseDetectedOpenPicker = useCallback(() => {
		setDetectedOpenPickerState(null);
	}, []);

	const handleSelectDetectedOpenCandidate = useCallback(
		(candidate: DetectedOpenCandidate) => {
			const state = detectedOpenPickerState;
			if (!state) return;
			const id = hostDetectedOpenPickerSelectionRequestId.next();
			setDetectedOpenPickerState(null);
			void runGuardedDetectedOpenPickerSelectionRequest({
				id,
				requestId: hostDetectedOpenPickerSelectionRequestId,
				candidate,
				context: state.context,
				runHostBrowserCommand,
				openUrl: openAndroidUrl,
				getErrorMessage,
				showPickError: (error) => {
					showError({
						action: 'Pick',
						...error,
					});
				},
			});
		},
		[
			detectedOpenPickerState,
			getErrorMessage,
			hostDetectedOpenPickerSelectionRequestId,
			openAndroidUrl,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleOpenHostUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => {
			resetDetectedOpenRequests();
			runHostUrlReadRequest({
				mode: 'open',
				slot,
				requestId: hostUrlReadRequestId,
				resolvePanePath: resolveHostBrowserPanePath,
				runHostBrowserCommand,
				openAndroidUrl,
				setOpen,
				setHostUrlModalState,
				setHostUrlModalError,
				showError,
				getErrorMessage,
			});
		},
		[
			getErrorMessage,
			hostUrlReadRequestId,
			openAndroidUrl,
			resetDetectedOpenRequests,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleEditHostUrlSlot = useCallback(
		(slot: HostBrowserUrlSlot) => {
			resetDetectedOpenRequests();
			runHostUrlReadRequest({
				mode: 'edit',
				slot,
				requestId: hostUrlReadRequestId,
				resolvePanePath: resolveHostBrowserPanePath,
				runHostBrowserCommand,
				openAndroidUrl,
				setOpen,
				setHostUrlModalState,
				setHostUrlModalError,
				showError,
				getErrorMessage,
			});
		},
		[
			getErrorMessage,
			hostUrlReadRequestId,
			openAndroidUrl,
			resetDetectedOpenRequests,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
			showError,
		],
	);

	const handleCloseHostUrlModal = useCallback(() => {
		if (hostUrlSubmitInFlightRef.current || hostUrlModalSubmitting) return;
		resetHostUrlModal();
	}, [hostUrlModalSubmitting, resetHostUrlModal]);

	const handleSubmitHostUrlModal = useCallback(
		(value: string) => {
			const state = hostUrlModalState;
			if (!state) return;
			const parsed = parseHostBrowserUrlInput(value);
			if (parsed.type === 'empty') {
				setHostUrlModalState(null);
				setHostUrlModalError(null);
				return;
			}
			if (parsed.type === 'invalid') {
				setHostUrlModalError(parsed.message);
				return;
			}
			runHostUrlSubmitRequest({
				state,
				url: parsed.url,
				hostUrlSubmitInFlightRef,
				hostUrlSubmitRequestId,
				runHostBrowserCommand,
				openAndroidUrl,
				setHostUrlModalState,
				setHostUrlModalSubmitting,
				setHostUrlModalError,
				showError,
				getErrorMessage,
			});
		},
		[
			getErrorMessage,
			hostUrlModalState,
			hostUrlSubmitRequestId,
			openAndroidUrl,
			runHostBrowserCommand,
			showError,
		],
	);

	const cleanupAllRequests = useCallback(() => {
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
	}, [
		browserGitHubTargetRequestId,
		hostDetectedOpenPickerSelectionRequestId,
		hostDetectedOpenRequestId,
		hostDiffityRequestId,
		hostUrlReadRequestId,
		hostUrlSubmitRequestId,
	]);

	const invalidateAll = useCallback(() => {
		cleanupAllRequests();
		setHostUrlModalState(null);
		setHostUrlModalSubmitting(false);
		setHostUrlModalError(null);
		setDetectedOpenPickerState(null);
	}, [cleanupAllRequests]);

	const close = useCallback(() => {
		setOpen(false);
	}, []);

	const requestSourceRef = useRef({ connection, tmuxEnabled, tmuxTarget });
	useLayoutEffect(() => {
		const previous = requestSourceRef.current;
		if (
			previous.connection === connection &&
			previous.tmuxEnabled === tmuxEnabled &&
			previous.tmuxTarget === tmuxTarget
		) {
			return;
		}
		requestSourceRef.current = { connection, tmuxEnabled, tmuxTarget };
		invalidateAll();
	}, [connection, invalidateAll, tmuxEnabled, tmuxTarget]);

	useEffect(() => cleanupAllRequests, [cleanupAllRequests]);

	const browserActionsProps = useMemo<BrowserActionsModalProps>(
		() => ({
			open,
			onClose: close,
			onOpenDiff: handleOpenHostDiffity,
			onOpenGitHubIssues: handleOpenGitHubIssuesTarget,
			onOpenGitHubPulls: handleOpenGitHubPullsTarget,
			onOpenDetectedAuto: handleOpenDetectedAuto,
			onOpenDetectedPick: handleOpenDetectedPick,
			onOpenUrlSlot: handleOpenHostUrlSlot,
			onEditUrlSlot: handleEditHostUrlSlot,
		}),
		[
			close,
			handleEditHostUrlSlot,
			handleOpenDetectedAuto,
			handleOpenDetectedPick,
			handleOpenGitHubIssuesTarget,
			handleOpenGitHubPullsTarget,
			handleOpenHostDiffity,
			handleOpenHostUrlSlot,
			open,
		],
	);

	const hostUrlProps = useMemo<HostUrlModalProps>(
		() => ({
			open: hostUrlModalState != null,
			slot: hostUrlModalState?.slot ?? null,
			slotLabel: hostUrlModalState
				? getHostBrowserUrlSlotLabel(hostUrlModalState.slot)
				: 'URL',
			initialValue: hostUrlModalState?.initialValue ?? '',
			mode: hostUrlModalState?.mode ?? 'edit',
			isSubmitting: hostUrlModalSubmitting,
			error: hostUrlModalError,
			onClose: handleCloseHostUrlModal,
			onSubmit: handleSubmitHostUrlModal,
		}),
		[
			handleCloseHostUrlModal,
			handleSubmitHostUrlModal,
			hostUrlModalError,
			hostUrlModalState,
			hostUrlModalSubmitting,
		],
	);

	const detectedOpenPickerProps = useMemo<DetectedOpenPickerModalProps>(
		() => ({
			open: detectedOpenPickerState != null,
			candidates: detectedOpenPickerState?.candidates ?? [],
			onClose: handleCloseDetectedOpenPicker,
			onSelect: handleSelectDetectedOpenCandidate,
		}),
		[
			detectedOpenPickerState,
			handleCloseDetectedOpenPicker,
			handleSelectDetectedOpenCandidate,
		],
	);

	return useMemo<BrowserActionsControllerHandle>(
		() => ({
			browserActionsProps,
			hostUrlProps,
			detectedOpenPickerProps,
			open: openController,
			close,
			resolveHostBrowserPaneContext,
			resolveHostBrowserPanePath,
			resolveHostBrowserWorkspace,
			resolveCurrentGitHubRepository,
			runHostBrowserCommand,
			invalidateHostUrlReads,
			invalidateAll,
		}),
		[
			browserActionsProps,
			close,
			detectedOpenPickerProps,
			hostUrlProps,
			invalidateAll,
			invalidateHostUrlReads,
			openController,
			resolveCurrentGitHubRepository,
			resolveHostBrowserPaneContext,
			resolveHostBrowserPanePath,
			resolveHostBrowserWorkspace,
			runHostBrowserCommand,
		],
	);
}
