import {
	type ShellWorkmuxOutcome,
	type ShellWorkmuxScrollPort,
} from '../../../src/lib/shell-controllers/session-contracts';
import { createWorkmuxScrollbackCommandExecutor as createBaseWorkmuxScrollbackCommandExecutor } from '../../../src/lib/workmux-scrollback-executor';

const enterText = (sessionName = 'main') => `enter:${sessionName}`;
const exitText = (sessionName = 'main') => `exit:${sessionName}`;

export function createRecordingScrollTransport(
	executeCommand: (command: string) => Promise<ShellWorkmuxOutcome>,
): ShellWorkmuxScrollPort {
	return {
		enter: ({ sessionName }) => executeCommand(enterText(sessionName)),
		move: ({ sessionName, direction, unit, count }) =>
			executeCommand(`move:${sessionName}:${direction}:${unit}:${count}`),
		exit: ({ sessionName }) => executeCommand(exitText(sessionName)),
	};
}

export function createWorkmuxScrollbackCommandExecutor({
	executeCommand,
	...options
}: Omit<
	Parameters<typeof createBaseWorkmuxScrollbackCommandExecutor>[0],
	'scrollTransport'
> & {
	executeCommand: (command: string) => Promise<ShellWorkmuxOutcome>;
}) {
	return createBaseWorkmuxScrollbackCommandExecutor({
		...options,
		scrollTransport: createRecordingScrollTransport(executeCommand),
	});
}

export const remoteCopyModeOwnership = (
	active: { current: boolean },
	generation: { current: number },
) => ({
	acquire: () => {
		generation.current += 1;
		active.current = true;
		return Object.freeze({ generation: generation.current });
	},
});
