import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
	withMainApplication,
} from 'expo/config-plugins';
import { addReactPackageRegistration } from './android-main-application';

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
		config.modResults.contents = addReactPackageRegistration(
			config.modResults.contents,
			TAILSCALE_PACKAGE_REGISTRATION,
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
