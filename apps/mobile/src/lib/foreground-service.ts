import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { rootLogger } from './logger';

const logger = rootLogger.extend('ForegroundService');

type ForegroundServiceNativeModule = {
	start: (title: string, message: string) => Promise<void>;
	stop: () => Promise<void>;
};

const nativeForegroundService =
	NativeModules.FresshForegroundService as ForegroundServiceNativeModule | undefined;

let didRequestNotificationPermission = false;

async function ensureNotificationPermission() {
	if (Platform.OS !== 'android') return true;
	if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
	try {
		const granted = await PermissionsAndroid.check(
			PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
		);
		if (granted) return true;
		if (didRequestNotificationPermission) return false;
		didRequestNotificationPermission = true;
		const result = await PermissionsAndroid.request(
			PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
		);
		return result === PermissionsAndroid.RESULTS.GRANTED;
	} catch (error) {
		logger.warn('notification permission check failed', error);
		return false;
	}
}

export async function startForegroundService(opts?: {
	title?: string;
	message?: string;
}) {
	if (Platform.OS !== 'android' || !nativeForegroundService) return;
	const allowed = await ensureNotificationPermission();
	if (!allowed) {
		logger.warn('notification permission not granted; continuing anyway');
	}
	const title = opts?.title ?? 'Fressh Terminal';
	const message = opts?.message ?? 'Keeping SSH connection alive';
	try {
		await nativeForegroundService.start(title, message);
	} catch (error) {
		logger.warn('foreground service start failed', error);
	}
}

export async function stopForegroundService() {
	if (Platform.OS !== 'android' || !nativeForegroundService) return;
	try {
		await nativeForegroundService.stop();
	} catch (error) {
		logger.warn('foreground service stop failed', error);
	}
}
