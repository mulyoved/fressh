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
import { addReactPackageRegistration } from './android-main-application';

const PERMISSIONS = ['android.permission.ACCESS_NETWORK_STATE'];
const CONNECTIVITY_PACKAGE_REGISTRATION = 'add(ConnectivityPackage())';

const JAVA_PACKAGE_RELATIVE_PATH = 'app/src/main/java/com/finalapp/vibe2';
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_TEMPLATE_SOURCE_PATH = path.join(
	PLUGIN_DIR,
	'connectivity-android',
);

const CONNECTIVITY_PACKAGE_KOTLIN = `package com.finalapp.vibe2

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ConnectivityPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ) = listOf(
    ConnectivityModule(reactContext)
  )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`;

async function readAndroidTemplateSource(filename: string) {
	return fs.readFile(path.join(ANDROID_TEMPLATE_SOURCE_PATH, filename), 'utf8');
}

const withConnectivityManifest: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		AndroidConfig.Permissions.ensurePermissions(config.modResults, PERMISSIONS);
		return config;
	});

const withConnectivityPackageRegistration: ConfigPlugin = (config) =>
	withMainApplication(config, (config) => {
		config.modResults.contents = addReactPackageRegistration(
			config.modResults.contents,
			CONNECTIVITY_PACKAGE_REGISTRATION,
		);

		return config;
	});

const withConnectivityNativeFiles: ConfigPlugin = (config) =>
	withDangerousMod(config, [
		'android',
		async (config) => {
			const javaPackagePath = path.join(
				config.modRequest.platformProjectRoot,
				JAVA_PACKAGE_RELATIVE_PATH,
			);
			await fs.mkdir(javaPackagePath, { recursive: true });

			await fs.writeFile(
				path.join(javaPackagePath, 'ConnectivityModule.kt'),
				await readAndroidTemplateSource('ConnectivityModule.kt'),
				'utf8',
			);

			await fs.writeFile(
				path.join(javaPackagePath, 'ConnectivityPackage.kt'),
				CONNECTIVITY_PACKAGE_KOTLIN,
				'utf8',
			);

			return config;
		},
	]);

const withConnectivity: ConfigPlugin = (config) => {
	config = withConnectivityManifest(config);
	config = withConnectivityPackageRegistration(config);
	config = withConnectivityNativeFiles(config);
	return config;
};

export default withConnectivity;
