import {
	TERMINAL_REFLOW_HISTORY_LINES,
	formatTerminalReflowSnapshot,
} from './terminal-reflow';
import { buildDirectTmuxCapturePaneCommand } from './workmux-direct-tmux-control';

export type TerminalReflowPaneContext = {
	paneId: string;
};

export type TerminalReflowSize = {
	cols: number;
	rows: number;
};

export type ManualTerminalReflowXterm = {
	clear: () => void;
	write: (bytes: Uint8Array) => void;
	flush: () => void;
	fit: () => void;
};

export type ManualTerminalReflowSideChannelResult = {
	success: boolean;
	output: string;
	error?: string;
};

export type ManualTerminalReflowRunnerDeps<Connection> = {
	getConnection: () => Connection | null;
	isTmuxEnabled: () => boolean;
	getTerminalSize: () => TerminalReflowSize | null;
	getXterm: () => ManualTerminalReflowXterm | null;
	resolvePaneContext: () => Promise<TerminalReflowPaneContext>;
	executeSideChannelCommand: (
		connection: Connection,
		command: string,
		timeoutMs?: number,
	) => Promise<ManualTerminalReflowSideChannelResult>;
	beginLiveBuffer: () => void;
	endLiveBuffer: () => Uint8Array[];
	showFailure: (title: string, message: string) => void;
	getErrorMessage: (error: unknown) => string;
};

export type ManualTerminalReflowRunner = {
	run: () => Promise<void>;
};

const TERMINAL_REFLOW_CAPTURE_TIMEOUT_MS = 30_000;

export function createManualTerminalReflowRunner<Connection>(
	deps: ManualTerminalReflowRunnerDeps<Connection>,
): ManualTerminalReflowRunner {
	return {
		run: async () => {
			const xterm = deps.getXterm();
			if (!xterm) {
				deps.showFailure(
					'Reflow terminal failed',
					'Terminal view is not ready yet. Try again.',
				);
				return;
			}

			const connection = deps.getConnection();
			if (!connection) {
				deps.showFailure(
					'Reflow terminal failed',
					'No SSH connection is available.',
				);
				return;
			}

			if (!deps.isTmuxEnabled()) {
				deps.showFailure(
					'Reflow terminal unavailable',
					'Reflow terminal requires a Workmux-enabled connection.',
				);
				return;
			}

			const terminalSize = deps.getTerminalSize();
			if (!terminalSize) {
				xterm.fit();
				deps.showFailure(
					'Reflow terminal failed',
					'Terminal size is not ready yet. Try again.',
				);
				return;
			}

			let liveChunks: Uint8Array[] = [];
			let buffering = false;
			try {
				deps.beginLiveBuffer();
				buffering = true;

				const paneContext = await deps.resolvePaneContext();
				const command = buildDirectTmuxCapturePaneCommand({
					paneId: paneContext.paneId,
					historyLines: TERMINAL_REFLOW_HISTORY_LINES,
				});
				const result = await deps.executeSideChannelCommand(
					connection,
					command,
					TERMINAL_REFLOW_CAPTURE_TIMEOUT_MS,
				);

				if (!result.success) {
					liveChunks = deps.endLiveBuffer();
					buffering = false;
					writeBufferedLiveChunks(xterm, liveChunks);
					deps.showFailure(
						'Reflow terminal failed',
						result.error ?? 'Could not capture the active tmux pane.',
					);
					return;
				}

				const snapshot = formatTerminalReflowSnapshot(
					result.output,
					terminalSize.cols,
				);
				if (snapshot.length === 0) {
					liveChunks = deps.endLiveBuffer();
					buffering = false;
					writeBufferedLiveChunks(xterm, liveChunks);
					deps.showFailure(
						'Reflow terminal failed',
						'Captured pane text was empty.',
					);
					return;
				}

				liveChunks = deps.endLiveBuffer();
				buffering = false;
				xterm.clear();
				xterm.write(snapshot);
				xterm.flush();
				writeBufferedLiveChunks(xterm, liveChunks);
			} catch (error) {
				if (buffering) {
					liveChunks = deps.endLiveBuffer();
					buffering = false;
				}
				writeBufferedLiveChunks(xterm, liveChunks);
				deps.showFailure('Reflow terminal failed', deps.getErrorMessage(error));
			}
		},
	};
}

function writeBufferedLiveChunks(
	xterm: ManualTerminalReflowXterm,
	chunks: Uint8Array[],
) {
	for (const chunk of chunks) {
		xterm.write(chunk);
	}
	if (chunks.length > 0) {
		xterm.flush();
	}
}
