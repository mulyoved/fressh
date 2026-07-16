import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createShellKeyboardControllerAdapter,
	type ShellKeyboardControllerAdapter,
	type ShellKeyboardControllerAdapterPorts,
	type ShellKeyboardModalCommands,
} from '../../src/lib/shell-controllers/keyboard-controller-adapter';
import {
	createKeyboardClipboardAuthority,
	createKeyboardControllerAdmission,
} from '../../src/lib/shell-controllers/keyboard-hook-runtime';
import * as keyboardHookRuntime from '../../src/lib/shell-controllers/keyboard-hook-runtime';
import { type ShellKeyboardRemoteCore } from '../../src/lib/shell-controllers/keyboard-remote-contracts';
import { type ShellKeyboardStateCore } from '../../src/lib/shell-controllers/keyboard-state-core';
import { type TerminalRuntimeKey } from '../../src/lib/shell-controllers/terminal-transport';
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
	let selectionStateHook: (() => void) | null = null;
	let adapter: ShellKeyboardControllerAdapter | null = null;
	const createModalCommands = (
		identity: string,
	): ShellKeyboardModalCommands & { identity: string } => ({
		identity,
		toggleCommandMenu: () => events.push('menu'),
		openCommander() {
			events.push(`commander:${this.identity}`);
		},
		openNewWorktreeWorkspace() {
			events.push(`worktree:new:${this.identity}`);
		},
		openCloseWorktreeWorkspace() {
			events.push(`worktree:close:${this.identity}`);
		},
		openSkillSelector: () => {},
		openBrowserActions: () => {},
		openFeatureRequest: () => {},
		openWisprTextEditor: () => {},
		openConfigurator: () => {},
		closeCommandMenu: () => {},
	});
	const stateCore = {
		getSnapshot: () => ({
			activeKeyboardIds: ['main'],
			shellConfigState,
		}),
		selectKeyboardIfExists: (id: string) => events.push(`select:${id}`),
		rotateKeyboard: () => events.push('rotate'),
		setSelectionModeEnabled: (enabled: boolean) => {
			events.push(`state:${enabled}`);
			selectionStateHook?.();
		},
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
			subscribe: () => () => {},
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
		modalCommands: createModalCommands('old'),
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
				modalCommands: createModalCommands('new'),
			};
		},
		replaceSelectionPorts: () => {
			ports = {
				...ports,
				terminalView: {
					...ports.terminalView,
					setSystemKeyboardEnabled: (enabled) =>
						events.push(`terminal:new:${enabled}`),
				},
				dismissKeyboard: () => events.push('dismiss:new'),
				clearKeyboardVisibility: () => events.push('visible:new:false'),
			};
		},
		setSelectionStateHook: (hook: (() => void) | null) => {
			selectionStateHook = hook;
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

void test('Worktree actions require and reach their exact modal destinations once', async () => {
	const source = readFileSync(
		`${process.cwd()}/src/lib/shell-controllers/keyboard-controller-adapter.ts`,
		'utf8',
	);
	assert.doesNotMatch(source, /openNewWorktreeWorkspace\?\(\): void/);
	assert.doesNotMatch(source, /openCloseWorktreeWorkspace\?\(\): void/);
	assert.doesNotMatch(source, /openNewWorktreeWorkspace\?\.\(\)/);
	assert.doesNotMatch(source, /openCloseWorktreeWorkspace\?\.\(\)/);

	const harness = createAdapterHarness();
	await harness.adapter.runAction('OPEN_NEW_WORKTREE_WORKSPACE');
	await harness.adapter.runAction('OPEN_CLOSE_WORKTREE_WORKSPACE');

	assert.deepEqual(harness.events, ['worktree:new:old', 'worktree:close:old']);
});

void test('selection changes publish the applied mode to the terminal view', () => {
	const harness = createAdapterHarness();

	harness.adapter.onSelectionModeChange(true);

	assert.ok(harness.events.includes('state:true'));
	assert.ok(harness.events.includes('view:true'));
});

void test('keyboard observes current terminal identity and retires stale work once', () => {
	const createObserver = (
		keyboardHookRuntime as typeof keyboardHookRuntime & {
			createKeyboardTerminalRuntimeObserver?: (onChanged: () => void) => {
				reconcile(view: {
					getRuntimeKey(): string | null;
					getRuntimeInstanceId(): string | null;
				}): boolean;
			};
		}
	).createKeyboardTerminalRuntimeObserver;
	assert.equal(typeof createObserver, 'function');
	if (!createObserver) return;
	let runtimeKey: TerminalRuntimeKey | null = 'runtime-1' as TerminalRuntimeKey;
	let instanceId: string | null = 'instance-1';
	const invalidations: string[] = [];
	const observer = createObserver(() => invalidations.push('runtime-reset'));
	const view = {
		getRuntimeKey: () => runtimeKey,
		getRuntimeInstanceId: () => instanceId,
	};

	assert.equal(observer.reconcile(view), false);
	runtimeKey = 'runtime-2' as TerminalRuntimeKey;
	instanceId = 'instance-2';
	assert.equal(observer.reconcile(view), true);
	assert.equal(observer.reconcile(view), false);
	assert.deepEqual(invalidations, ['runtime-reset']);
});

void test('one terminal identity change advances keyboard admission exactly once', () => {
	let runtimeKey: TerminalRuntimeKey | null = 'runtime-1' as TerminalRuntimeKey;
	let instanceId: string | null = 'instance-1';
	const invalidations: string[] = [];
	const admission = createKeyboardControllerAdmission((reason) => {
		invalidations.push(reason);
	});
	assert.equal(admission.setup(), 1);
	const observer = keyboardHookRuntime.createKeyboardTerminalRuntimeObserver(
		() => admission.invalidate('runtime-reset'),
	);
	const view = {
		getRuntimeKey: () => runtimeKey,
		getRuntimeInstanceId: () => instanceId,
	};

	assert.equal(observer.reconcile(view), false);
	const initialGeneration = admission.getGeneration();
	runtimeKey = 'runtime-2' as TerminalRuntimeKey;
	instanceId = 'instance-2';
	assert.equal(observer.reconcile(view), true);
	assert.equal(observer.reconcile(view), false);

	assert.equal(admission.getGeneration(), (initialGeneration ?? 0) + 1);
	assert.deepEqual(invalidations, ['runtime-reset']);
});

void test('selection mode resolves latest ports after reentrant state publication', () => {
	const harness = createAdapterHarness();
	harness.setSelectionStateHook(harness.replaceSelectionPorts);
	harness.adapter.onSelectionModeChange(true);
	assert.deepEqual(harness.events, [
		'state:true',
		'view:true',
		'terminal:new:false',
		'dismiss:new',
		'visible:new:false',
		'system:false',
	]);
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
