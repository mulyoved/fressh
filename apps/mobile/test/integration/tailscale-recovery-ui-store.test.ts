import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	hiddenTailscaleRecoveryUiState,
	type TailscaleRecoveryUiActions,
	useTailscaleRecoveryUiStore,
} from '../../src/lib/tailscale-recovery-ui-store';

function resetStore() {
	useTailscaleRecoveryUiStore.setState({
		recoveryState: hiddenTailscaleRecoveryUiState,
		actions: null,
	});
}

beforeEach(() => {
	resetStore();
});

void test('Tailscale recovery UI store starts hidden without actions', () => {
	const state = useTailscaleRecoveryUiStore.getState();

	assert.deepEqual(state.recoveryState, { phase: 'hidden' });
	assert.equal(state.actions, null);
});

void test('Tailscale recovery UI store exposes attention and recovering states', () => {
	const store = useTailscaleRecoveryUiStore.getState();

	store.setRecoveryState({
		phase: 'needsAttention',
		message: 'Open Tailscale, then retry Fressh.',
	});
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'needsAttention',
		message: 'Open Tailscale, then retry Fressh.',
	});

	useTailscaleRecoveryUiStore.getState().setRecoveryState({
		phase: 'recovering',
		message: 'Resetting Tailscale...',
	});
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'recovering',
		message: 'Resetting Tailscale...',
	});
});

void test('Tailscale recovery UI store clears visible state back to hidden', () => {
	useTailscaleRecoveryUiStore.getState().setRecoveryState({
		phase: 'needsAttention',
		message: 'Open Tailscale.',
	});

	useTailscaleRecoveryUiStore.getState().clearRecoveryState();

	assert.deepEqual(
		useTailscaleRecoveryUiStore.getState().recoveryState,
		{ phase: 'hidden' },
	);
});

void test('Tailscale recovery UI store registers and clears action handlers', () => {
	const calls: string[] = [];
	const actions: TailscaleRecoveryUiActions = {
		openTailscale: () => calls.push('open'),
		retry: () => calls.push('retry'),
		reset: () => calls.push('reset'),
	};

	useTailscaleRecoveryUiStore.getState().setActions(actions);
	useTailscaleRecoveryUiStore.getState().actions?.openTailscale();
	useTailscaleRecoveryUiStore.getState().actions?.retry();
	useTailscaleRecoveryUiStore.getState().actions?.reset();

	assert.deepEqual(calls, ['open', 'retry', 'reset']);

	useTailscaleRecoveryUiStore.getState().clearActions();

	assert.equal(useTailscaleRecoveryUiStore.getState().actions, null);
});
