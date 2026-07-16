import assert from 'node:assert/strict';
import test from 'node:test';

import { type ShellScrollbackContext } from '../../src/lib/shell-controllers/scrollback-contracts';
import * as ownerModule from '../../src/lib/shell-controllers/scrollback-remote-copy-mode-owner';
import { createShellTargetKey } from '../../src/lib/shell-controllers/source-keys';

type OwnershipToken = Readonly<{ generation: number }>;
type RemoteCopyModeOwner = {
	acquire(): OwnershipToken;
	dispose(): void;
	generation(): number;
	isOwned(): boolean;
	release(): OwnershipToken;
	setContext(context: ShellScrollbackContext | null): void;
	settle(token: OwnershipToken, owned: boolean): boolean;
	transition(): OwnershipToken;
};
type OwnerFactory = (input: {
	warn(context: ShellScrollbackContext, message: string, error?: unknown): void;
}) => RemoteCopyModeOwner;

function factory(): OwnerFactory {
	const value = Reflect.get(ownerModule, 'createScrollbackRemoteCopyModeOwner');
	assert.equal(
		typeof value,
		'function',
		'remote copy mode owner factory is missing',
	);
	return value as OwnerFactory;
}

function createContext(
	name: string,
	events: string[],
	register?: (cleanup: () => Promise<void>) => () => void,
): ShellScrollbackContext {
	const key = createShellTargetKey(`transport:${name}` as never, name);
	return {
		targetKey: key,
		targetName: name,
		connectionAvailable: true,
		shellAvailable: true,
		tmuxEnabled: true,
		activity: {
			getSnapshot: () => ({
				appActive: true,
				appState: 'active',
				focused: true,
				generation: 0,
				interactive: true,
			}),
			subscribe: () => () => {},
		},
		terminalTransport: {
			captureLease: () => null,
			isLeaseCurrent: () => false,
			sendBatch: async () => {},
		},
		terminalView: {
			exitScrollback: () => {},
			fit: () => {},
			getRuntimeInstanceId: () => null,
			getRuntimeKey: () => null,
			getSelection: async () => '',
			getSelectionModeEnabled: () => false,
			isCurrentInstance: () => true,
			sendScrollbackEnterAck: () => {},
			setSelectionModeEnabled: () => {},
			setSystemKeyboardEnabled: () => {},
		},
		workmux: {
			key,
			scroll: {
				enter: async () => ({ status: 'completed', output: '' }),
				exit: async () => ({ status: 'completed', output: '' }),
				move: async () => ({ status: 'completed', output: '' }),
			},
			registerBeforeDispose: (_owner, cleanup) => {
				events.push(`register:${name}`);
				return (
					register?.(() =>
						cleanup({ exitScroll: async () => ({ status: 'completed' }) }),
					) ?? (() => events.push(`unregister:${name}`))
				);
			},
		},
		trace: () => {},
		feedback: { alert: () => {}, copyMessage: () => {} },
		logger: { warn: (message) => events.push(`warn:${message}`) },
		getErrorMessage: (error) => String(error),
	} satisfies ShellScrollbackContext;
}

void test('remote copy ownership atomically acquires and releases retirement registration', () => {
	const events: string[] = [];
	const owner = factory()({
		warn: (_context, message) => events.push(message),
	});
	owner.setContext(createContext('main', events));

	assert.deepEqual(owner.acquire(), { generation: 1 });
	assert.equal(owner.isOwned(), true);
	assert.equal(owner.generation(), 1);
	assert.deepEqual(events, ['register:main']);

	assert.deepEqual(owner.release(), { generation: 2 });
	assert.equal(owner.isOwned(), false);
	assert.equal(owner.generation(), 2);
	assert.deepEqual(events, ['register:main', 'unregister:main']);
});

void test('remote copy ownership replaces registration with its context', () => {
	const events: string[] = [];
	const owner = factory()({
		warn: (_context, message) => events.push(message),
	});
	owner.setContext(createContext('main', events));
	owner.acquire();

	owner.setContext(createContext('other', events));

	assert.deepEqual(events, [
		'register:main',
		'unregister:main',
		'register:other',
	]);
});

void test('registration reentry cannot publish stale remote ownership', () => {
	const events: string[] = [];
	const owner = factory()({
		warn: (_context, message) => events.push(message),
	});
	owner.setContext(
		createContext('main', events, () => {
			owner.release();
			return () => events.push('unregister:reentrant');
		}),
	);

	owner.acquire();

	assert.equal(owner.isOwned(), false);
	assert.deepEqual(events, ['register:main', 'unregister:reentrant']);
});

void test('async settlement unregisters only the current ownership generation', async () => {
	const events: string[] = [];
	const owner = factory()({
		warn: (_context, message) => events.push(message),
	});
	owner.setContext(createContext('main', events));
	owner.acquire();
	const stale = owner.transition();
	let settleOld!: () => void;
	const oldCleanup = new Promise<void>((resolve) => {
		settleOld = resolve;
	});
	void oldCleanup.then(() => owner.settle(stale, false));
	owner.acquire();
	settleOld();
	await oldCleanup;
	await Promise.resolve();

	assert.equal(owner.isOwned(), true);
	assert.equal(owner.settle(stale, false), false);
	const current = owner.transition();
	assert.equal(owner.settle(current, false), true);
	assert.equal(owner.isOwned(), false);
	assert.equal(events.at(-1), 'unregister:main');
});

void test('remote copy ownership disposal is final and unregisters once', () => {
	const events: string[] = [];
	const owner = factory()({
		warn: (_context, message) => events.push(message),
	});
	owner.setContext(createContext('main', events));
	owner.acquire();

	owner.dispose();
	owner.dispose();
	owner.acquire();

	assert.equal(owner.isOwned(), false);
	assert.equal(owner.generation(), 2);
	assert.deepEqual(events, ['register:main', 'unregister:main']);
});
