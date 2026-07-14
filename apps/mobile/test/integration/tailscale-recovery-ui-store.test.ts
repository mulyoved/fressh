import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, test } from 'node:test';
import {
	hiddenTailscaleRecoveryUiState,
	clearTailscaleRecoveryUiState,
	markTailscaleRecoveryUiNeedsAttention,
	markTailscaleRecoveryUiRecovering,
	registerTailscaleRecoveryUiActions,
	type TailscaleRecoveryUiActions,
	useTailscaleRecoveryUiStore,
} from '../../src/lib/tailscale-recovery-ui-store';

const require = createRequire(import.meta.url);

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
	markTailscaleRecoveryUiNeedsAttention('Open Tailscale.');
	clearTailscaleRecoveryUiState();

	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'hidden',
	});
});

void test('registerTailscaleRecoveryUiActions stores handlers and clears them on cleanup', () => {
	const calls: string[] = [];
	const cleanup = registerTailscaleRecoveryUiActions({
		openTailscale: () => calls.push('open'),
		retry: () => calls.push('retry'),
		reset: () => calls.push('reset'),
	});

	useTailscaleRecoveryUiStore.getState().actions?.openTailscale();
	useTailscaleRecoveryUiStore.getState().actions?.retry();
	useTailscaleRecoveryUiStore.getState().actions?.reset();

	assert.deepEqual(calls, ['open', 'retry', 'reset']);
	assert.notEqual(useTailscaleRecoveryUiStore.getState().actions, null);

	cleanup();

	assert.equal(useTailscaleRecoveryUiStore.getState().actions, null);
});

void test('Tailscale recovery UI store helper state writers set the expected phases', () => {
	markTailscaleRecoveryUiNeedsAttention('Open Tailscale, then retry Fressh.');
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'needsAttention',
		message: 'Open Tailscale, then retry Fressh.',
	});

	markTailscaleRecoveryUiRecovering('Resetting Tailscale...');
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'recovering',
		message: 'Resetting Tailscale...',
	});

	clearTailscaleRecoveryUiState();
	assert.deepEqual(useTailscaleRecoveryUiStore.getState().recoveryState, {
		phase: 'hidden',
	});
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

void test('AutoConnectManager owns recovery policy without rendering the Tailscale overlay', () => {
	const source = readFileSync(
		require.resolve('../../src/lib/auto-connect.tsx'),
		'utf8',
	);

	assert.match(source, /registerTailscaleRecoveryUiActions/);
	assert.match(source, /markTailscaleRecoveryUiNeedsAttention/);
	assert.match(source, /markTailscaleRecoveryUiRecovering/);
	assert.match(source, /clearTailscaleRecoveryUiState/);
	assert.doesNotMatch(source, /TailscaleRecoveryBanner/);
	assert.doesNotMatch(source, /<TailscaleRecoveryBanner/);
});
