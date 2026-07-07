import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTailscaleRecoveryPanelModel } from '../../src/lib/TailscaleRecoveryPanel';

const colors = {
	primary: '#2563EB',
	primaryDisabled: '#93C5FD',
};

void test('Tailscale recovery panel model hides hidden state', () => {
	assert.deepEqual(
		getTailscaleRecoveryPanelModel({
			state: { phase: 'hidden' },
			colors,
			actions: null,
		}),
		{ visible: false },
	);
});

void test('Tailscale recovery panel model disables actions when handlers are unavailable', () => {
	const model = getTailscaleRecoveryPanelModel({
		state: {
			phase: 'needsAttention',
			message: 'Open Tailscale, then retry Fressh.',
		},
		colors,
		actions: null,
	});

	assert.equal(model.visible, true);
	if (!model.visible) return;

	assert.equal(model.handlers, undefined);
	assert.equal(
		model.presentation.primaryBackgroundColor,
		colors.primaryDisabled,
	);
	assert.deepEqual(
		model.presentation.actions.map((action) => ({
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

void test('Tailscale recovery panel model wires enabled handlers', () => {
	const calls: string[] = [];
	const model = getTailscaleRecoveryPanelModel({
		state: {
			phase: 'needsAttention',
			message: 'Open Tailscale, then retry Fressh.',
		},
		colors,
		actions: {
			openTailscale: () => calls.push('open'),
			retry: () => calls.push('retry'),
			reset: () => calls.push('reset'),
		},
	});

	assert.equal(model.visible, true);
	if (!model.visible) return;

	assert.equal(typeof model.handlers?.openTailscale, 'function');
	assert.equal(typeof model.handlers?.retry, 'function');
	assert.equal(typeof model.handlers?.reset, 'function');
	assert.deepEqual(
		model.presentation.actions.map((action) => ({
			id: action.id,
			disabled: action.disabled,
		})),
		[
			{ id: 'openTailscale', disabled: false },
			{ id: 'retry', disabled: false },
			{ id: 'reset', disabled: false },
		],
	);

	model.handlers?.openTailscale?.();
	model.handlers?.retry?.();
	model.handlers?.reset?.();

	assert.deepEqual(calls, ['open', 'retry', 'reset']);
});

void test('Tailscale recovery panel model keeps recovering actions disabled', () => {
	const calls: string[] = [];
	const model = getTailscaleRecoveryPanelModel({
		state: {
			phase: 'recovering',
			message: 'Resetting Tailscale...',
		},
		colors,
		actions: {
			openTailscale: () => calls.push('open'),
			retry: () => calls.push('retry'),
			reset: () => calls.push('reset'),
		},
	});

	assert.equal(model.visible, true);
	if (!model.visible) return;

	assert.equal(typeof model.handlers?.openTailscale, 'function');
	assert.equal(typeof model.handlers?.retry, 'function');
	assert.equal(typeof model.handlers?.reset, 'function');
	assert.equal(model.presentation.primaryBackgroundColor, colors.primaryDisabled);
	assert.deepEqual(
		model.presentation.actions.map((action) => ({
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
