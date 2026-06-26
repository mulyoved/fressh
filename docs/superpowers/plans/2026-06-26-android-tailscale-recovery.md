# Android Tailscale Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build close Android Tailscale integration so Fressh nudges Tailscale before SSH auto-connect, recovers network-like SSH failures, and gives clear manual recovery actions when automatic recovery fails.

**Architecture:** Add an Android native module for Tailscale intents, a pure TypeScript policy layer for cooldowns and failure classification, and a small orchestration layer used by the existing `AutoConnectManager`. Fressh verifies recovery by retrying SSH, while `DISCONNECT_VPN` stays behind a manual reset action.

**Tech Stack:** Expo config plugins, React Native `NativeModules`, Kotlin Android intents, TypeScript, Zustand/React state, Node `node:test`, Expo preview Android build.

---

## File Structure

- Create `apps/mobile/plugins/tailscale-android/TailscaleModule.kt`
  - Android native module that sends Tailscale `CONNECT_VPN` and `DISCONNECT_VPN` broadcasts, opens the Tailscale app, and checks package availability.
- Create `apps/mobile/plugins/with-tailscale.ts`
  - Expo config plugin that adds Android package visibility for Tailscale, writes the native module and package files, and registers the React package in `MainApplication.kt`.
- Modify `apps/mobile/app.config.ts`
  - Add `./plugins/with-tailscale` to the plugin list after foreground service registration.
- Create `apps/mobile/src/lib/tailscale-native-core.ts`
  - Dependency-injected TypeScript wrapper around the native module. This is the unit-testable surface.
- Create `apps/mobile/src/lib/tailscale-native.ts`
  - React Native binding that passes `Platform.OS`, `NativeModules.FresshTailscale`, and `rootLogger` into the core wrapper.
- Create `apps/mobile/src/lib/tailscale-recovery-core.ts`
  - Pure policy functions: platform gating, cooldown, SSH error classification, and recovery-result decisions.
- Create `apps/mobile/src/lib/tailscale-recovery.ts`
  - Runtime orchestration around `tailscaleNative`: ensure, recover after network failure, reset, open app, and sleep delays.
- Create `apps/mobile/src/lib/TailscaleRecoveryBanner.tsx`
  - Compact global Android recovery banner with `Open Tailscale`, `Retry`, and `Reset Tailscale` actions.
- Modify `apps/mobile/src/lib/auto-connect.tsx`
  - Integrate Tailscale ensure/recover/reset into the existing reconnect loop and render the banner when recovery needs attention.
- Create tests:
  - `apps/mobile/test/integration/tailscale-plugin.test.ts`
  - `apps/mobile/test/integration/tailscale-native-core.test.ts`
  - `apps/mobile/test/integration/tailscale-recovery-core.test.ts`
  - `apps/mobile/test/integration/tailscale-recovery.test.ts`

## Task 1: Native Wrapper Core

**Files:**
- Create: `apps/mobile/src/lib/tailscale-native-core.ts`
- Test: `apps/mobile/test/integration/tailscale-native-core.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/integration/tailscale-native-core.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTailscaleNativeController } from '../../src/lib/tailscale-native-core';

void test('Tailscale native controller skips unsupported platforms', async () => {
	const calls: string[] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'ios',
		getNativeModule: () => ({
			connect: async () => {
				calls.push('connect');
				return { attempted: true };
			},
		}),
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(calls, []);
});

void test('Tailscale native controller reports native successes', async () => {
	const calls: string[] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			isAvailable: async () => true,
			connect: async () => {
				calls.push('connect');
				return { attempted: true };
			},
			disconnect: async () => {
				calls.push('disconnect');
				return { attempted: true };
			},
			openApp: async () => {
				calls.push('openApp');
				return { attempted: true };
			},
		}),
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), true);
	assert.deepEqual(await controller.connect(), { attempted: true });
	assert.deepEqual(await controller.disconnect(), { attempted: true });
	assert.deepEqual(await controller.openApp(), { attempted: true });
	assert.deepEqual(calls, ['connect', 'disconnect', 'openApp']);
});

void test('Tailscale native controller converts missing module to no-attempt results', async () => {
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => undefined,
		logger: { warn: () => {} },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(await controller.disconnect(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
});

void test('Tailscale native controller logs and returns false on native rejection', async () => {
	const error = new Error('broadcast rejected');
	const warnings: unknown[][] = [];
	const controller = createTailscaleNativeController({
		getPlatformOS: () => 'android',
		getNativeModule: () => ({
			isAvailable: async () => {
				throw error;
			},
			connect: async () => {
				throw error;
			},
			disconnect: async () => {
				throw error;
			},
			openApp: async () => {
				throw error;
			},
		}),
		logger: { warn: (...args) => warnings.push(args) },
	});

	assert.equal(await controller.isAvailable(), false);
	assert.deepEqual(await controller.connect(), { attempted: false });
	assert.deepEqual(await controller.disconnect(), { attempted: false });
	assert.deepEqual(await controller.openApp(), { attempted: false });
	assert.deepEqual(warnings, [
		['tailscale availability check failed', error],
		['tailscale connect intent failed', error],
		['tailscale disconnect intent failed', error],
		['tailscale open app failed', error],
	]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-native-core.test.ts
```

Expected: fail with `Cannot find module '../../src/lib/tailscale-native-core'`.

- [ ] **Step 3: Implement the native wrapper core**

Create `apps/mobile/src/lib/tailscale-native-core.ts`:

```ts
export type TailscaleNativeAttemptResult = {
	attempted: boolean;
};

export type TailscaleNativeModule = {
	isAvailable?: () => Promise<boolean>;
	connect?: () => Promise<TailscaleNativeAttemptResult>;
	disconnect?: () => Promise<TailscaleNativeAttemptResult>;
	openApp?: () => Promise<TailscaleNativeAttemptResult>;
};

type TailscaleNativeLogger = {
	warn: (message: string, ...args: unknown[]) => void;
};

type TailscaleNativeControllerDeps = {
	getPlatformOS: () => string;
	getNativeModule: () => TailscaleNativeModule | undefined;
	logger: TailscaleNativeLogger;
};

const noAttempt: TailscaleNativeAttemptResult = { attempted: false };

export function createTailscaleNativeController({
	getPlatformOS,
	getNativeModule,
	logger,
}: TailscaleNativeControllerDeps) {
	const getAndroidModule = () => {
		if (getPlatformOS() !== 'android') return undefined;
		return getNativeModule();
	};

	return {
		async isAvailable() {
			const nativeModule = getAndroidModule();
			if (!nativeModule?.isAvailable) return false;
			try {
				return await nativeModule.isAvailable();
			} catch (error) {
				logger.warn('tailscale availability check failed', error);
				return false;
			}
		},

		async connect(): Promise<TailscaleNativeAttemptResult> {
			const nativeModule = getAndroidModule();
			if (!nativeModule?.connect) return noAttempt;
			try {
				return await nativeModule.connect();
			} catch (error) {
				logger.warn('tailscale connect intent failed', error);
				return noAttempt;
			}
		},

		async disconnect(): Promise<TailscaleNativeAttemptResult> {
			const nativeModule = getAndroidModule();
			if (!nativeModule?.disconnect) return noAttempt;
			try {
				return await nativeModule.disconnect();
			} catch (error) {
				logger.warn('tailscale disconnect intent failed', error);
				return noAttempt;
			}
		},

		async openApp(): Promise<TailscaleNativeAttemptResult> {
			const nativeModule = getAndroidModule();
			if (!nativeModule?.openApp) return noAttempt;
			try {
				return await nativeModule.openApp();
			} catch (error) {
				logger.warn('tailscale open app failed', error);
				return noAttempt;
			}
		},
	};
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-native-core.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Add the React Native binding**

Create `apps/mobile/src/lib/tailscale-native.ts`:

```ts
import { NativeModules, Platform } from 'react-native';
import { createTailscaleNativeController } from './tailscale-native-core';
import { rootLogger } from './logger';

const nativeTailscaleModule = NativeModules.FresshTailscale;
const logger = rootLogger.extend('TailscaleNative');

export const tailscaleNative = createTailscaleNativeController({
	getPlatformOS: () => Platform.OS,
	getNativeModule: () => nativeTailscaleModule,
	logger,
});
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/tailscale-native-core.ts apps/mobile/src/lib/tailscale-native.ts apps/mobile/test/integration/tailscale-native-core.test.ts
git commit -m "Add Tailscale native wrapper core"
```

## Task 2: Expo Plugin And Android Native Module

**Files:**
- Create: `apps/mobile/plugins/tailscale-android/TailscaleModule.kt`
- Create: `apps/mobile/plugins/with-tailscale.ts`
- Modify: `apps/mobile/app.config.ts`
- Test: `apps/mobile/test/integration/tailscale-plugin.test.ts`

- [ ] **Step 1: Write the failing plugin tests**

Create `apps/mobile/test/integration/tailscale-plugin.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type * as ExpoConfigPlugins from 'expo/config-plugins';
import type withTailscaleType from '../../plugins/with-tailscale';

const require = createRequire(import.meta.url);
const { compileModsAsync } =
	require('expo/config-plugins') as typeof ExpoConfigPlugins;
const withTailscale = require('../../plugins/with-tailscale')
	.default as typeof withTailscaleType;

const MAIN_APPLICATION_FIXTURE = [
	'package com.finalapp.vibe2',
	'',
	'import com.facebook.react.PackageList',
	'',
	'class MainApplication {',
	'  fun getPackages() = PackageList(this).packages.apply {',
	'    // add(MyReactNativePackage())',
	'  }',
	'}',
].join('\n');

async function writeAndroidFixture(projectRoot: string) {
	await mkdir(
		path.join(projectRoot, 'android/app/src/main/java/com/finalapp/vibe2'),
		{ recursive: true },
	);
	await writeFile(
		path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
		[
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		].join('\n'),
		'utf8',
	);
	await writeFile(
		path.join(
			projectRoot,
			'android/app/src/main/java/com/finalapp/vibe2/MainApplication.kt',
		),
		MAIN_APPLICATION_FIXTURE,
		'utf8',
	);
}

async function generatedTailscaleSources() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-tailscale-plugin-'),
	);
	try {
		await writeAndroidFixture(projectRoot);
		const config = withTailscale({
			name: 'Fressh Test Fixture',
			slug: 'fressh-test-fixture',
			android: { package: 'com.finalapp.vibe2' },
		});
		await compileModsAsync(config, {
			projectRoot,
			platforms: ['android'],
		});
		const javaPath = path.join(
			projectRoot,
			'android/app/src/main/java/com/finalapp/vibe2',
		);
		return {
			manifest: await readFile(
				path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
				'utf8',
			),
			mainApplication: await readFile(
				path.join(javaPath, 'MainApplication.kt'),
				'utf8',
			),
			module: await readFile(path.join(javaPath, 'TailscaleModule.kt'), 'utf8'),
			packageSource: await readFile(
				path.join(javaPath, 'TailscalePackage.kt'),
				'utf8',
			),
		};
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

void test('Tailscale plugin registers package visibility and React package', async () => {
	const { manifest, mainApplication, packageSource } =
		await generatedTailscaleSources();

	assert.match(manifest, /<package android:name="com\.tailscale\.ipn"\/>/);
	assert.match(mainApplication, /add\(TailscalePackage\(\)\)/);
	assert.match(packageSource, /class TailscalePackage/);
	assert.match(packageSource, /TailscaleModule\(reactContext\)/);
});

void test('Tailscale native module uses explicit exported receiver actions', async () => {
	const { module } = await generatedTailscaleSources();

	assert.match(module, /TAILSCALE_PACKAGE = "com\.tailscale\.ipn"/);
	assert.match(module, /TAILSCALE_RECEIVER = "com\.tailscale\.ipn\.IPNReceiver"/);
	assert.match(module, /ACTION_CONNECT = "com\.tailscale\.ipn\.CONNECT_VPN"/);
	assert.match(module, /ACTION_DISCONNECT = "com\.tailscale\.ipn\.DISCONNECT_VPN"/);
	assert.match(module, /ComponentName\(TAILSCALE_PACKAGE, TAILSCALE_RECEIVER\)/);
	assert.doesNotMatch(module, /USE_EXIT_NODE/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-plugin.test.ts
```

Expected: fail with `Cannot find module '../../plugins/with-tailscale'`.

- [ ] **Step 3: Add the Kotlin native module template**

Create `apps/mobile/plugins/tailscale-android/TailscaleModule.kt`:

```kt
package com.finalapp.vibe2

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class TailscaleModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FresshTailscale"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(isTailscaleInstalled())
  }

  @ReactMethod
  fun connect(promise: Promise) {
    sendTailscaleBroadcast(ACTION_CONNECT, promise)
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    sendTailscaleBroadcast(ACTION_DISCONNECT, promise)
  }

  @ReactMethod
  fun openApp(promise: Promise) {
    try {
      val launchIntent = reactContext.packageManager
        .getLaunchIntentForPackage(TAILSCALE_PACKAGE)

      if (launchIntent == null) {
        promise.resolve(attemptResult(false))
        return
      }

      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(launchIntent)
      promise.resolve(attemptResult(true))
    } catch (e: Exception) {
      promise.reject("TAILSCALE_OPEN_FAILED", e)
    }
  }

  private fun sendTailscaleBroadcast(action: String, promise: Promise) {
    try {
      if (!isTailscaleInstalled()) {
        promise.resolve(attemptResult(false))
        return
      }

      val intent = Intent(action).apply {
        component = ComponentName(TAILSCALE_PACKAGE, TAILSCALE_RECEIVER)
      }
      reactContext.sendBroadcast(intent)
      promise.resolve(attemptResult(true))
    } catch (e: Exception) {
      promise.reject("TAILSCALE_BROADCAST_FAILED", e)
    }
  }

  private fun isTailscaleInstalled(): Boolean {
    return try {
      reactContext.packageManager.getPackageInfo(TAILSCALE_PACKAGE, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
  }

  private fun attemptResult(attempted: Boolean): WritableNativeMap {
    return WritableNativeMap().apply {
      putBoolean("attempted", attempted)
    }
  }

  companion object {
    private const val TAILSCALE_PACKAGE = "com.tailscale.ipn"
    private const val TAILSCALE_RECEIVER = "com.tailscale.ipn.IPNReceiver"
    private const val ACTION_CONNECT = "com.tailscale.ipn.CONNECT_VPN"
    private const val ACTION_DISCONNECT = "com.tailscale.ipn.DISCONNECT_VPN"
  }
}
```

- [ ] **Step 4: Add the Expo config plugin**

Create `apps/mobile/plugins/with-tailscale.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
	withMainApplication,
} from 'expo/config-plugins';

const TAILSCALE_PACKAGE = 'com.tailscale.ipn';
const TAILSCALE_PACKAGE_REGISTRATION = 'add(TailscalePackage())';
const JAVA_PACKAGE_RELATIVE_PATH = 'app/src/main/java/com/finalapp/vibe2';
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_TEMPLATE_SOURCE_PATH = path.join(PLUGIN_DIR, 'tailscale-android');

const TAILSCALE_PACKAGE_KOTLIN = `package com.finalapp.vibe2

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class TailscalePackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ) = listOf(
    TailscaleModule(reactContext)
  )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`;

async function readAndroidTemplateSource(filename: string) {
	return fs.readFile(path.join(ANDROID_TEMPLATE_SOURCE_PATH, filename), 'utf8');
}

function findMatchingBrace(contents: string, openBraceIndex: number): number {
	let depth = 0;
	for (let index = openBraceIndex; index < contents.length; index += 1) {
		const char = contents[index];
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

function addTailscalePackageRegistration(contents: string): string {
	const packageListApply = 'PackageList(this).packages.apply {';
	const applyIndex = contents.indexOf(packageListApply);
	if (applyIndex === -1) {
		throw new Error(
			`Could not find ${packageListApply} in Android MainApplication.kt`,
		);
	}

	const openBraceIndex = contents.indexOf('{', applyIndex);
	const closeBraceIndex = findMatchingBrace(contents, openBraceIndex);
	if (closeBraceIndex === -1) {
		throw new Error(
			'Could not find PackageList(this).packages.apply block end in Android MainApplication.kt',
		);
	}

	const applyBlock = contents.slice(openBraceIndex + 1, closeBraceIndex);
	if (applyBlock.includes(TAILSCALE_PACKAGE_REGISTRATION)) return contents;

	const blockLines = applyBlock.split('\n');
	const indentedLine = blockLines.find((line) => line.trim().length > 0);
	const indent = indentedLine?.match(/^\s*/)?.[0] ?? '              ';
	const closeBraceLineStart = contents.lastIndexOf('\n', closeBraceIndex) + 1;

	return `${contents.slice(0, closeBraceLineStart)}${indent}${TAILSCALE_PACKAGE_REGISTRATION}\n${contents.slice(closeBraceLineStart)}`;
}

const withTailscaleQueries: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		const manifest = config.modResults;
		type AndroidManifestWithQueries = typeof manifest & {
			queries?: { package?: { $: { 'android:name': string } }[] }[];
		};
		const manifestWithQueries = manifest as AndroidManifestWithQueries;
		const queries = (manifestWithQueries.queries ??= [{}]);
		const firstQuery = (queries[0] ??= {});
		const packages = (firstQuery.package ??= []);
		if (
			!packages.some(
				(entry) => entry.$['android:name'] === TAILSCALE_PACKAGE,
			)
		) {
			packages.push({ $: { 'android:name': TAILSCALE_PACKAGE } });
		}
		return config;
	});

const withTailscalePackageRegistration: ConfigPlugin = (config) =>
	withMainApplication(config, (config) => {
		config.modResults.contents = addTailscalePackageRegistration(
			config.modResults.contents,
		);
		return config;
	});

const withTailscaleNativeFiles: ConfigPlugin = (config) =>
	withDangerousMod(config, [
		'android',
		async (config) => {
			const javaPackagePath = path.join(
				config.modRequest.platformProjectRoot,
				JAVA_PACKAGE_RELATIVE_PATH,
			);
			await fs.mkdir(javaPackagePath, { recursive: true });

			await fs.writeFile(
				path.join(javaPackagePath, 'TailscaleModule.kt'),
				await readAndroidTemplateSource('TailscaleModule.kt'),
				'utf8',
			);
			await fs.writeFile(
				path.join(javaPackagePath, 'TailscalePackage.kt'),
				TAILSCALE_PACKAGE_KOTLIN,
				'utf8',
			);

			return config;
		},
	]);

const withTailscale: ConfigPlugin = (config) => {
	config = withTailscaleQueries(config);
	config = withTailscalePackageRegistration(config);
	config = withTailscaleNativeFiles(config);
	return config;
};

export default withTailscale;
```

- [ ] **Step 5: Register the plugin in app config**

Modify `apps/mobile/app.config.ts` plugin list:

```ts
		'./plugins/with-foreground-service',
		'./plugins/with-tailscale',
		'./plugins/with-wispr-automation',
```

- [ ] **Step 6: Run the plugin tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-plugin.test.ts
```

Expected: both tests pass.

- [ ] **Step 7: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/plugins/tailscale-android/TailscaleModule.kt apps/mobile/plugins/with-tailscale.ts apps/mobile/app.config.ts apps/mobile/test/integration/tailscale-plugin.test.ts
git commit -m "Add Android Tailscale native module"
```

## Task 3: Tailscale Recovery Policy Core

**Files:**
- Create: `apps/mobile/src/lib/tailscale-recovery-core.ts`
- Test: `apps/mobile/test/integration/tailscale-recovery-core.test.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `apps/mobile/test/integration/tailscale-recovery-core.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
	shouldShowTailscaleAttention,
} from '../../src/lib/tailscale-recovery-core';

void test('Tailscale recovery is Android-only', () => {
	assert.equal(isTailscaleRecoverySupported('android'), true);
	assert.equal(isTailscaleRecoverySupported('ios'), false);
	assert.equal(isTailscaleRecoverySupported('web'), false);
});

void test('network-like SSH errors trigger Tailscale recovery', () => {
	for (const message of [
		'Network is unreachable',
		'No route to host',
		'Connection timed out',
		'Operation timed out',
		'Unable to resolve host dev-remote-machine-1',
		'Connection reset by peer',
		'Broken pipe',
	]) {
		assert.equal(isNetworkLikeSshError(new Error(message)), true, message);
	}
});

void test('non-network SSH errors do not trigger Tailscale recovery', () => {
	for (const error of [
		{ tag: 'TmuxAttachFailed', inner: ['session missing'] },
		new Error('Permission denied (publickey)'),
		new Error('Host key verification failed'),
		new Error('Key missing'),
		new Error('Authentication failed'),
	]) {
		assert.equal(isNetworkLikeSshError(error), false, JSON.stringify(error));
	}
});

void test('Tailscale recovery cooldown allows first attempt and throttles the next', () => {
	const cooldown = createTailscaleRecoveryCooldown({ cooldownMs: 20_000 });

	assert.equal(cooldown.canAttempt(1_000), true);
	cooldown.recordAttempt(1_000);
	assert.equal(cooldown.canAttempt(5_000), false);
	assert.equal(cooldown.canAttempt(21_000), true);
});

void test('attention state appears after failed automatic recovery', () => {
	assert.equal(
		shouldShowTailscaleAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: false,
		}),
		true,
	);
	assert.equal(
		shouldShowTailscaleAttention({
			platformOS: 'android',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: true,
		}),
		false,
	);
	assert.equal(
		shouldShowTailscaleAttention({
			platformOS: 'ios',
			networkLikeFailure: true,
			recoveryAttempted: true,
			retrySucceeded: false,
		}),
		false,
	);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-core.test.ts
```

Expected: fail with `Cannot find module '../../src/lib/tailscale-recovery-core'`.

- [ ] **Step 3: Implement the policy core**

Create `apps/mobile/src/lib/tailscale-recovery-core.ts`:

```ts
export const DEFAULT_TAILSCALE_RECOVERY_COOLDOWN_MS = 20_000;
export const DEFAULT_TAILSCALE_SETTLE_DELAY_MS = 3_000;
export const DEFAULT_TAILSCALE_RESET_DELAY_MS = 1_500;

export function isTailscaleRecoverySupported(platformOS: string) {
	return platformOS === 'android';
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function isNetworkLikeSshError(error: unknown) {
	if (
		error &&
		typeof error === 'object' &&
		(error as { tag?: unknown }).tag === 'TmuxAttachFailed'
	) {
		return false;
	}

	const text = errorText(error).toLowerCase();
	if (
		text.includes('permission denied') ||
		text.includes('authentication failed') ||
		text.includes('host key') ||
		text.includes('key missing')
	) {
		return false;
	}

	return [
		'network is unreachable',
		'no route to host',
		'connection timed out',
		'operation timed out',
		'unable to resolve host',
		'connection reset',
		'broken pipe',
		'software caused connection abort',
	].some((needle) => text.includes(needle));
}

export function createTailscaleRecoveryCooldown(opts?: { cooldownMs?: number }) {
	const cooldownMs =
		opts?.cooldownMs ?? DEFAULT_TAILSCALE_RECOVERY_COOLDOWN_MS;
	let lastAttemptAtMs: number | null = null;

	return {
		canAttempt(nowMs: number) {
			return (
				lastAttemptAtMs === null || nowMs - lastAttemptAtMs >= cooldownMs
			);
		},
		recordAttempt(nowMs: number) {
			lastAttemptAtMs = nowMs;
		},
		reset() {
			lastAttemptAtMs = null;
		},
	};
}

export function shouldShowTailscaleAttention(input: {
	platformOS: string;
	networkLikeFailure: boolean;
	recoveryAttempted: boolean;
	retrySucceeded: boolean;
}) {
	return (
		isTailscaleRecoverySupported(input.platformOS) &&
		input.networkLikeFailure &&
		input.recoveryAttempted &&
		!input.retrySucceeded
	);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-core.test.ts
```

Expected: all five tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/tailscale-recovery-core.ts apps/mobile/test/integration/tailscale-recovery-core.test.ts
git commit -m "Add Tailscale recovery policy"
```

## Task 4: Runtime Recovery Orchestration

**Files:**
- Create: `apps/mobile/src/lib/tailscale-recovery.ts`
- Test: `apps/mobile/test/integration/tailscale-recovery.test.ts`

- [ ] **Step 1: Write the failing orchestration tests**

Create `apps/mobile/test/integration/tailscale-recovery.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createTailscaleRecoveryController,
	type TailscaleRecoveryNative,
} from '../../src/lib/tailscale-recovery';

function nativeFixture(calls: string[]): TailscaleRecoveryNative {
	return {
		isAvailable: async () => {
			calls.push('isAvailable');
			return true;
		},
		connect: async () => {
			calls.push('connect');
			return { attempted: true };
		},
		disconnect: async () => {
			calls.push('disconnect');
			return { attempted: true };
		},
		openApp: async () => {
			calls.push('openApp');
			return { attempted: true };
		},
	};
}

void test('ensureReady nudges Tailscale on Android and waits', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.ensureReady(), {
		attempted: true,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect']);
	assert.deepEqual(waits, [3_000]);
});

void test('ensureReady respects cooldown', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	await controller.ensureReady();
	assert.deepEqual(await controller.ensureReady(), {
		attempted: false,
		available: true,
	});
	assert.deepEqual(calls, ['isAvailable', 'connect', 'isAvailable']);
});

void test('recoverAfterFailure skips non-network errors', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	assert.deepEqual(
		await controller.recoverAfterFailure(new Error('Permission denied')),
		{ attempted: false, networkLikeFailure: false, available: true },
	);
	assert.deepEqual(calls, ['isAvailable']);
});

void test('manual reset disconnects, connects, and waits between actions', async () => {
	const calls: string[] = [];
	const waits: number[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async (ms) => {
			waits.push(ms);
		},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.reset(), { attempted: true });
	assert.deepEqual(calls, ['disconnect', 'connect']);
	assert.deepEqual(waits, [1_500, 3_000]);
});

void test('openApp delegates to native module', async () => {
	const calls: string[] = [];
	const controller = createTailscaleRecoveryController({
		getPlatformOS: () => 'android',
		getNowMs: () => 1_000,
		sleep: async () => {},
		native: nativeFixture(calls),
	});

	assert.deepEqual(await controller.openApp(), { attempted: true });
	assert.deepEqual(calls, ['openApp']);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery.test.ts
```

Expected: fail with `Cannot find module '../../src/lib/tailscale-recovery'`.

- [ ] **Step 3: Implement the runtime controller**

Create `apps/mobile/src/lib/tailscale-recovery.ts`:

```ts
import { Platform } from 'react-native';
import { tailscaleNative } from './tailscale-native';
import {
	DEFAULT_TAILSCALE_RESET_DELAY_MS,
	DEFAULT_TAILSCALE_SETTLE_DELAY_MS,
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
} from './tailscale-recovery-core';

export type TailscaleRecoveryNative = {
	isAvailable: () => Promise<boolean>;
	connect: () => Promise<{ attempted: boolean }>;
	disconnect: () => Promise<{ attempted: boolean }>;
	openApp: () => Promise<{ attempted: boolean }>;
};

type TailscaleRecoveryControllerDeps = {
	getPlatformOS: () => string;
	getNowMs: () => number;
	sleep: (ms: number) => Promise<void>;
	native: TailscaleRecoveryNative;
};

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

export function createTailscaleRecoveryController({
	getPlatformOS,
	getNowMs,
	sleep,
	native,
}: TailscaleRecoveryControllerDeps) {
	const cooldown = createTailscaleRecoveryCooldown();

	const ensureAvailable = async () => {
		if (!isTailscaleRecoverySupported(getPlatformOS())) return false;
		return native.isAvailable();
	};

	const connectWithCooldown = async () => {
		const available = await ensureAvailable();
		if (!available) return { attempted: false, available };
		const nowMs = getNowMs();
		if (!cooldown.canAttempt(nowMs)) return { attempted: false, available };
		cooldown.recordAttempt(nowMs);
		const result = await native.connect();
		if (result.attempted) {
			await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
		}
		return { attempted: result.attempted, available };
	};

	return {
		async ensureReady() {
			return connectWithCooldown();
		},

		async recoverAfterFailure(error: unknown) {
			const available = await ensureAvailable();
			const networkLikeFailure = isNetworkLikeSshError(error);
			if (!available || !networkLikeFailure) {
				return {
					attempted: false,
					networkLikeFailure,
					available,
				};
			}
			const result = await connectWithCooldown();
			return {
				attempted: result.attempted,
				networkLikeFailure,
				available,
			};
		},

		async reset() {
			if (!isTailscaleRecoverySupported(getPlatformOS())) {
				return { attempted: false };
			}
			const disconnectResult = await native.disconnect();
			if (disconnectResult.attempted) {
				await sleep(DEFAULT_TAILSCALE_RESET_DELAY_MS);
			}
			const connectResult = await native.connect();
			if (connectResult.attempted) {
				cooldown.recordAttempt(getNowMs());
				await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
			}
			return {
				attempted: disconnectResult.attempted || connectResult.attempted,
			};
		},

		async openApp() {
			if (!isTailscaleRecoverySupported(getPlatformOS())) {
				return { attempted: false };
			}
			return native.openApp();
		},

		resetCooldown() {
			cooldown.reset();
		},
	};
}

export const tailscaleRecovery = createTailscaleRecoveryController({
	getPlatformOS: () => Platform.OS,
	getNowMs: () => Date.now(),
	sleep: defaultSleep,
	native: tailscaleNative,
});
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery.test.ts
```

Expected: all five tests pass.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/tailscale-recovery.ts apps/mobile/test/integration/tailscale-recovery.test.ts
git commit -m "Add Tailscale recovery orchestration"
```

## Task 5: Auto-Connect Integration

**Files:**
- Modify: `apps/mobile/src/lib/auto-connect.tsx`
- Test: `apps/mobile/test/integration/tailscale-recovery-core.test.ts`
- Test: `apps/mobile/test/integration/tailscale-recovery.test.ts`

- [ ] **Step 1: Add imports and recovery state types**

Modify the import section in `apps/mobile/src/lib/auto-connect.tsx`:

```ts
import { tailscaleRecovery } from './tailscale-recovery';
import { shouldShowTailscaleAttention } from './tailscale-recovery-core';
```

Add these types below the reconnect constants:

```ts
type TailscaleRecoveryUiState =
	| { phase: 'hidden' }
	| {
			phase: 'needsAttention';
			message: string;
	  }
	| { phase: 'recovering'; message: string };

const hiddenTailscaleRecoveryState: TailscaleRecoveryUiState = {
	phase: 'hidden',
};
```

- [ ] **Step 2: Add local state and helper callbacks inside `AutoConnectManager`**

Inside `AutoConnectManager`, after `launchUrlSuppressAutoConnectRef`, add:

```ts
	const [tailscaleRecoveryUiState, setTailscaleRecoveryUiState] =
		React.useState<TailscaleRecoveryUiState>(
			hiddenTailscaleRecoveryState,
		);

	const clearTailscaleAttention = React.useCallback(() => {
		setTailscaleRecoveryUiState(hiddenTailscaleRecoveryState);
	}, []);

	const markTailscaleAttention = React.useCallback((message: string) => {
		setTailscaleRecoveryUiState({
			phase: 'needsAttention',
			message,
		});
	}, []);
```

- [ ] **Step 3: Ensure Tailscale before saved auto-connect**

In `attemptAutoConnect`, after `const latestEntry = await loadLatestSavedConnection();` and before `const details = latestEntry.value;`, insert:

```ts
			const tailscaleReady = await tailscaleRecovery.ensureReady();
			if (!tailscaleReady.available && Platform.OS === 'android') {
				markTailscaleAttention(
					'Tailscale is required for this SSH connection. Open Tailscale, then retry Fressh.',
				);
				return false;
			}
```

Add `markTailscaleAttention` to the `attemptAutoConnect` dependency array.

- [ ] **Step 4: Wrap the saved connection attempt with one Tailscale recovery retry**

Replace the saved connection `connectAndOpenShell` block in `attemptAutoConnect`:

```ts
			const result = await connectAndOpenShell({
				connectionDetails: normalizedDetails,
				resolvedSecurity,
				connect,
				navigate: ({ connectionId, channelId }) => {
					navigateToShell(connectionId, channelId);
				},
			});
			if (result.status === 'tmux_attach_failed') {
				logger.info('Auto-connect tmux attach failed, will retry', {
					connectionId: result.connectionId,
					tmuxAttachFailureReason: result.tmuxAttachFailureReason,
					tmuxSessionName: result.tmuxSessionName,
				});
				return false;
			}
			return true;
```

with:

```ts
			const connectSavedEntry = async () =>
				connectAndOpenShell({
					connectionDetails: normalizedDetails,
					resolvedSecurity,
					connect,
					navigate: ({ connectionId, channelId }) => {
						navigateToShell(connectionId, channelId);
					},
				});

			try {
				const result = await connectSavedEntry();
				if (result.status === 'tmux_attach_failed') {
					logger.info('Auto-connect tmux attach failed, will retry', {
						connectionId: result.connectionId,
						tmuxAttachFailureReason: result.tmuxAttachFailureReason,
						tmuxSessionName: result.tmuxSessionName,
					});
					return false;
				}
				clearTailscaleAttention();
				return true;
			} catch (error) {
				const recovery = await tailscaleRecovery.recoverAfterFailure(error);
				if (!recovery.networkLikeFailure) throw error;
				if (!recovery.attempted) {
					if (
						shouldShowTailscaleAttention({
							platformOS: Platform.OS,
							networkLikeFailure: recovery.networkLikeFailure,
							recoveryAttempted: recovery.attempted,
							retrySucceeded: false,
						}) ||
						!recovery.available
					) {
						markTailscaleAttention(
							'Tailscale connection needs attention. Open Tailscale, then retry Fressh.',
						);
					}
					return false;
				}
				try {
					const retryResult = await connectSavedEntry();
					if (retryResult.status === 'connected') {
						clearTailscaleAttention();
						return true;
					}
					return false;
				} catch (retryError) {
					if (
						shouldShowTailscaleAttention({
							platformOS: Platform.OS,
							networkLikeFailure: true,
							recoveryAttempted: true,
							retrySucceeded: false,
						})
					) {
						markTailscaleAttention(
							'Fressh could not reach the SSH host after restarting Tailscale.',
						);
					}
					logger.warn('Auto-connect retry after Tailscale recovery failed', retryError);
					return false;
				}
			}
```

Add `clearTailscaleAttention` to the `attemptAutoConnect` dependency array.

- [ ] **Step 5: Add manual recovery callbacks**

Inside `AutoConnectManager`, before the final `return`, add:

```ts
	const handleOpenTailscale = React.useCallback(() => {
		void tailscaleRecovery.openApp();
	}, []);

	const handleRetryAfterTailscaleRecovery = React.useCallback(() => {
		clearTailscaleAttention();
		void scheduleReconnect('tailscale-retry-action');
	}, [clearTailscaleAttention, scheduleReconnect]);

	const handleResetTailscale = React.useCallback(() => {
		setTailscaleRecoveryUiState({
			phase: 'recovering',
			message: 'Resetting Tailscale...',
		});
		void tailscaleRecovery
			.reset()
			.then(() => {
				clearTailscaleAttention();
				void scheduleReconnect('tailscale-reset-action');
			})
			.catch((error: unknown) => {
				logger.warn('Manual Tailscale reset failed', error);
				markTailscaleAttention(
					'Tailscale reset failed. Open Tailscale, then retry Fressh.',
				);
			});
	}, [clearTailscaleAttention, markTailscaleAttention, scheduleReconnect]);
```

- [ ] **Step 6: Change the return value to render the banner**

At the bottom of `AutoConnectManager`, replace:

```tsx
	return (
		<AgentNotificationBridgeManager
			preservePendingWithoutTarget={reconnectExpectedFromShellDrop}
		/>
	);
```

with:

```tsx
	return (
		<>
			<AgentNotificationBridgeManager
				preservePendingWithoutTarget={reconnectExpectedFromShellDrop}
			/>
			<TailscaleRecoveryBanner
				state={tailscaleRecoveryUiState}
				onOpenTailscale={handleOpenTailscale}
				onRetry={handleRetryAfterTailscaleRecovery}
				onReset={handleResetTailscale}
			/>
		</>
	);
```

Add the component import after the existing local imports:

```ts
import { TailscaleRecoveryBanner } from './TailscaleRecoveryBanner';
```

- [ ] **Step 7: Run policy and orchestration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/tailscale-recovery-core.test.ts test/integration/tailscale-recovery.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Run typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/lib/auto-connect.tsx
git commit -m "Integrate Tailscale recovery with auto-connect"
```

## Task 6: Recovery Banner UI

**Files:**
- Create: `apps/mobile/src/lib/TailscaleRecoveryBanner.tsx`
- Modify: `apps/mobile/src/lib/auto-connect.tsx`

- [ ] **Step 1: Create the banner component**

Create `apps/mobile/src/lib/TailscaleRecoveryBanner.tsx`:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';

type TailscaleRecoveryBannerState =
	| { phase: 'hidden' }
	| { phase: 'needsAttention'; message: string }
	| { phase: 'recovering'; message: string };

export function TailscaleRecoveryBanner(props: {
	state: TailscaleRecoveryBannerState;
	onOpenTailscale: () => void;
	onRetry: () => void;
	onReset: () => void;
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	if (props.state.phase === 'hidden') return null;

	const busy = props.state.phase === 'recovering';

	return (
		<View
			pointerEvents="box-none"
			style={[
				styles.root,
				{
					paddingTop: insets.top + 8,
					paddingHorizontal: 12,
				},
			]}
		>
			<View
				style={[
					styles.banner,
					{
						backgroundColor: theme.colors.surface,
						borderColor: theme.colors.border,
						shadowColor: theme.colors.shadow,
					},
				]}
			>
				<Text style={[styles.title, { color: theme.colors.textPrimary }]}>
					Tailscale connection needs attention
				</Text>
				<Text style={[styles.message, { color: theme.colors.textSecondary }]}>
					{props.state.message}
				</Text>
				<View style={styles.actions}>
					<Pressable
						disabled={busy}
						onPress={props.onOpenTailscale}
						style={[
							styles.primaryButton,
							{
								backgroundColor: busy
									? theme.colors.primaryDisabled
									: theme.colors.primary,
							},
						]}
					>
						<Text
							style={[
								styles.primaryButtonText,
								{ color: theme.colors.buttonTextOnPrimary },
							]}
						>
							Open Tailscale
						</Text>
					</Pressable>
					<Pressable
						disabled={busy}
						onPress={props.onRetry}
						style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
					>
						<Text
							style={[styles.secondaryButtonText, { color: theme.colors.textPrimary }]}
						>
							Retry
						</Text>
					</Pressable>
					<Pressable
						disabled={busy}
						onPress={props.onReset}
						style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
					>
						<Text
							style={[styles.secondaryButtonText, { color: theme.colors.textPrimary }]}
						>
							Reset
						</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		left: 0,
		position: 'absolute',
		right: 0,
		top: 0,
		zIndex: 1000,
	},
	banner: {
		borderRadius: 8,
		borderWidth: 1,
		elevation: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		shadowOffset: { width: 0, height: 3 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
	},
	title: {
		fontSize: 14,
		fontWeight: '700',
	},
	message: {
		fontSize: 12,
		lineHeight: 17,
		marginTop: 4,
	},
	actions: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 8,
		marginTop: 10,
	},
	primaryButton: {
		alignItems: 'center',
		borderRadius: 6,
		minHeight: 34,
		justifyContent: 'center',
		paddingHorizontal: 12,
	},
	primaryButtonText: {
		fontSize: 12,
		fontWeight: '700',
	},
	secondaryButton: {
		alignItems: 'center',
		borderRadius: 6,
		borderWidth: 1,
		minHeight: 34,
		justifyContent: 'center',
		paddingHorizontal: 12,
	},
	secondaryButtonText: {
		fontSize: 12,
		fontWeight: '700',
	},
});
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 3: Run lint check for touched files through package lint**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: pass with no ESLint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/TailscaleRecoveryBanner.tsx apps/mobile/src/lib/auto-connect.tsx
git commit -m "Add Tailscale recovery banner"
```

## Task 7: Native Compile And Android Verification

**Files:**
- Native generated files under `apps/mobile/android/**` may be updated by Expo prebuild.
- No source files should change unless verification finds a real issue.

- [ ] **Step 1: Run all focused integration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/tailscale-native-core.test.ts \
  test/integration/tailscale-plugin.test.ts \
  test/integration/tailscale-recovery-core.test.ts \
  test/integration/tailscale-recovery.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 3: Run Android prebuild Kotlin compile**

Run:

```bash
cd apps/mobile && pnpm run android:prebuild-compile-debug-kotlin
```

Expected: Expo prebuild completes and Gradle `:app:compileDebugKotlin` passes.

- [ ] **Step 4: Commit generated native mirrors if Expo prebuild changed them**

Run:

```bash
git status --short apps/mobile/android apps/mobile/plugins apps/mobile/app.config.ts
```

If `apps/mobile/android/**` contains generated changes for `TailscaleModule.kt`, `TailscalePackage.kt`, manifest queries, or `MainApplication.kt`, commit them:

```bash
git add apps/mobile/android apps/mobile/plugins apps/mobile/app.config.ts
git commit -m "Sync Android Tailscale native files"
```

Expected: either a clean status for these paths or a commit containing only generated Android native integration changes.

- [ ] **Step 5: Build Android preview locally**

Run:

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Expected: local preview build succeeds and prints the APK/AAB output path.

- [ ] **Step 6: Manual Android preview verification**

Use a device with package `com.finalapp.vibe2` and Tailscale installed.

1. Confirm the device is reachable:

```bash
adb connect 100.113.210.6:5555
adb devices
```

Expected: the device appears with state `device`.

2. Install the preview artifact if the build did not install it automatically.

3. In Fressh, ensure the target saved connection has `autoConnect` enabled and requires Tailscale routing.

4. Disconnect Tailscale manually from the Tailscale app.

5. Launch Fressh:

```bash
adb shell monkey -p com.finalapp.vibe2 -c android.intent.category.LAUNCHER 1
```

Expected: Fressh nudges Tailscale and reconnects SSH without restarting the app.

6. Force a hard failure by signing out of Tailscale or making the tailnet target unreachable, then relaunch Fressh.

Expected: the banner appears with `Open Tailscale`, `Retry`, and `Reset`.

7. Tap `Open Tailscale`.

Expected: Android opens the Tailscale app.

8. Return to Fressh and tap `Retry`.

Expected: Fressh runs the reconnect path again.

9. Tap `Reset`.

Expected: Fressh sends disconnect then connect, waits, and retries SSH.

- [ ] **Step 7: Final full check**

Run:

```bash
pnpm exec turbo lint:check
pnpm --filter @fressh/mobile exec tsx --test test/integration/**/*.test.ts
```

Expected: lint check passes and mobile integration tests pass.

- [ ] **Step 8: Commit verification fixes if needed**

If Step 7 required source changes, commit only those changes:

```bash
git add apps/mobile
git commit -m "Fix Tailscale recovery verification issues"
```

Expected: no commit is created if no fixes were needed.

## Self-Review

Spec coverage:

- Required Android Tailscale dependency: Task 5 ensures Tailscale before saved Android auto-connect.
- Tailscale Android contract: Task 2 uses `com.tailscale.ipn.CONNECT_VPN` and `DISCONNECT_VPN` with an explicit receiver.
- SSH-based verification: Task 5 treats recovery as successful only after `connectAndOpenShell` succeeds.
- Manual reset only: Task 4 exposes reset, and Task 5 calls it only from the banner action.
- Cooldown and network-like classification: Task 3 covers both with focused tests.
- UI recovery state: Task 6 adds the banner and Task 5 wires actions.
- Existing reconnect/foreground behavior: Task 5 plugs into `AutoConnectManager` without replacing its reconnect loop.
- Android verification: Task 7 includes Kotlin compile, preview build, and manual device checks.

Red-flag wording scan: no unresolved markers remain in this plan.

Type consistency:

- `TailscaleNativeAttemptResult` uses `{ attempted: boolean }` in native core, runtime recovery, and native Kotlin maps.
- `TailscaleRecoveryUiState` matches the `TailscaleRecoveryBanner` accepted `state` prop.
- `tailscaleRecovery.ensureReady`, `recoverAfterFailure`, `reset`, and `openApp` are defined before `auto-connect.tsx` imports them.
