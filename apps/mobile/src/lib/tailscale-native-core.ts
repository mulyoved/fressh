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
