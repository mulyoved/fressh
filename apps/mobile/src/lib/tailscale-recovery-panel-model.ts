import {
	getTailscaleRecoveryBannerPresentation,
	type TailscaleRecoveryBannerState,
} from './TailscaleRecoveryBannerPresentation';
import { type TailscaleRecoveryUiActions } from './tailscale-recovery-ui-store';

export type TailscaleRecoveryPanelHandlers = {
	openTailscale?: () => void;
	retry?: () => void;
	reset?: () => void;
};

type TailscaleRecoveryPanelPresentation = Exclude<
	ReturnType<typeof getTailscaleRecoveryBannerPresentation>,
	{ visible: false }
>;

export type TailscaleRecoveryPanelModel =
	| { visible: false }
	| {
			visible: true;
			presentation: TailscaleRecoveryPanelPresentation;
			handlers?: TailscaleRecoveryPanelHandlers;
	  };

export function getTailscaleRecoveryPanelModel(input: {
	state: TailscaleRecoveryBannerState;
	colors: Parameters<typeof getTailscaleRecoveryBannerPresentation>[1];
	actions: TailscaleRecoveryUiActions | null;
}): TailscaleRecoveryPanelModel {
	const presentation = getTailscaleRecoveryBannerPresentation(
		input.state,
		input.colors,
		{ actionsAvailable: input.actions !== null },
	);

	if (!presentation.visible) return { visible: false };

	return {
		visible: true,
		presentation,
		handlers: input.actions
			? {
					openTailscale: input.actions.openTailscale,
					retry: input.actions.retry,
					reset: input.actions.reset,
				}
			: undefined,
	};
}
