import { NativeModules, Platform } from 'react-native';
import { rootLogger } from './logger';

const logger = rootLogger.extend('AgentNotifications');

type AgentNotificationsNativeModule = {
	postAgentAlert: (
		notificationId: number,
		title: string,
		message: string,
		connectionId: string,
		session: string,
		target: string,
		windowId: string,
	) => Promise<void>;
	cancelAgentAlert: (notificationId: number) => Promise<void>;
};

const nativeModule = NativeModules.FresshForegroundService as
	| AgentNotificationsNativeModule
	| undefined;

export async function postAgentAlertNotification(input: {
	notificationId: number;
	title: string;
	message: string;
	connectionId: string;
	session: string;
	target: string;
	windowId: string;
}) {
	if (Platform.OS !== 'android' || !nativeModule) return;
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
}

export async function cancelAgentAlertNotification(notificationId: number) {
	if (Platform.OS !== 'android' || !nativeModule) return;
	try {
		await nativeModule.cancelAgentAlert(notificationId);
	} catch (error) {
		logger.warn('agent alert notification cancel failed', error);
	}
}
