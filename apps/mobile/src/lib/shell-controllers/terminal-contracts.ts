import { type TerminalRuntimeKey } from './terminal-transport';

export type ShellTerminalViewPort = {
	getRuntimeKey(): TerminalRuntimeKey | null;
	getRuntimeInstanceId(): string | null;
	getSelectionModeEnabled(): boolean;
	isCurrentInstance(instanceId: string): boolean;
	fit(): void;
	setSystemKeyboardEnabled(enabled: boolean): void;
	setSelectionModeEnabled(enabled: boolean): void;
	getSelection(): Promise<string>;
	exitScrollback(message: { requestId: number; instanceId?: string }): void;
	sendScrollbackEnterAck(requestId: number, instanceId: string): void;
};
