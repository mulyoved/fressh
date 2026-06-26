import {
	DEFAULT_TAILSCALE_RESET_DELAY_MS,
	DEFAULT_TAILSCALE_SETTLE_DELAY_MS,
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
} from './tailscale-recovery-core';

type TailscaleRecoveryAttemptResult = {
	attempted: boolean;
};

export type TailscaleRecoveryNative = {
	isAvailable: () => Promise<boolean>;
	connect: () => Promise<TailscaleRecoveryAttemptResult>;
	disconnect: () => Promise<TailscaleRecoveryAttemptResult>;
	openApp: () => Promise<TailscaleRecoveryAttemptResult>;
};

type TailscaleRecoveryControllerDeps = {
	getPlatformOS: () => string;
	getNowMs: () => number;
	sleep: (ms: number) => Promise<void>;
	native: TailscaleRecoveryNative;
};

type ReactNativeModule = {
	Platform: { OS: string };
};
type TailscaleNativeModule = {
	tailscaleNative: TailscaleRecoveryNative;
};

declare const require: (id: string) => unknown;

export function createTailscaleRecoveryController({
	getPlatformOS,
	getNowMs,
	sleep,
	native,
}: TailscaleRecoveryControllerDeps) {
	const cooldown = createTailscaleRecoveryCooldown();

	const isSupported = () => isTailscaleRecoverySupported(getPlatformOS());

	const checkAvailability = async () => {
		if (!isSupported()) return false;
		return await native.isAvailable();
	};

	const connectWithCooldown = async () => {
		const nowMs = getNowMs();
		if (!cooldown.canAttempt(nowMs)) return false;

		const result = await native.connect();
		if (result.attempted) {
			cooldown.recordAttempt(nowMs);
			await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
		}
		return result.attempted;
	};

	return {
		async ensureReady() {
			const available = await checkAvailability();
			if (!available) {
				return { attempted: false, available };
			}

			const attempted = await connectWithCooldown();
			return { attempted, available };
		},

		async recoverAfterFailure(error: unknown) {
			const available = await checkAvailability();
			const networkLikeFailure = isNetworkLikeSshError(error);

			if (!available || !networkLikeFailure) {
				return { attempted: false, networkLikeFailure, available };
			}

			const attempted = await connectWithCooldown();
			return { attempted, networkLikeFailure, available };
		},

		async reset() {
			if (!isSupported()) {
				return { attempted: false };
			}

			const disconnectResult = await native.disconnect();
			if (disconnectResult.attempted) {
				await sleep(DEFAULT_TAILSCALE_RESET_DELAY_MS);
			}

			const connectResult = await native.connect();
			if (connectResult.attempted) {
				cooldown.recordAttempt(getNowMs());
				await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
			}

			return {
				attempted: disconnectResult.attempted || connectResult.attempted,
			};
		},

		async openApp() {
			if (!isSupported()) {
				return { attempted: false };
			}
			return await native.openApp();
		},

		resetCooldown() {
			cooldown.reset();
		},
	};
}

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const getReactNative = () => require('react-native') as ReactNativeModule;
const getTailscaleNative = async () =>
	(await import('./tailscale-native')) as TailscaleNativeModule;

const defaultNative: TailscaleRecoveryNative = {
	isAvailable: async () => {
		const { tailscaleNative } = await getTailscaleNative();
		return await tailscaleNative.isAvailable();
	},
	connect: async () => {
		const { tailscaleNative } = await getTailscaleNative();
		return await tailscaleNative.connect();
	},
	disconnect: async () => {
		const { tailscaleNative } = await getTailscaleNative();
		return await tailscaleNative.disconnect();
	},
	openApp: async () => {
		const { tailscaleNative } = await getTailscaleNative();
		return await tailscaleNative.openApp();
	},
};

export const tailscaleRecovery = createTailscaleRecoveryController({
	getPlatformOS: () => getReactNative().Platform.OS,
	getNowMs: () => Date.now(),
	sleep: defaultSleep,
	native: defaultNative,
});
