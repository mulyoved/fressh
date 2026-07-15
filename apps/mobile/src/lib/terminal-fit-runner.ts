import { matchControllerOutcome } from './shell-controllers/controller-outcome';
import { type ShellHostCommandPort } from './shell-controllers/session-contracts';
import { buildDirectTmuxResizeWindowCommand } from './workmux-direct-tmux-control';

export type TerminalFitSize = {
	cols: number;
	rows: number;
};

export type ManualTerminalFitXterm = {
	fit: () => void;
};

export type ManualTerminalFitRunnerDeps = {
	getHostCommands: () => ShellHostCommandPort | null;
	isTmuxEnabled: () => boolean;
	getTerminalSize: () => TerminalFitSize | null;
	getXterm: () => ManualTerminalFitXterm | null;
	getTargetName: () => string;
	waitForTerminalSizeAfterFit?: () => Promise<TerminalFitSize | null>;
	resizePty: (cols: number, rows: number) => Promise<void>;
	showFailure: (title: string, message: string) => void;
	getErrorMessage: (error: unknown) => string;
};

export type ManualTerminalFitRunner = {
	run: () => Promise<void>;
	cancelCurrent: () => void;
};

const TERMINAL_FIT_TMUX_RESIZE_TIMEOUT_MS = 30_000;

export function createManualTerminalFitRunner(
	deps: ManualTerminalFitRunnerDeps,
): ManualTerminalFitRunner {
	let generation = 0;
	const isCurrent = (runGeneration: number) => generation === runGeneration;

	return {
		run: async () => {
			const runGeneration = ++generation;
			const xterm = deps.getXterm();
			if (!xterm) {
				deps.showFailure(
					'Fit terminal failed',
					'Terminal view is not ready yet. Try again.',
				);
				return;
			}

			try {
				const terminalSizeAfterFit = deps.waitForTerminalSizeAfterFit?.();
				xterm.fit();
				const terminalSize =
					(await terminalSizeAfterFit) ?? deps.getTerminalSize();
				if (!isCurrent(runGeneration)) return;
				if (!terminalSize) {
					deps.showFailure(
						'Fit terminal failed',
						'Terminal size is not ready yet. Try again.',
					);
					return;
				}

				await deps.resizePty(terminalSize.cols, terminalSize.rows);
				if (!isCurrent(runGeneration)) return;

				if (!deps.isTmuxEnabled()) {
					return;
				}

				const hostCommands = deps.getHostCommands();
				if (!hostCommands) {
					deps.showFailure(
						'Fit terminal failed',
						'No SSH connection is available.',
					);
					return;
				}

				const command = buildDirectTmuxResizeWindowCommand({
					targetName: deps.getTargetName(),
					cols: terminalSize.cols,
					rows: terminalSize.rows,
				});
				const result = await hostCommands.run(
					command,
					TERMINAL_FIT_TMUX_RESIZE_TIMEOUT_MS,
				);
				if (!isCurrent(runGeneration)) return;

				return matchControllerOutcome(result, {
					completed: () => {},
					superseded: () => {},
					failed: ({ failure }) =>
						deps.showFailure('Fit terminal failed', failure.message),
					unavailable: () =>
						deps.showFailure(
							'Fit terminal failed',
							'No SSH connection is available.',
						),
				});
			} catch (error) {
				if (!isCurrent(runGeneration)) return;
				deps.showFailure('Fit terminal failed', deps.getErrorMessage(error));
			}
		},
		cancelCurrent: () => {
			generation += 1;
		},
	};
}
