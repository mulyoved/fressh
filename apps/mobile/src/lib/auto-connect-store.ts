import { create } from 'zustand';
import {
	type ConnectionDiagnosticEvent,
	type ConnectionDiagnosticTraceHandle,
} from './connection-diagnostic-types';
import { markTailscaleRecoveryUiNeedsAttention } from './tailscale-recovery-ui-store';

type AutoConnectState = {
	activeDiagnosticTrace: ConnectionDiagnosticTraceHandle | null;
	isAutoConnecting: boolean;
	isReconnecting: boolean;
	lastReconnectOutcome: null | {
		status: string;
		message?: string;
		destination: 'terminal' | 'hostPage';
	};
	lastReconnectDestination: 'terminal' | 'hostPage' | null;
	setActiveDiagnosticTrace: (
		trace: ConnectionDiagnosticTraceHandle | null,
	) => void;
	setAutoConnecting: (next: boolean) => void;
	setReconnecting: (next: boolean) => void;
	setLastReconnectOutcome: (
		outcome: AutoConnectState['lastReconnectOutcome'],
	) => void;
};

export const useAutoConnectStore = create<AutoConnectState>((set) => ({
	activeDiagnosticTrace: null,
	isAutoConnecting: false,
	isReconnecting: false,
	lastReconnectOutcome: null,
	lastReconnectDestination: null,
	setActiveDiagnosticTrace: (trace) => set({ activeDiagnosticTrace: trace }),
	setAutoConnecting: (next) => set({ isAutoConnecting: next }),
	setReconnecting: (next) => set({ isReconnecting: next }),
	setLastReconnectOutcome: (outcome) =>
		set({
			lastReconnectOutcome: outcome,
			lastReconnectDestination: outcome?.destination ?? null,
		}),
}));

export function handleAutoConnectReconnectTraceEvent(
	event: ConnectionDiagnosticEvent,
): void {
	if (event.kind === 'reconnect.started') {
		useAutoConnectStore.getState().setLastReconnectOutcome(null);
		return;
	}
	if (event.kind !== 'reconnect.completed') return;
	if (event.outcome === 'connected') {
		useAutoConnectStore.getState().setLastReconnectOutcome(null);
		return;
	}
	useAutoConnectStore.getState().setLastReconnectOutcome({
		status: event.outcome,
		message: event.message,
		destination: event.destination,
	});
	if (event.destination === 'hostPage' && event.outcome === 'needsAttention') {
		markTailscaleRecoveryUiNeedsAttention(
			event.message || 'Tailscale connection needs attention.',
		);
	}
}
