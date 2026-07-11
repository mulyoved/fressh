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
			'workmuxControlChannelRef',
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
				snapshot: firstActivity,
				getSnapshot: () => firstActivity,
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
				source: 'connection-1',
				tmuxEnabled: true,
				sessionName: 'main',
				connectionId: 'connection-1',
				channelId: 1,
				workmuxControlChannel: {
					id: 1,
				} as unknown as ShellDetailKeyboardCompositionInput['remote']['workmuxControlChannel'],
			},
		};
		const second = {
			activity: {
				snapshot: secondActivity,
				getSnapshot: () => secondActivity,
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
				source: 'connection-2',
				tmuxEnabled: true,
				sessionName: 'main',
				connectionId: 'connection-2',
				channelId: 2,
				workmuxControlChannel: {
					id: 2,
				} as unknown as ShellDetailKeyboardCompositionInput['remote']['workmuxControlChannel'],
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
		assert.equal(secondInput.remoteTarget.source, 'connection-2');
		assert.equal(secondInput.remoteTarget.channelId, 2);
		assert.equal(
			secondInput.remoteTarget.workmuxControlChannel,
			second.remote.workmuxControlChannel,
		);
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
		commands.closeCommandMenu();
		assert.deepEqual(events, [
			'open-skill',
			'open-browser',
			'open-feature',
			'open-wispr',
			'open-config',
			'close-menu',
		]);
	});

	void test('authority runtime invalidates transitions and runtime before mutation', () => {
		const events: string[] = [];
		const runtime = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target-1',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmuxControlChannel: { id: 1 },
		});
		runtime.replaceHandle({
			invalidate: (reason: string) => events.push(`invalidate:${reason}`),
		} as never);

		runtime.reconcile({
			targetKey: 'target-2',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmuxControlChannel: { id: 2 },
			appActive: true,
			focused: true,
		});
		events.push('terminal-mutation');
		runtime.onRuntimeChanged('runtime-2', 'instance-2', () => {
			events.push('scrollback-mutation');
		});

		assert.deepEqual(events, [
			'invalidate:source-change',
			'terminal-mutation',
			'invalidate:runtime-reset',
			'scrollback-mutation',
		]);
		assert.deepEqual(runtime.getRuntimeIdentity(), {
			runtimeKey: 'runtime-2',
			instanceId: 'instance-2',
		});
	});

	void test('commit publication keeps abandoned render staged and old cleanup cannot clear new', async () => {
		const events: string[] = [];
		const authority = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmuxControlChannel: {},
		});
		const late = createShellDetailKeyboardLateBindings();
		const publication = createShellDetailKeyboardCommitPublication({
			authority,
			late,
			publishSelectionMode: (enabled) =>
				events.push(`selection:${String(enabled)}`),
		});
		const oldHandle = { invalidate: () => events.push('invalidate:old') };
		const newHandle = { invalidate: () => events.push('invalidate:new') };
		const oldKeyboard = publication.prepareKeyboard({
			handle: oldHandle,
			selectionModeEnabled: false,
		});
		const cleanupOld = oldKeyboard.commit();
		const abandoned = publication.prepareKeyboard({
			handle: newHandle,
			selectionModeEnabled: true,
		});

		assert.equal(publication.getSnapshot().keyboardHandle, oldHandle);
		assert.equal(publication.getSnapshot().selectionModeEnabled, false);
		void abandoned;
		authority.reconcile({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: false,
			workmuxControlChannel: publication,
			appActive: true,
			focused: true,
		});
		const committedNew = publication.prepareKeyboard({
			handle: newHandle,
			selectionModeEnabled: true,
		});
		const cleanupNew = committedNew.commit();
		cleanupOld();
		await Promise.resolve();
		assert.equal(publication.getSnapshot().keyboardHandle, newHandle);
		assert.equal(publication.getSnapshot().selectionModeEnabled, true);
		assert.deepEqual(events, [
			'selection:false',
			'invalidate:old',
			'selection:true',
		]);

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
			workmuxControlChannel: {},
		});
		const late = createShellDetailKeyboardLateBindings();
		const publication = createShellDetailKeyboardCommitPublication({
			authority,
			late,
			publishSelectionMode() {},
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
			workmuxControlChannel: channel,
		});
		runtime.replaceHandle({
			invalidate: () => events.push('invalidate'),
		});
		runtime.reconcile({
			targetKey: 'target',
			activityGeneration: 1,
			tmuxEnabled: true,
			workmuxControlChannel: channel,
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
				next: { workmuxControlChannel: {} },
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
				workmuxControlChannel: channel,
			});
			runtime.replaceHandle({
				invalidate: (reason) => events.push(reason),
			});
			runtime.reconcile({
				targetKey: 'target',
				activityGeneration: 1,
				tmuxEnabled: false,
				workmuxControlChannel: channel,
				appActive: true,
				focused: true,
				...row.next,
			});
			assert.deepEqual(events, row.expected, row.name);
		}
	});

	void test('authority invalidation failure still reports and notifies runtime mutation', () => {
		const events: string[] = [];
		const runtime = createShellDetailKeyboardAuthorityRuntime(
			{
				targetKey: 'target',
				activityGeneration: 1,
				tmuxEnabled: true,
				workmuxControlChannel: {},
			},
			{ onInvalidationError: () => events.push('observed') },
		);
		runtime.replaceHandle({
			invalidate: () => {
				throw new Error('boom');
			},
		});
		runtime.onRuntimeChanged('runtime', 'instance', () => {
			events.push('notified');
		});

		assert.deepEqual(events, ['observed', 'notified']);
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
				workmuxControlChannel: {},
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
			workmuxControlChannel: {},
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
