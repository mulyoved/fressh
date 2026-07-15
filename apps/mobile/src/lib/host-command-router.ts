import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from './host-browser-actions';
import {
	type ShellHostCommandPort,
	type ShellWorkmuxPort,
} from './shell-controllers/session-contracts';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	formatWorkmuxAppCommandFailureMessage,
	isWorkmuxAppCommand,
	parseWorkmuxAppCommandArgv,
} from './workmux-app-commands';

export async function runHostCommandWithBoundary({
	hostCommands,
	command,
	timeoutMs,
	workmux,
}: {
	hostCommands: ShellHostCommandPort | null;
	command: string;
	timeoutMs: number;
	workmux?: Pick<ShellWorkmuxPort, 'command'>;
}): Promise<string> {
	if (!hostCommands) {
		throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
	}

	if (isWorkmuxAppCommand(command)) {
		try {
			const argv = parseWorkmuxAppCommandArgv(command);
			if (!argv || !workmux) {
				throw new Error(WORKMUX_APP_COMMAND_UPDATE_MESSAGE);
			}
			const result = await workmux.command(argv, { timeoutMs });
			if (result.status === 'completed') return result.output ?? '';
			if (result.status === 'failed') throw new Error(result.failure.message);
			throw new Error(
				result.status === 'superseded'
					? 'Workmux command superseded.'
					: 'Workmux command unavailable.',
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(formatWorkmuxAppCommandFailureMessage(message));
		}
	}

	const result = await hostCommands.run(command, timeoutMs);
	if (result.status !== 'completed') {
		throw new Error(
			result.status === 'failed'
				? result.failure.message
				: result.status === 'superseded'
					? 'Host command superseded.'
					: HOST_BROWSER_NO_CONNECTION_MESSAGE,
		);
	}
	return (result.output ?? '').trim();
}
