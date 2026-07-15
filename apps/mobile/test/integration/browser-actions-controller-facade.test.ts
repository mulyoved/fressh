import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserActionsControllerFacade } from '../../src/lib/shell-controllers/browser-actions-facade';

void test('browser controller facade binds every modal callback and handle command', async () => {
	const events: unknown[][] = [];
	const context = {
		paneId: '%1',
		paneTty: '/dev/pts/1',
		panePath: '/repo',
	};
	const core = {
		open: () => {
			events.push(['open']);
			return true;
		},
		close: () => events.push(['close']),
		openDiffity: async () => {
			events.push(['diff']);
		},
		openGitHubTarget: async (target: string) => {
			events.push(['github', target]);
		},
		openDetected: (mode: string) => {
			events.push(['detected', mode]);
			return mode === 'auto';
		},
		openUrlSlot: (slot: string) => events.push(['open-url', slot]),
		editUrlSlot: (slot: string) => events.push(['edit-url', slot]),
		closeHostUrl: () => {
			events.push(['close-host-url']);
			return false;
		},
		submitHostUrl: (value: string) => events.push(['submit-url', value]),
		closeDetectedPicker: () => events.push(['close-picker']),
		selectDetected: async (candidate: { raw: string }) => {
			events.push(['select', candidate.raw]);
		},
		resolvePaneContext: async () => {
			events.push(['resolve-context']);
			return context;
		},
		resolvePanePath: async () => {
			events.push(['resolve-path']);
			return '/repo';
		},
		resolveCurrentGitHubRepository: async () => {
			events.push(['resolve-repository']);
			return 'mulyoved/fressh';
		},
		invalidateHostUrlReads: () => events.push(['invalidate-url-reads']),
		invalidate: (reason: string) => events.push(['invalidate', reason]),
	};
	const facade = createBrowserActionsControllerFacade(core);
	const candidate = {
		kind: 'remote-url' as const,
		raw: 'https://example.test',
		normalized: 'https://example.test',
		display: 'Example',
		path: null,
		line: null,
		url: 'https://example.test',
	};

	facade.modalCallbacks.close();
	assert.equal(facade.modalCallbacks.openDiff(), undefined);
	assert.equal(facade.modalCallbacks.openGitHubIssues(), undefined);
	assert.equal(facade.modalCallbacks.openGitHubPulls(), undefined);
	assert.equal(facade.modalCallbacks.openDetectedAuto(), true);
	assert.equal(facade.modalCallbacks.openDetectedPick(), false);
	facade.modalCallbacks.openUrlSlot('window-url');
	facade.modalCallbacks.editUrlSlot('app-url');
	assert.equal(facade.modalCallbacks.closeHostUrl(), undefined);
	facade.modalCallbacks.submitHostUrl('https://new.test');
	facade.modalCallbacks.closeDetectedPicker();
	assert.equal(facade.modalCallbacks.selectDetected(candidate), undefined);

	const browserActionsProps = {
		open: true,
		onClose: facade.modalCallbacks.close,
		onOpenDiff: facade.modalCallbacks.openDiff,
		onOpenGitHubIssues: facade.modalCallbacks.openGitHubIssues,
		onOpenGitHubPulls: facade.modalCallbacks.openGitHubPulls,
		onOpenDetectedAuto: facade.modalCallbacks.openDetectedAuto,
		onOpenDetectedPick: facade.modalCallbacks.openDetectedPick,
		onOpenUrlSlot: facade.modalCallbacks.openUrlSlot,
		onEditUrlSlot: facade.modalCallbacks.editUrlSlot,
	};
	const hostUrlProps = {
		open: false,
		slot: null,
		slotLabel: 'URL',
		initialValue: '',
		mode: 'edit' as const,
		isSubmitting: false,
		error: null,
		onClose: facade.modalCallbacks.closeHostUrl,
		onSubmit: facade.modalCallbacks.submitHostUrl,
	};
	const detectedOpenPickerProps = {
		open: false,
		candidates: [candidate],
		onClose: facade.modalCallbacks.closeDetectedPicker,
		onSelect: facade.modalCallbacks.selectDetected,
	};
	const handle = facade.createHandle({
		browserActionsProps,
		hostUrlProps,
		detectedOpenPickerProps,
	});
	assert.equal(handle.browserActionsProps, browserActionsProps);
	assert.equal(handle.hostUrlProps, hostUrlProps);
	assert.equal(handle.detectedOpenPickerProps, detectedOpenPickerProps);
	assert.equal(handle.open(), undefined);
	handle.close();
	assert.equal(await handle.resolveHostBrowserPaneContext(), context);
	assert.equal(await handle.resolveHostBrowserPanePath(), '/repo');
	assert.equal('resolveHostBrowserWorkspace' in handle, false);
	assert.equal(
		await handle.resolveCurrentGitHubRepository(),
		'mulyoved/fressh',
	);
	assert.equal('runHostBrowserCommand' in handle, false);
	handle.invalidateHostUrlReads();
	handle.invalidateAll();

	assert.deepEqual(events, [
		['close'],
		['diff'],
		['github', 'issues'],
		['github', 'pulls'],
		['detected', 'auto'],
		['detected', 'pick'],
		['open-url', 'window-url'],
		['edit-url', 'app-url'],
		['close-host-url'],
		['submit-url', 'https://new.test'],
		['close-picker'],
		['select', 'https://example.test'],
		['open'],
		['close'],
		['resolve-context'],
		['resolve-path'],
		['resolve-repository'],
		['invalidate-url-reads'],
		['invalidate', 'runtime-reset'],
	]);
});
