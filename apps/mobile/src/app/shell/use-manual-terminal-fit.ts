import { useLayoutEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import {
	type ShellHostCommandPort,
	type ShellTerminalSourcePort,
} from '@/lib/shell-controllers/session-contracts';
import { type ShellTerminalControllerHandle } from '@/lib/shell-controllers/terminal';
import {
	createManualTerminalFitRunner,
	type ManualTerminalFitRunner,
} from '@/lib/terminal-fit-runner';

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

export function useManualTerminalFit({
	hostCommands,
	terminalSource,
	terminal,
	tmuxEnabled,
	tmuxTarget,
}: {
	hostCommands: ShellHostCommandPort | null;
	terminalSource: ShellTerminalSourcePort;
	terminal: Pick<
		ShellTerminalControllerHandle,
		'getLastSize' | 'view' | 'waitForSizeAfterFit'
	>;
	tmuxEnabled: boolean;
	tmuxTarget: string;
}): ManualTerminalFitRunner {
	const { getLastSize, view, waitForSizeAfterFit } = terminal;
	const runner = useMemo(
		() =>
			createManualTerminalFitRunner({
				getHostCommands: () => hostCommands,
				isTmuxEnabled: () => tmuxEnabled,
				getTerminalSize: getLastSize,
				getXterm: () => view,
				getTargetName: () => tmuxTarget.trim() || 'main',
				waitForTerminalSizeAfterFit: waitForSizeAfterFit,
				resizePty: async (cols, rows) => {
					if (!terminalSource.isAvailable()) {
						throw new Error('No shell is available.');
					}
					await terminalSource.resizePty(cols, rows);
				},
				showFailure: (title, message) => Alert.alert(title, message),
				getErrorMessage,
			}),
		[
			getLastSize,
			hostCommands,
			terminalSource,
			tmuxEnabled,
			tmuxTarget,
			view,
			waitForSizeAfterFit,
		],
	);
	useLayoutEffect(() => () => runner.cancelCurrent(), [runner]);
	return runner;
}
