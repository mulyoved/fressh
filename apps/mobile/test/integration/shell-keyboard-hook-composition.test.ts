import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createShellKeyboardControllerAdapter,
	type ShellKeyboardControllerAdapter,
	type ShellKeyboardControllerAdapterPorts,
} from '../../src/lib/shell-controllers/keyboard-controller-adapter';
import {
	createKeyboardClipboardAuthority,
	createKeyboardControllerAdmission,
} from '../../src/lib/shell-controllers/keyboard-hook-runtime';
import { type ShellKeyboardRemoteCore } from '../../src/lib/shell-controllers/keyboard-remote-contracts';
import { type ShellKeyboardStateCore } from '../../src/lib/shell-controllers/keyboard-state-core';
import { createKeyboardInputHarness } from './shell-keyboard-input-controller-test-support';

const shellConfigState = {
	config: {
		version: '1',
		updatedAt: '2026-07-10T00:00:00.000Z',
		defaultKeyboardId: 'main',
		activeKeyboardIds: ['main'],
		keyboardRouting: { actionTargets: {}, oneShotReturnByKeyboardId: {} },
		keyboards: [{ id: 'main', name: 'Main', grid: [] }],
		macrosByKeyboardId: { main: [] },
		commandMenus: [],
	},
	source: 'bundled',
	lastLoadedAt: null,
	lastError: null,
} as const;

function createAdapterHarness() {
	const input = createKeyboardInputHarness();
	const clipboard = createKeyboardClipboardAuthority();
	const events: string[] = [];
	let selection = 'selection';
	let instanceId = 'instance-1';
	let sourceKey: unknown = 'source-1';
	let clipboardRead: () => Promise<string> = async () => 'paste';
	let clipboardWrite: (text: string) => Promise<void> = async (text) => {
		events.push(`write:${text}`);
	};
	let adapter: ShellKeyboardControllerAdapter | null = null;
	const stateCore = {
		getSnapshot: () => ({
			activeKeyboardIds: ['main'],
			shellConfigState,
		}),
		selectKeyboardIfExists: (id: string) => events.push(`select:${id}`),
		rotateKeyboard: () => events.push('rotate'),
		setSelectionModeEnabled: (enabled: boolean) =>
			events.push(`state:${enabled}`),
		setSystemKeyboardEnabled: (enabled: boolean) =>
			events.push(`system:${enabled}`),
	} as unknown as ShellKeyboardStateCore;
	const remoteCore = {
		restartCodex: async () => ({ status: 'handled' }),
		runWorkmuxCommand: async () => ({ status: 'handled' }),
		handleCommandBridgeEntry: async () => {
			events.push('bridge');
			return { status: 'handled' };
		},
		reloadConfig: async () => {
			events.push('reload');
			return { status: 'handled' };
		},
	} as unknown as ShellKeyboardRemoteCore;
	const admission = createKeyboardControllerAdmission((reason) => {
		clipboard.invalidate();
		input.core.invalidate(reason);
	});
	admission.setup();
	let ports: ShellKeyboardControllerAdapterPorts = {
		activity: {
			getSnapshot: () => ({
				focused: true,
				appState: 'active',
				appActive: true,
				interactive: true,
				generation: 1,
			}),
		},
		sourceKey,
		terminalView: {
			getRuntimeKey: () => 'runtime-1' as never,
			getRuntimeInstanceId: () => instanceId,
			isCurrentInstance: (candidate) => candidate === instanceId,
			getSelection: async () => selection,
			setSelectionModeEnabled: (enabled) => {
				events.push(`view:${enabled}`);
				if (!enabled) adapter?.onSelectionChanged('');
			},
			setSystemKeyboardEnabled: (enabled) => events.push(`terminal:${enabled}`),
		},
		modalCommands: {
			toggleCommandMenu: () => events.push('menu'),
			openCommander: () => events.push('commander:old'),
			openSkillSelector: () => {},
			openBrowserActions: () => {},
			openFeatureRequest: () => {},
			openWisprTextEditor: () => {},
			openConfigurator: () => {},
			closeCommandMenu: () => {},
		},
		browserCommands: {
			openDiff: () => {},
			openUrlSlot: () => {},
			openDetected: () => {},
			editUrlSlot: () => {},
		},
		fitTerminalToDevice: () => {},
		debugConnectionInCodex: () => {},
		setNavScope: () => {},
		platformOS: 'android',
		dismissKeyboard: () => events.push('dismiss'),
		clearKeyboardVisibility: () => events.push('visible:false'),
		readClipboard: () => clipboardRead(),
		writeClipboard: (text) => clipboardWrite(text),
	};
	adapter = createShellKeyboardControllerAdapter({
		admission,
		stateCore,
		inputCore: input.core,
		remoteCore,
		clipboardAuthority: clipboard,
		getPorts: () => ports,
		warn: (message) => events.push(`warn:${message}`),
	});
	input.setActionImplementation((actionId, options) =>
		adapter?.runAction(actionId, options),
	);
	return {
		adapter,
		input,
		events,
		clipboard,
		setSelection: (text: string) => {
			selection = text;
		},
		setClipboardWrite: (write: typeof clipboardWrite) => {
			clipboardWrite = write;
		},
		setClipboardRead: (read: typeof clipboardRead) => {
			clipboardRead = read;
		},
		replaceSource: () => {
			sourceKey = `${String(sourceKey)}-next`;
			ports = { ...ports, sourceKey };
		},
		replacePorts: () => {
			ports = {
				...ports,
				modalCommands: {
					...ports.modalCommands,
					openCommander: () => events.push('commander:new'),
				},
			};
		},
		setInstance: (next: string) => {
			instanceId = next;
		},
	};
}

async function settleAdapter(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

void test('production adapter copy UI path owns exact input and clipboard finalization', async () => {
	const harness = createAdapterHarness();
	let release!: () => void;
	const write = new Promise<void>((resolve) => {
		release = resolve;
	});
	harness.setClipboardWrite(async (text) => {
		harness.events.push(`write:${text}`);
		await write;
	});
	harness.adapter.onCopySelection();
	await settleAdapter();
	harness.adapter.onSelectionChanged('replacement');
	await settleAdapter();
	assert.deepEqual(harness.events, ['write:selection']);
	assert.deepEqual(harness.input.completedSlots, []);
	release();
	await settleAdapter();

	harness.setSelection('fresh');
	harness.setClipboardWrite(async (text) => {
		harness.events.push(`write:${text}`);
	});
	harness.adapter.onCopySelection();
	await settleAdapter();
	assert.deepEqual(harness.events, [
		'write:selection',
		'write:fresh',
		'state:false',
		'view:false',
	]);
	assert.deepEqual(harness.input.completedSlots, ['complete']);
});

void test('production adapter reads latest ports and guards deferred paste authority', async () => {
	const harness = createAdapterHarness();
	const copyCallback = harness.adapter.onCopySelection;
	await harness.adapter.runAction('OPEN_COMMANDER');
	harness.replacePorts();
	assert.strictEqual(harness.adapter.onCopySelection, copyCallback);
	await harness.adapter.runAction('OPEN_COMMANDER');
	assert.deepEqual(harness.events, ['commander:old', 'commander:new']);

	let resolveRead!: (text: string) => void;
	harness.setClipboardRead(
		() =>
			new Promise<string>((resolve) => {
				resolveRead = resolve;
			}),
	);
	const stalePaste = harness.adapter.pasteClipboard();
	await Promise.resolve();
	harness.replaceSource();
	resolveRead('stale');
	await stalePaste;
	assert.deepEqual(harness.input.sent, []);

	let resolveInvalidatedRead!: (text: string) => void;
	harness.setClipboardRead(
		() =>
			new Promise<string>((resolve) => {
				resolveInvalidatedRead = resolve;
			}),
	);
	const invalidatedPaste = harness.adapter.pasteClipboard();
	await Promise.resolve();
	harness.adapter.invalidate('source-change');
	resolveInvalidatedRead('invalidated');
	await invalidatedPaste;
	assert.deepEqual(harness.input.sent, []);

	harness.adapter.onWebViewInput({ str: 'x', instanceId: 'instance-1' });
	harness.adapter.onBridge({ type: 'restart-codex' } as never);
	await settleAdapter();
	assert.deepEqual(harness.input.sent, [[[0x78]]]);
	assert.equal(harness.events.at(-1), 'bridge');
});

void test('hook delegates callback policy to the pure production adapter', () => {
	const source = readFileSync(
		`${process.cwd()}/src/lib/shell-controllers/keyboard.tsx`,
		'utf8',
	);
	assert.match(source, /createShellKeyboardControllerAdapter/);
	assert.doesNotMatch(source, /switch \(actionId\)/);
	assert.doesNotMatch(source, /actionContextRef/);
});
