import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidManifest,
} from 'expo/config-plugins';

const PERMISSIONS = [
	'android.permission.FOREGROUND_SERVICE',
	'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
	'android.permission.POST_NOTIFICATIONS',
	'android.permission.WAKE_LOCK',
];

const SERVICE_NAME = '.SshForegroundService';

const withForegroundService: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		const manifest = config.modResults;

		AndroidConfig.Permissions.ensurePermissions(manifest, PERMISSIONS);

		const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
		app.service = app.service ?? [];
		const alreadyPresent = app.service.some(
			(service) => service.$['android:name'] === SERVICE_NAME,
		);
		if (!alreadyPresent) {
			app.service.push({
				$: {
					'android:name': SERVICE_NAME,
					'android:exported': 'false',
					'android:foregroundServiceType': 'dataSync',
					'android:stopWithTask': 'true',
				},
			});
		}

		return config;
	});

export default withForegroundService;
