import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
	withMainApplication,
} from 'expo/config-plugins';

const TAILSCALE_PACKAGE_NAME = 'com.tailscale.ipn';
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
		if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
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
	if (applyBlock.includes(TAILSCALE_PACKAGE_REGISTRATION)) {
		return contents;
	}

	const blockLines = applyBlock.split('\n');
	const indentedLine = blockLines.find((line) => line.trim().length > 0);
	const indent = indentedLine?.match(/^\s*/)?.[0] ?? '              ';
	const closeBraceLineStart = contents.lastIndexOf('\n', closeBraceIndex) + 1;

	return `${contents.slice(0, closeBraceLineStart)}${indent}${TAILSCALE_PACKAGE_REGISTRATION}\n${contents.slice(closeBraceLineStart)}`;
}

type AndroidManifestWithQueries = {
	manifest: {
		queries?: {
			package?: {
				$: {
					'android:name': string;
				};
			}[];
		}[];
	};
};

const withTailscaleManifest: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		const manifest = config.modResults as typeof config.modResults &
			AndroidManifestWithQueries;
		const queries = (manifest.manifest.queries ??= [{}]);
		const primaryQueries = (queries[0] ??= {});
		const packages = (primaryQueries.package ??= []);
		const alreadyPresent = packages.some(
			(packageQuery) =>
				packageQuery.$['android:name'] === TAILSCALE_PACKAGE_NAME,
		);

		if (!alreadyPresent) {
			packages.push({
				$: {
					'android:name': TAILSCALE_PACKAGE_NAME,
				},
			});
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
	config = withTailscaleManifest(config);
	config = withTailscalePackageRegistration(config);
	config = withTailscaleNativeFiles(config);
	return config;
};

export default withTailscale;
