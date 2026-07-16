import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from './host-browser-actions';
import { unwrapControllerOutput } from './shell-controllers/controller-outcome';
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
			return unwrapControllerOutput(result, {
				superseded: 'Workmux command superseded.',
				unavailable: 'Workmux command unavailable.',
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(formatWorkmuxAppCommandFailureMessage(message));
		}
	}

	const result = await hostCommands.run(command, timeoutMs);
	return unwrapControllerOutput(result, {
		superseded: 'Host command superseded.',
		unavailable: HOST_BROWSER_NO_CONNECTION_MESSAGE,
	}).trim();
}
