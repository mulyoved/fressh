export type ConnectionDiagnosticDeliveryResult =
	| { status: 'pasted' }
	| { status: 'copied' }
	| { status: 'copy-failed'; error: string };

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function deliverConnectionDiagnosticPrompt({
	prompt,
	allowTerminalPaste,
	pasteIntoTerminal,
	copyToClipboard,
	showAlert,
}: {
	prompt: string;
	allowTerminalPaste: boolean;
	pasteIntoTerminal: (value: string) => void;
	copyToClipboard: (value: string) => Promise<void>;
	showAlert: (title: string, message: string) => void;
}): Promise<ConnectionDiagnosticDeliveryResult> {
	if (allowTerminalPaste) {
		try {
			pasteIntoTerminal(prompt);
			return { status: 'pasted' };
		} catch (error) {
			const message = getErrorMessage(error);
			try {
				await copyToClipboard(prompt);
				showAlert(
					'Connection debug prompt copied',
					`Pasting into the terminal failed: ${message}\n\nThe prompt was copied to the clipboard instead.`,
				);
				return { status: 'copied' };
			} catch (copyError) {
				const copyMessage = getErrorMessage(copyError);
				showAlert('Connection debug prompt copy failed', copyMessage);
				return { status: 'copy-failed', error: copyMessage };
			}
		}
	}

	try {
		await copyToClipboard(prompt);
		showAlert(
			'Connection debug prompt copied',
			'Paste the copied prompt into Codex when you have a Codex TUI ready.',
		);
		return { status: 'copied' };
	} catch (error) {
		const message = getErrorMessage(error);
		showAlert('Connection debug prompt copy failed', message);
		return { status: 'copy-failed', error: message };
	}
}
