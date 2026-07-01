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

async function generatedTailscaleSourcesAfterTwoRuns() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-tailscale-plugin-'),
	);
	try {
		await writeAndroidFixture(projectRoot);
		for (let index = 0; index < 2; index += 1) {
			const config = withTailscale({
				name: 'Fressh Test Fixture',
				slug: 'fressh-test-fixture',
				android: { package: 'com.finalapp.vibe2' },
			});
			await compileModsAsync(config, {
				projectRoot,
				platforms: ['android'],
			});
		}

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
		};
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

function countMatches(value: string, pattern: RegExp) {
	return Array.from(value.matchAll(pattern)).length;
}

void test('Tailscale plugin registers package visibility and React package', async () => {
	const { manifest, mainApplication, packageSource } =
		await generatedTailscaleSources();

	assert.match(manifest, /<package android:name="com\.tailscale\.ipn"\/>/);
	assert.match(mainApplication, /add\(TailscalePackage\(\)\)/);
	assert.match(packageSource, /class TailscalePackage/);
	assert.match(packageSource, /TailscaleModule\(reactContext\)/);
});

void test('Tailscale plugin is idempotent across repeated mod runs', async () => {
	const { manifest, mainApplication } =
		await generatedTailscaleSourcesAfterTwoRuns();

	assert.equal(
		countMatches(manifest, /<package android:name="com\.tailscale\.ipn"\/>/g),
		1,
	);
	assert.equal(
		countMatches(mainApplication, /add\(TailscalePackage\(\)\)/g),
		1,
	);
});

void test('Tailscale native module uses explicit exported receiver actions', async () => {
	const { module } = await generatedTailscaleSources();

	assert.match(module, /TAILSCALE_PACKAGE = "com\.tailscale\.ipn"/);
	assert.match(
		module,
		/TAILSCALE_RECEIVER = "com\.tailscale\.ipn\.IPNReceiver"/,
	);
	assert.match(module, /ACTION_CONNECT = "com\.tailscale\.ipn\.CONNECT_VPN"/);
	assert.match(
		module,
		/ACTION_DISCONNECT = "com\.tailscale\.ipn\.DISCONNECT_VPN"/,
	);
	assert.match(
		module,
		/ComponentName\(TAILSCALE_PACKAGE, TAILSCALE_RECEIVER\)/,
	);
	assert.doesNotMatch(module, /USE_EXIT_NODE/);
});

void test('Tailscale availability check degrades to unavailable on package manager exceptions', async () => {
	const { module } = await generatedTailscaleSources();

	assert.match(
		module,
		/catch \(_: PackageManager\.NameNotFoundException\) \{\s*false\s*\}\s*catch \(_: Exception\) \{\s*false\s*\}/,
	);
});
