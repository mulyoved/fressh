import {
	attemptSavedEntryWithTailscaleRecovery,
	type SavedEntryConnectAttemptPhase,
	type SavedEntryConnectResult,
	type SavedEntryTailscaleRecovery,
} from './auto-connect-saved-entry';
import { type ConnectAndOpenShellResult } from './connect-and-open-shell';

export type ManualConnectResult = ConnectAndOpenShellResult;
export type ManualConnectAttemptPhase = SavedEntryConnectAttemptPhase;

type ManualConnectRecoveryLogger = {
	warn: (message: string, error: unknown) => void;
};

export async function connectWithTailscaleRecovery(args: {
	platformOS: string;
	recovery: SavedEntryTailscaleRecovery;
	connect: (phase: ManualConnectAttemptPhase) => Promise<ManualConnectResult>;
	onAttention?: (message: string) => void;
	onClearAttention?: () => void;
	logger?: ManualConnectRecoveryLogger;
}): Promise<ManualConnectResult> {
	const outcome = await attemptSavedEntryWithTailscaleRecovery({
		platformOS: args.platformOS,
		recovery: args.recovery,
		connectSavedEntry: async (phase) =>
			(await args.connect(phase)) as SavedEntryConnectResult,
	});

	switch (outcome.status) {
		case 'connected':
		case 'tmuxAttachFailed':
		case 'aborted':
			args.onClearAttention?.();
			return outcome.result as ManualConnectResult;
		case 'blocked': {
			if (outcome.attentionMessage !== null) {
				args.onAttention?.(outcome.attentionMessage);
				throw new Error(outcome.attentionMessage);
			}
			throw new Error('Tailscale recovery blocked SSH connect.');
		}
		case 'recoveryNotAttempted':
			if (outcome.attentionMessage !== null) {
				args.onAttention?.(outcome.attentionMessage);
			}
			throw outcome.error;
		case 'retryFailed':
			if (outcome.attentionMessage !== null) {
				args.onAttention?.(outcome.attentionMessage);
			}
			args.logger?.warn('Manual connect failed after Tailscale recovery', {
				error: outcome.error,
				recoveryResult: outcome.recoveryResult,
			});
			throw outcome.error;
		case 'threw':
			throw outcome.error;
	}
}
