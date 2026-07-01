import { copyConnectionIdentity } from './identity';
import { serializeConnectionDiagnosticError } from './snapshot';
import {
	type ConnectionDiagnosticConnectionIdentity,
	type ConnectionDiagnosticError,
	type ConnectionDiagnosticEventBase,
	type ConnectionDiagnosticSource,
} from './types';

export type ManualDiagnosticSavedEntryMissingEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.saved-entry.missing';
	};

export type ManualDiagnosticTailscaleAttentionEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tailscale.attention';
		message: string;
	};

export type ManualDiagnosticTailscaleAttentionClearedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tailscale.attention-cleared';
	};

export type ManualDiagnosticTmuxAttachFailedEvent =
	ConnectionDiagnosticEventBase & {
		kind: 'manual-diagnostic.tmux-attach-failed';
		connection: ConnectionDiagnosticConnectionIdentity;
		tmuxAttachFailureReason: string | null;
	};

export type ManualDiagnosticWarningEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.warning';
	message: string;
	error: ConnectionDiagnosticError;
};

export type ManualDiagnosticTimeoutEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.timeout';
	message: string;
	timeoutMs: number;
};

export type ManualDiagnosticFailedEvent = ConnectionDiagnosticEventBase & {
	kind: 'manual-diagnostic.failed';
	error: ConnectionDiagnosticError;
};

export type ManualDiagnosticEvent =
	| ManualDiagnosticSavedEntryMissingEvent
	| ManualDiagnosticTailscaleAttentionEvent
	| ManualDiagnosticTailscaleAttentionClearedEvent
	| ManualDiagnosticTmuxAttachFailedEvent
	| ManualDiagnosticWarningEvent
	| ManualDiagnosticTimeoutEvent
	| ManualDiagnosticFailedEvent;

export const manualDiagnosticEventKinds = [
	'manual-diagnostic.saved-entry.missing',
	'manual-diagnostic.tailscale.attention',
	'manual-diagnostic.tailscale.attention-cleared',
	'manual-diagnostic.tmux-attach-failed',
	'manual-diagnostic.warning',
	'manual-diagnostic.timeout',
	'manual-diagnostic.failed',
] as const satisfies readonly ManualDiagnosticEvent['kind'][];

const withSource = <T extends ManualDiagnosticEvent>(event: T): T => event;

export const manualDiagnosticEvents = {
	savedEntryMissing: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): ManualDiagnosticSavedEntryMissingEvent =>
		withSource({
			kind: 'manual-diagnostic.saved-entry.missing',
			source: input.source,
			message: input.message,
		}),
	tailscaleAttention: (input: {
		source: ConnectionDiagnosticSource;
		message: string;
	}): ManualDiagnosticTailscaleAttentionEvent =>
		withSource({
			kind: 'manual-diagnostic.tailscale.attention',
			source: input.source,
			message: input.message,
		}),
	tailscaleAttentionCleared: (input: {
		source: ConnectionDiagnosticSource;
		message?: string;
	}): ManualDiagnosticTailscaleAttentionClearedEvent =>
		withSource({
			kind: 'manual-diagnostic.tailscale.attention-cleared',
			source: input.source,
			message: input.message,
		}),
	tmuxAttachFailed: (input: {
		source: ConnectionDiagnosticSource;
		connection: ConnectionDiagnosticConnectionIdentity;
		tmuxAttachFailureReason: string | null;
		message?: string;
	}): ManualDiagnosticTmuxAttachFailedEvent =>
		withSource({
			kind: 'manual-diagnostic.tmux-attach-failed',
			source: input.source,
			message: input.message,
			connection: copyConnectionIdentity(input.connection),
			tmuxAttachFailureReason: input.tmuxAttachFailureReason,
		}),
	warning: (input: {
		source: ConnectionDiagnosticSource;
		message: string;
		error: unknown;
	}): ManualDiagnosticWarningEvent =>
		withSource({
			kind: 'manual-diagnostic.warning',
			source: input.source,
			message: input.message,
			error: serializeConnectionDiagnosticError(input.error),
		}),
	timeout: (input: {
		timeoutMs: number;
		message: string;
	}): ManualDiagnosticTimeoutEvent =>
		withSource({
			kind: 'manual-diagnostic.timeout',
			source: 'manual-diagnostic',
			timeoutMs: input.timeoutMs,
			message: input.message,
		}),
	failed: (input: {
		source: ConnectionDiagnosticSource;
		error: unknown;
		message?: string;
	}): ManualDiagnosticFailedEvent =>
		withSource({
			kind: 'manual-diagnostic.failed',
			source: input.source,
			message: input.message,
			error: serializeConnectionDiagnosticError(input.error),
		}),
} as const;
