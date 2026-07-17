import {
	type WisprAutomationFailure,
	type WisprTimerPort,
} from '../wispr-automation';
import { type ControllerOutcome } from './controller-core';
import { withWisprTransactionDeadline } from './wispr-status-request';

const SETTINGS_TIMEOUT_MS = 750;
const SETTINGS_FAILURE: WisprAutomationFailure = {
	reason: 'service-disabled',
	message: 'Failed to open accessibility settings.',
};

export type WisprSettingsLauncher = {
	open(): Promise<ControllerOutcome<WisprAutomationFailure>>;
};

export type CreateWisprSettingsLauncherInput = {
	timers: WisprTimerPort;
	openSettings(): Promise<unknown>;
	captureLifecycle(): number;
	lifecycleCurrent(capture: number): boolean;
	warn(message: string, error: unknown): void;
};

export function createWisprSettingsLauncher(
	deps: CreateWisprSettingsLauncherInput,
): WisprSettingsLauncher {
	let requestGeneration = 0;

	return {
		open: async () => {
			const capture = deps.captureLifecycle();
			const requestId = ++requestGeneration;
			try {
				await withWisprTransactionDeadline(
					deps.openSettings(),
					SETTINGS_TIMEOUT_MS,
					deps.timers,
				);
				if (
					!deps.lifecycleCurrent(capture) ||
					requestGeneration !== requestId
				) {
					return { status: 'superseded' };
				}
				return { status: 'completed' };
			} catch (error) {
				if (
					!deps.lifecycleCurrent(capture) ||
					requestGeneration !== requestId
				) {
					return { status: 'superseded' };
				}
				deps.warn('Failed to open accessibility settings', error);
				return { status: 'failed', failure: SETTINGS_FAILURE };
			}
		},
	};
}
