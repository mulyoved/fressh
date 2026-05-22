import { rootLogger } from './logger';

const logger = rootLogger.extend('AgentNotifications');

type AgentNotificationsNativeModule = {
	postAgentAlert?: (
		notificationId: number,
		title: string,
		message: string,
		connectionId: string,
		session: string,
		target: string,
		windowId: string,
	) => Promise<void>;
	cancelAgentAlert?: (notificationId: number) => Promise<void>;
};

type AgentAlertNotificationInput = {
	notificationId: number;
	title: string;
	message: string;
	connectionId: string;
	session: string;
	target: string;
	windowId: string;
};

type AgentNotificationsLogger = {
	warn: (message: string, ...args: unknown[]) => void;
};

type AgentNotificationsNativeDependencies = {
	getPlatformOS: () => string;
	getNativeModule: () => AgentNotificationsNativeModule | undefined;
	ensureNotificationPermission: () => Promise<boolean>;
	logger: AgentNotificationsLogger;
};

export function createAgentNotificationsNativeWrapper({
	getPlatformOS,
	getNativeModule,
	ensureNotificationPermission,
	logger,
}: AgentNotificationsNativeDependencies) {
	return {
		async postAgentAlertNotification(input: AgentAlertNotificationInput) {
			if (getPlatformOS() !== 'android') return;
			const nativeModule = getNativeModule();
			if (!nativeModule) return;
			if (typeof nativeModule.postAgentAlert !== 'function') {
				logger.warn('agent alert notification post unavailable');
				return;
			}
			const allowed = await ensureNotificationPermission();
			if (!allowed) {
				logger.warn(
					'notification permission not granted; skipping agent alert',
				);
				return;
			}
			try {
				await nativeModule.postAgentAlert(
					input.notificationId,
					input.title,
					input.message,
					input.connectionId,
					input.session,
					input.target,
					input.windowId,
				);
			} catch (error) {
				logger.warn('agent alert notification post failed', error);
			}
		},
		async cancelAgentAlertNotification(notificationId: number) {
			if (getPlatformOS() !== 'android') return;
			const nativeModule = getNativeModule();
			if (!nativeModule) return;
			if (typeof nativeModule.cancelAgentAlert !== 'function') {
				logger.warn('agent alert notification cancel unavailable');
				return;
			}
			try {
				await nativeModule.cancelAgentAlert(notificationId);
			} catch (error) {
				logger.warn('agent alert notification cancel failed', error);
			}
		},
	};
}

async function loadDefaultAgentNotificationWrapper() {
	const [{ NativeModules, Platform }, { ensureNotificationPermission }] =
		await Promise.all([
			import('react-native'),
			import('./foreground-service'),
		]);
	return createAgentNotificationsNativeWrapper({
		getPlatformOS: () => Platform.OS,
		getNativeModule: () =>
			NativeModules.FresshForegroundService as
				| AgentNotificationsNativeModule
				| undefined,
		ensureNotificationPermission,
		logger,
	});
}

export async function postAgentAlertNotification(
	input: AgentAlertNotificationInput,
) {
	const wrapper = await loadDefaultAgentNotificationWrapper();
	await wrapper.postAgentAlertNotification(input);
}

export async function cancelAgentAlertNotification(notificationId: number) {
	const wrapper = await loadDefaultAgentNotificationWrapper();
	await wrapper.cancelAgentAlertNotification(notificationId);
}
