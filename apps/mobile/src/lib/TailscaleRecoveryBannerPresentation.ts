export type TailscaleRecoveryBannerState =
	| { phase: 'hidden' }
	| { phase: 'needsAttention'; message: string }
	| { phase: 'recovering'; message: string };

export type TailscaleRecoveryBannerActionId =
	| 'openTailscale'
	| 'retry'
	| 'reset';

type TailscaleRecoveryBannerAction = {
	id: TailscaleRecoveryBannerActionId;
	label: string;
	disabled: boolean;
};

export type TailscaleRecoveryBannerPresentation =
	| { visible: false }
	| {
			visible: true;
			title: string;
			message: string;
			actions: readonly [
				TailscaleRecoveryBannerAction,
				TailscaleRecoveryBannerAction,
				TailscaleRecoveryBannerAction,
			];
			primaryBackgroundColor: string;
	  };

type TailscaleRecoveryBannerColors = {
	primary: string;
	primaryDisabled: string;
};

type TailscaleRecoveryBannerPresentationOptions = {
	actionsAvailable?: boolean;
};

export function getTailscaleRecoveryBannerPresentation(
	state: TailscaleRecoveryBannerState,
	colors: TailscaleRecoveryBannerColors,
	options: TailscaleRecoveryBannerPresentationOptions = {},
): TailscaleRecoveryBannerPresentation {
	if (state.phase === 'hidden') return { visible: false };

	const disabled =
		state.phase === 'recovering' || options.actionsAvailable === false;
	return {
		visible: true,
		title: 'Tailscale connection needs attention',
		message: state.message,
		primaryBackgroundColor: disabled ? colors.primaryDisabled : colors.primary,
		actions: [
			{
				id: 'openTailscale',
				label: 'Open Tailscale',
				disabled,
			},
			{ id: 'retry', label: 'Retry', disabled },
			{ id: 'reset', label: 'Reset', disabled },
		],
	};
}
