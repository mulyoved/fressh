// eslint-disable-next-line import/consistent-type-specifier-style -- A pure type import keeps diagnostics Node-testable.
import type { XtermOutputDiagnostics } from '@fressh/react-native-xtermjs-webview';
import { type ShellTerminalNativeOutputDiagnostics } from './session-contracts';

export type TerminalOutputDiagnosticSnapshot = {
	connectionId: string;
	channelId: number;
	runtimeInstanceId: string | null;
	native: ShellTerminalNativeOutputDiagnostics;
	listener: {
		events: number;
		bytes: number;
		lastSeq: string | null;
		droppedEvents: number;
	};
	xterm: XtermOutputDiagnostics | null;
};
