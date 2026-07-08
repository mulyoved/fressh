import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTailscaleRecoveryBannerPresentation } from '../../src/lib/TailscaleRecoveryBannerPresentation';

const colors = {
	primary: '#2563EB',
	primaryDisabled: '#93C5FD',
};

void test('Tailscale recovery banner presentation hides hidden state', () => {
	assert.deepEqual(
		getTailscaleRecoveryBannerPresentation({ phase: 'hidden' }, colors),
		{ visible: false },
	);
});

void test('Tailscale recovery banner presentation exposes enabled actions', () => {
	assert.deepEqual(
		getTailscaleRecoveryBannerPresentation(
			{
				phase: 'needsAttention',
				message: 'Open Tailscale, then retry Fressh.',
			},
			colors,
		),
		{
			visible: true,
			title: 'Tailscale connection needs attention',
			message: 'Open Tailscale, then retry Fressh.',
			primaryBackgroundColor: colors.primary,
			actions: [
				{
					id: 'openTailscale',
					label: 'Open Tailscale',
					disabled: false,
				},
				{
					id: 'retry',
					label: 'Retry',
					disabled: false,
				},
				{
					id: 'reset',
					label: 'Reset',
					disabled: false,
				},
			],
		},
	);
});

void test('Tailscale recovery banner presentation disables recovering actions', () => {
	const presentation = getTailscaleRecoveryBannerPresentation(
		{
			phase: 'recovering',
			message: 'Resetting Tailscale...',
		},
		colors,
	);

	assert.equal(presentation.visible, true);
	if (!presentation.visible) return;

	assert.equal(presentation.message, 'Resetting Tailscale...');
	assert.equal(presentation.primaryBackgroundColor, colors.primaryDisabled);
	assert.deepEqual(
		presentation.actions.map((action) => ({
			id: action.id,
			disabled: action.disabled,
		})),
		[
			{ id: 'openTailscale', disabled: true },
			{ id: 'retry', disabled: true },
			{ id: 'reset', disabled: true },
		],
	);
});

void test('Tailscale recovery presentation disables visible actions when handlers are unavailable', () => {
	const presentation = getTailscaleRecoveryBannerPresentation(
		{
			phase: 'needsAttention',
			message: 'Open Tailscale, then retry Fressh.',
		},
		colors,
		{ actionsAvailable: false },
	);

	assert.equal(presentation.visible, true);
	if (!presentation.visible) return;

	assert.equal(presentation.primaryBackgroundColor, colors.primaryDisabled);
	assert.deepEqual(
		presentation.actions.map((action) => ({
			id: action.id,
			disabled: action.disabled,
		})),
		[
			{ id: 'openTailscale', disabled: true },
			{ id: 'retry', disabled: true },
			{ id: 'reset', disabled: true },
		],
	);
});
