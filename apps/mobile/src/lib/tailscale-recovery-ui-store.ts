import { create } from 'zustand';
import { type TailscaleRecoveryBannerState } from './TailscaleRecoveryBannerPresentation';

export type TailscaleRecoveryUiActions = {
	openTailscale: () => void;
	retry: () => void;
	reset: () => void;
};

type TailscaleRecoveryUiStore = {
	recoveryState: TailscaleRecoveryBannerState;
	actions: TailscaleRecoveryUiActions | null;
	setRecoveryState: (state: TailscaleRecoveryBannerState) => void;
	clearRecoveryState: () => void;
	setActions: (actions: TailscaleRecoveryUiActions) => void;
	clearActions: () => void;
};

export const hiddenTailscaleRecoveryUiState: TailscaleRecoveryBannerState = {
	phase: 'hidden',
};

export const useTailscaleRecoveryUiStore = create<TailscaleRecoveryUiStore>(
	(set) => ({
		recoveryState: hiddenTailscaleRecoveryUiState,
		actions: null,
		setRecoveryState: (state) => set({ recoveryState: state }),
		clearRecoveryState: () =>
			set({ recoveryState: hiddenTailscaleRecoveryUiState }),
		setActions: (actions) => set({ actions }),
		clearActions: () => set({ actions: null }),
	}),
);
