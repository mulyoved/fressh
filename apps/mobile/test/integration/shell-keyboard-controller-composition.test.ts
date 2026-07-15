import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
	createShellDetailKeyboardAuthorityRuntime,
	createShellDetailKeyboardCommitPublication,
	createShellDetailKeyboardControllerInput,
	createShellDetailKeyboardLateBindings,
	createShellDetailKeyboardModalCommands,
	type ShellDetailKeyboardCompositionInput,
} from '../../src/app/shell/shell-keyboard-composition';

const detailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');
const compositionSourcePath = join(
	process.cwd(),
	'src/app/shell/shell-keyboard-composition.ts',
);

void describe('shell keyboard controller composition', () => {
	void test('shell detail delegates keyboard command workflow', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.equal(source.match(/useShellKeyboardController\(/g)?.length, 1);
		assert.match(
			source,
			/useShellKeyboardController\(keyboardControllerInput\)/,
		);
		assert.match(source, /createShellDetailKeyboardControllerInput\(\{/);
		for (const legacy of [
			'preferredKeyboardId',
			'modifierKeysActive',
			'commandTimeoutsRef',
			'workmuxKeyboardCommandRunner',
			'codexRestartGenerationRef',
			'codexRestartInFlightRef',
			'runtimeShellConfigReloadRequestIdRef',
			'systemKeyboardVisibleRef',
			'lastKeyboardVisibleRef',
			'workmuxRef',
		]) {
			assert.doesNotMatch(source, new RegExp(legacy));
		}
	});

	void test('composition input preserves exact current authority ports and replacements', () => {
		const firstActivity = {
			focused: true,
			appState: 'active' as const,
			appActive: true,
			interactive: true,
			generation: 1,
		};
		const secondActivity = { ...firstActivity, generation: 2 };
		const shellConfigState =
			{} as ShellDetailKeyboardCompositionInput['initialShellConfigState'];
		const first = {
			activity: {
				getSnapshot: () => firstActivity,
				subscribe: () => () => {},
			},
			targetKey: 'target-1',
			scrollback: {
				input: {
					sendSegments() {},
				} as unknown as ShellDetailKeyboardCompositionInput['scrollback']['input'],
			},
			terminal: {
				view: {
					getRuntimeKey: () => 'runtime-1',
				} as unknown as ShellDetailKeyboardCompositionInput['terminal']['view'],
			},
			remote: {
				hostCommands:
					'connection-1' as unknown as ShellDetailKeyboardCompositionInput['remote']['hostCommands'],
				tmuxEnabled: true,
				sessionName: 'main',
				connectionId: 'connection-1',
				channelId: 1,
				workmux: {
					id: 1,
				} as unknown as ShellDetailKeyboardCompositionInput['remote']['workmux'],
			},
		};
		const second = {
			activity: {
				getSnapshot: () => secondActivity,
				subscribe: () => () => {},
			},
			targetKey: 'target-2',
			scrollback: {
				input: {
					sendSegments() {},
				} as unknown as ShellDetailKeyboardCompositionInput['scrollback']['input'],
			},
			terminal: {
				view: {
					getRuntimeKey: () => 'runtime-2',
				} as unknown as ShellDetailKeyboardCompositionInput['terminal']['view'],
			},
			remote: {
				hostCommands:
					'connection-2' as unknown as ShellDetailKeyboardCompositionInput['remote']['hostCommands'],
				tmuxEnabled: true,
				sessionName: 'main',
				connectionId: 'connection-2',
				channelId: 2,
				workmux: {
					id: 2,
				} as unknown as ShellDetailKeyboardCompositionInput['remote']['workmux'],
			},
		};
		const stable = {
			initialShellConfigState: shellConfigState,
			navScope: 'active' as const,
			setNavScope() {},
			modalCommands: {} as ShellDetailKeyboardCompositionInput['modalCommands'],
			browserCommands:
				{} as ShellDetailKeyboardCompositionInput['browserCommands'],
			fitTerminalToDevice() {},
			debugConnectionInCodex() {},
			reloadRuntimeShellConfig: async () => shellConfigState,
			showAlert() {},
			invalidateShellTransport() {},
			configureCommands:
				{} as ShellDetailKeyboardCompositionInput['configureCommands'],
			platformOS: 'android',
		};

		const firstInput = createShellDetailKeyboardControllerInput({
			...stable,
			...first,
		});
		const secondInput = createShellDetailKeyboardControllerInput({
			...stable,
			...second,
		});

		assert.equal(firstInput.activity, first.activity);
		assert.equal(firstInput.sourceKey, first.targetKey);
		assert.equal(firstInput.scrollbackInput, first.scrollback.input);
		assert.equal(firstInput.terminalView, first.terminal.view);
		assert.notEqual(firstInput.remoteTarget, first.remote);
		assert.equal(secondInput.activity, second.activity);
		assert.equal(secondInput.sourceKey, second.targetKey);
		assert.equal(secondInput.scrollbackInput, second.scrollback.input);
		assert.equal(secondInput.terminalView, second.terminal.view);
		assert.equal(secondInput.remoteTarget.targetKey, second.targetKey);
		assert.equal(secondInput.remoteTarget.hostCommands, 'connection-2');
		assert.equal(secondInput.remoteTarget.channelId, 2);
		assert.equal(secondInput.remoteTarget.workmux, second.remote.workmux);
		for (const key of Object.keys(stable)) {
			assert.equal(
				(firstInput as unknown as Record<string, unknown>)[key],
				(stable as Record<string, unknown>)[key],
				key,
			);
		}
	});

	void test('late modal bindings always resolve current skill and Wispr callbacks', () => {
		const events: string[] = [];
		const late = createShellDetailKeyboardLateBindings();
		const commands = createShellDetailKeyboardModalCommands({
			late,
			invalidateBrowserReads() {},
			closeCommander() {},
			closeBrowser() {},
			closeTextEntry() {},
			isCommandMenuOpen: () => false,
			openCommandMenu() {},
			closeCommandMenu() {},
			openCommander() {},
			openBrowserActions() {},
			openFeatureRequest() {},
			openConfigurator() {},
			openNewWorktreeWorkspace() {},
			openCloseWorktreeWorkspace() {},
		});

		late.replaceSkillSelector({
			open: () => events.push('skill-1'),
			close: () => events.push('close-1'),
		});
		late.replaceWispr(() => events.push('wispr-1'));
		commands.openSkillSelector();
		commands.openWisprTextEditor();
		late.replaceSkillSelector({
			open: () => events.push('skill-2'),
			close: () => events.push('close-2'),
		});
		late.replaceWispr(() => events.push('wispr-2'));
		commands.openSkillSelector();
		commands.openWisprTextEditor();
		commands.toggleCommandMenu();

		assert.deepEqual(events, [
			'skill-1',
			'wispr-1',
			'skill-2',
			'wispr-2',
			'close-2',
		]);
	});

	void test('modal commands preserve closure ordering and forward every destination once', () => {
		const events: string[] = [];
		let menuOpen = false;
		const late = createShellDetailKeyboardLateBindings();
		late.replaceSkillSelector({
			open: () => events.push('open-skill'),
			close: () => events.push('close-skill'),
		});
		late.replaceWispr(() => events.push('open-wispr'));
		const commands = createShellDetailKeyboardModalCommands({
			late,
			invalidateBrowserReads: () => events.push('invalidate-browser'),
			closeCommander: () => events.push('close-commander'),
			closeBrowser: () => events.push('close-browser'),
			closeTextEntry: () => events.push('close-text'),
			isCommandMenuOpen: () => menuOpen,
			openCommandMenu: () => events.push('open-menu'),
			closeCommandMenu: () => events.push('close-menu'),
			openCommander: () => events.push('open-commander'),
			openBrowserActions: () => events.push('open-browser'),
			openFeatureRequest: () => events.push('open-feature'),
			openConfigurator: () => events.push('open-config'),
			openNewWorktreeWorkspace: () => events.push('open-worktree-new'),
			openCloseWorktreeWorkspace: () => events.push('open-worktree-close'),
		});

		commands.toggleCommandMenu();
		assert.deepEqual(events.splice(0), [
			'invalidate-browser',
			'close-commander',
			'close-browser',
			'close-skill',
			'close-text',
			'open-menu',
		]);
		menuOpen = true;
		commands.toggleCommandMenu();
		assert.deepEqual(events.splice(0), [
			'invalidate-browser',
			'close-commander',
			'close-browser',
			'close-skill',
			'close-text',
			'close-menu',
		]);
		commands.openCommander();
		assert.deepEqual(events.splice(0), [
			'invalidate-browser',
			'close-menu',
			'close-browser',
			'close-skill',
			'close-text',
			'open-commander',
		]);
		commands.openSkillSelector();
		commands.openBrowserActions();
		commands.openFeatureRequest();
		commands.openWisprTextEditor();
		commands.openConfigurator();
		commands.openNewWorktreeWorkspace();
		commands.openCloseWorktreeWorkspace();
		commands.closeCommandMenu();
		assert.deepEqual(events, [
			'open-skill',
			'open-browser',
			'open-feature',
			'open-wispr',
			'open-config',
			'open-worktree-new',
			'open-worktree-close',
			'close-menu',
		]);
	});

	void test('authority invalidates source transitions before sibling mutation', () => {
		const events: string[] = [];
		const runtime = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target-1',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmux: { id: 1 },
		});
		runtime.replaceHandle({
			invalidate: (reason: string) => events.push(`invalidate:${reason}`),
		} as never);

		runtime.reconcile({
			targetKey: 'target-2',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmux: { id: 2 },
			appActive: true,
			focused: true,
		});
		events.push('sibling-mutation');

		assert.deepEqual(events, ['invalidate:source-change', 'sibling-mutation']);
	});

	void test('commit publication keeps abandoned render staged and old cleanup cannot clear new', async () => {
		const events: string[] = [];
		const authority = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmux: {},
		});
		const late = createShellDetailKeyboardLateBindings();
		const publication = createShellDetailKeyboardCommitPublication({
			authority,
			late,
		});
		const oldHandle = { invalidate: () => events.push('invalidate:old') };
		const newHandle = { invalidate: () => events.push('invalidate:new') };
		const oldKeyboard = publication.prepareKeyboard({
			handle: oldHandle,
		});
		const cleanupOld = oldKeyboard.commit();
		const abandoned = publication.prepareKeyboard({
			handle: newHandle,
		});

		assert.equal(publication.getSnapshot().keyboardHandle, oldHandle);
		void abandoned;
		authority.reconcile({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: false,
			workmux: publication,
			appActive: true,
			focused: true,
		});
		const committedNew = publication.prepareKeyboard({
			handle: newHandle,
		});
		const cleanupNew = committedNew.commit();
		cleanupOld();
		await Promise.resolve();
		assert.equal(publication.getSnapshot().keyboardHandle, newHandle);
		assert.deepEqual(events, ['invalidate:old']);

		cleanupNew();
		await Promise.resolve();
		assert.equal(publication.getSnapshot().keyboardHandle, null);
	});

	void test('late binding publication changes only at commit and ignores old cleanup', async () => {
		const events: string[] = [];
		const authority = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmux: {},
		});
		const late = createShellDetailKeyboardLateBindings();
		const publication = createShellDetailKeyboardCommitPublication({
			authority,
			late,
		});
		const old = publication.prepareLateBindings({
			skillSelector: {
				open: () => events.push('skill-old'),
				close: () => {},
			},
			openWispr: () => events.push('wispr-old'),
		});
		const cleanupOld = old.commit();
		publication.prepareLateBindings({
			skillSelector: {
				open: () => events.push('skill-abandoned'),
				close: () => {},
			},
			openWispr: () => events.push('wispr-abandoned'),
		});
		late.openSkillSelector();
		late.openWisprTextEditor();
		const current = publication.prepareLateBindings({
			skillSelector: {
				open: () => events.push('skill-current'),
				close: () => {},
			},
			openWispr: () => events.push('wispr-current'),
		});
		current.commit();
		cleanupOld();
		await Promise.resolve();
		late.openSkillSelector();
		late.openWisprTextEditor();

		assert.deepEqual(events, [
			'skill-old',
			'wispr-old',
			'skill-current',
			'wispr-current',
		]);
	});

	void test('tmux-only authority change invalidates before sibling mutation', () => {
		const events: string[] = [];
		const channel = {};
		const runtime = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: false,
			workmux: channel,
		});
		runtime.replaceHandle({
			invalidate: () => events.push('invalidate'),
		});
		runtime.reconcile({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmux: channel,
			appActive: true,
			focused: true,
		});
		events.push('sibling-mutation');

		assert.deepEqual(events, ['invalidate', 'sibling-mutation']);
	});

	void test('authority identity rows invalidate independently with exact reasons', () => {
		const channel = {};
		const rows = [
			{
				name: 'unchanged',
				next: {},
				expected: [] as string[],
			},
			{
				name: 'target',
				next: { targetKey: 'target-2' },
				expected: ['source-change'],
			},
			{
				name: 'activity',
				next: { activityGeneration: 2 },
				expected: ['source-change'],
			},
			{
				name: 'channel',
				next: { workmux: {} },
				expected: ['source-change'],
			},
			{
				name: 'tmux',
				next: { tmuxEnabled: true },
				expected: ['source-change'],
			},
			{
				name: 'inactive',
				next: { activityGeneration: 2, appActive: false },
				expected: ['app-inactive'],
			},
			{
				name: 'unfocused',
				next: { activityGeneration: 2, focused: false },
				expected: ['focus-lost'],
			},
		];
		for (const row of rows) {
			const events: string[] = [];
			const runtime = createShellDetailKeyboardAuthorityRuntime({
				targetKey: 'target',
				activityGeneration: 1,
				tmuxEnabled: false,
				workmux: channel,
			});
			runtime.replaceHandle({
				invalidate: (reason) => events.push(reason),
			});
			runtime.reconcile({
				targetKey: 'target',
				activityGeneration: 1,
				tmuxEnabled: false,
				workmux: channel,
				appActive: true,
				focused: true,
				...row.next,
			});
			assert.deepEqual(events, row.expected, row.name);
		}
	});

	void test('authority invalidation failure remains contained and reported', () => {
		const events: string[] = [];
		const runtime = createShellDetailKeyboardAuthorityRuntime(
			{
				targetKey: 'target',
				activityGeneration: 1,
				tmuxEnabled: true,
				workmux: {},
			},
			{ onInvalidationError: () => events.push('observed') },
		);
		runtime.replaceHandle({
			invalidate: () => {
				throw new Error('boom');
			},
		});
		runtime.reconcile({
			targetKey: 'next-target',
			activityGeneration: 2,
			tmuxEnabled: true,
			workmux: {},
			appActive: true,
			focused: true,
		});

		assert.deepEqual(events, ['observed']);
	});

	void test('authority lifecycle survives Strict replay and closes real unmount once', async () => {
		const events: string[] = [];
		const late = createShellDetailKeyboardLateBindings();
		late.replaceSkillSelector({
			open: () => events.push('late-open'),
			close: () => events.push('late-close'),
		});
		const runtime = createShellDetailKeyboardAuthorityRuntime(
			{
				targetKey: 'target',
				activityGeneration: 1,
				tmuxEnabled: true,
				workmux: {},
			},
			{ onClose: () => events.push('close'), late },
		);
		const replayCleanup = runtime.setup();
		replayCleanup();
		const realCleanup = runtime.setup();
		await Promise.resolve();
		assert.equal(events.length, 0);
		realCleanup();
		await Promise.resolve();
		await Promise.resolve();
		late.openSkillSelector();
		late.replaceSkillSelector({
			open: () => events.push('reopened'),
			close: () => events.push('reclosed'),
		});
		late.openSkillSelector();
		runtime.reconcile({
			targetKey: 'closed-target',
			activityGeneration: 2,
			tmuxEnabled: true,
			workmux: {},
			appActive: true,
			focused: true,
		});
		assert.deepEqual(events, ['close']);
	});

	void test('shell detail remains an explicit composition root', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.doesNotMatch(source, /useShellController\(/);
		assert.match(source, /useShellTerminalController\(/);
		assert.match(source, /useShellScrollbackController\(/);
		assert.match(source, /useShellKeyboardController\(/);
		assert.doesNotMatch(
			source,
			/keyboardSelectionModeRef\.current\s*=\s*keyboard\.selectionModeEnabled/,
		);
		assert.doesNotMatch(source, /keyboardAuthority\.replaceHandle\(keyboard\)/);
		assert.doesNotMatch(
			source,
			/keyboardLateBindings\.replace(?:SkillSelector|Wispr)\(/,
		);
	});

	void test('production composition seam uses no runtime identity assertion casts', () => {
		const source = readFileSync(compositionSourcePath, 'utf8');

		assert.doesNotMatch(source, /\bas unknown\b/);
		assert.doesNotMatch(source, /\bas string\s*\|\s*null\b/);
	});
});
