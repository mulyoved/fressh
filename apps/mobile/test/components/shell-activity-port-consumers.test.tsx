import { expect, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { type ShellActivitySnapshot } from '../../src/lib/shell-controllers/activity-core';
import { useShellScrollbackController } from '../../src/lib/shell-controllers/scrollback';
import { type ShellActivityPort } from '../../src/lib/shell-controllers/session-contracts';
import { createScrollbackHarness } from '../integration/shell-scrollback-controller-test-support';

function createActivityPort(
	initial: ShellActivitySnapshot,
): ShellActivityPort & {
	publish(next: ShellActivitySnapshot): void;
} {
	let snapshot = initial;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		publish: (next) => {
			snapshot = next;
			for (const listener of [...listeners]) listener();
		},
	};
}

test('scrollback observes activity changes through the session activity port', async () => {
	const harness = createScrollbackHarness();
	const activity = createActivityPort({
		focused: true,
		appState: 'active',
		appActive: true,
		interactive: true,
		generation: 0,
	});
	const input = {
		runtimeInstanceId: 'runtime-1',
		context: { ...harness.context, activity },
	};
	const rendered = renderHook(() => useShellScrollbackController(input));

	act(() => {
		rendered.result.current.xtermProps.onScrollbackModeChange({
			active: true,
			phase: 'active',
			instanceId: 'runtime-1',
		});
	});
	expect(rendered.result.current.visible).toBe(true);

	act(() => {
		activity.publish({
			focused: false,
			appState: 'active',
			appActive: true,
			interactive: false,
			generation: 1,
		});
	});

	expect(rendered.result.current.visible).toBe(false);
	await act(async () => {
		rendered.unmount();
		await Promise.resolve();
	});
});
