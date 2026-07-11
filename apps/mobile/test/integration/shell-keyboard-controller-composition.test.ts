import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
	createShellDetailKeyboardAuthorityRuntime,
	createShellDetailKeyboardControllerInput,
	createShellDetailKeyboardLateBindings,
	createShellDetailKeyboardModalCommands,
	createShellDetailKeyboardViewBindings,
} from '../../src/app/shell/shell-keyboard-composition';

const detailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');

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
		const first = {
			activity: { snapshot: { generation: 1 }, getSnapshot: () => ({}) },
			sourceKey: Symbol('source-1'),
			scrollbackInput: { sendSegments() {} },
			terminalView: { getRuntimeKey: () => 'runtime-1' },
			remoteTarget: {
				targetKey: 'target-1',
				source: 'connection-1',
				tmuxEnabled: true,
				sessionName: 'main',
				connectionId: 'connection-1',
				channelId: 1,
				workmuxControlChannel: { id: 1 },
			},
		};
		const second = {
			activity: { snapshot: { generation: 2 }, getSnapshot: () => ({}) },
			sourceKey: Symbol('source-2'),
			scrollbackInput: { sendSegments() {} },
			terminalView: { getRuntimeKey: () => 'runtime-2' },
			remoteTarget: {
				targetKey: 'target-2',
				source: 'connection-2',
				tmuxEnabled: true,
				sessionName: 'main',
				connectionId: 'connection-2',
				channelId: 2,
				workmuxControlChannel: { id: 2 },
			},
		};
		const stable = {
			initialShellConfigState: {},
			navScope: 'window',
			setNavScope() {},
			modalCommands: {},
			browserCommands: {},
			fitTerminalToDevice() {},
			debugConnectionInCodex() {},
			reloadRuntimeShellConfig: async () => ({}),
			showAlert() {},
			invalidateShellTransport() {},
			configureCommands: {},
			logger: {},
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
		assert.equal(firstInput.sourceKey, first.sourceKey);
		assert.equal(firstInput.scrollbackInput, first.scrollbackInput);
		assert.equal(firstInput.terminalView, first.terminalView);
		assert.equal(firstInput.remoteTarget, first.remoteTarget);
		assert.equal(secondInput.activity, second.activity);
		assert.equal(secondInput.sourceKey, second.sourceKey);
		assert.equal(secondInput.scrollbackInput, second.scrollbackInput);
		assert.equal(secondInput.terminalView, second.terminalView);
		assert.equal(secondInput.remoteTarget, second.remoteTarget);
		assert.equal(secondInput.remoteTarget.targetKey, 'target-2');
		assert.equal(secondInput.remoteTarget.source, 'connection-2');
		assert.equal(secondInput.remoteTarget.channelId, 2);
		assert.equal(
			secondInput.remoteTarget.workmuxControlChannel,
			second.remoteTarget.workmuxControlChannel,
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

	void test('authority runtime invalidates transitions and runtime before mutation', () => {
		const events: string[] = [];
		const runtime = createShellDetailKeyboardAuthorityRuntime({
			targetKey: 'target-1',
			activityGeneration: 1,
			workmuxControlChannel: { id: 1 },
		});
		runtime.replaceHandle({
			invalidate: (reason: string) => events.push(`invalidate:${reason}`),
		} as never);

		runtime.reconcile({
			targetKey: 'target-2',
			activityGeneration: 1,
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
				workmuxControlChannel: {},
			},
			{ onClose: () => events.push('close'), late },
		);
		const replayCleanup = runtime.setup();
		replayCleanup();
		const realCleanup = runtime.setup();
		await Promise.resolve();
		assert.deepEqual(events, []);
		realCleanup();
		await Promise.resolve();
		await Promise.resolve();
		late.openSkillSelector();
		runtime.reconcile({
			targetKey: 'closed-target',
			activityGeneration: 2,
			workmuxControlChannel: {},
			appActive: true,
			focused: true,
		});
		assert.deepEqual(events, ['close']);
	});

	void test('view bindings delegate each controller callback and bundle exactly once', () => {
		const events: string[] = [];
		const handle = {
			terminalKeyboardProps: { id: 'terminal' },
			commandMenuProps: {
				id: 'menu',
				onBridge: (_entry: unknown) => events.push('bridge'),
			},
			commanderProps: { id: 'commander' },
			textEntryProps: { id: 'text' },
			configureProps: { id: 'configure' },
			onWebViewInput: (_input: { str: string; instanceId: string }) =>
				events.push('input'),
			onSelectionChanged: (_text: string) => events.push('selection'),
			onSelectionModeChange: (_enabled: boolean) => events.push('mode'),
		};
		const view = createShellDetailKeyboardViewBindings(handle);

		assert.equal(view.terminalKeyboardProps, handle.terminalKeyboardProps);
		assert.equal(view.commandMenuProps, handle.commandMenuProps);
		assert.equal(view.commanderProps, handle.commanderProps);
		assert.equal(view.textEntryProps, handle.textEntryProps);
		assert.equal(view.configureProps, handle.configureProps);
		view.onWebViewInput({ str: 'x', instanceId: 'i' });
		view.onSelectionChanged('x');
		view.onSelectionModeChange(true);
		view.commandMenuProps.onBridge({} as never);
		assert.deepEqual(events, ['input', 'selection', 'mode', 'bridge']);
	});

	void test('shell detail remains an explicit composition root', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.doesNotMatch(source, /useShellController\(/);
		assert.match(source, /useShellTerminalController\(/);
		assert.match(source, /useShellScrollbackController\(/);
		assert.match(source, /useShellKeyboardController\(/);
	});
});
