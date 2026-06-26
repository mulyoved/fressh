import {
	DEFAULT_TAILSCALE_RESET_DELAY_MS,
	DEFAULT_TAILSCALE_SETTLE_DELAY_MS,
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
} from './tailscale-recovery-core';

const DEFAULT_TAILSCALE_CONNECT_TIMEOUT_MS = 5_000;

type TailscaleRecoveryAttemptResult = {
	attempted: boolean;
	failed?: boolean;
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
	connectTimeoutMs?: number;
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
	connectTimeoutMs = DEFAULT_TAILSCALE_CONNECT_TIMEOUT_MS,
}: TailscaleRecoveryControllerDeps) {
	const cooldown = createTailscaleRecoveryCooldown();
	let connectRecoveryInFlight: Promise<TailscaleRecoveryAttemptResult> | null =
		null;

	const isSupported = () => isTailscaleRecoverySupported(getPlatformOS());

	const checkAvailability = async () => {
		if (!isSupported()) return false;
		return await native.isAvailable();
	};

	const shouldRecordCooldown = (result: TailscaleRecoveryAttemptResult) =>
		result.attempted || result.failed === true;

	const createFailedAttempt = (): TailscaleRecoveryAttemptResult => ({
		attempted: false,
		failed: true,
	});

	const connectWithTimeout = async () => {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const timeoutResult = new Promise<TailscaleRecoveryAttemptResult>(
			(resolve) => {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					resolve(createFailedAttempt());
				}, connectTimeoutMs);
			},
		);

		try {
			const connectResult = native.connect().catch(() => createFailedAttempt());
			return await Promise.race([connectResult, timeoutResult]);
		} finally {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}
	};

	const connectWithCooldown = async () => {
		if (connectRecoveryInFlight) {
			return await connectRecoveryInFlight;
		}

		const nowMs = getNowMs();
		if (!cooldown.canAttempt(nowMs)) return { attempted: false };

		const connectRecovery = (async () => {
			const result = await connectWithTimeout();
			if (shouldRecordCooldown(result)) {
				cooldown.recordAttempt(nowMs);
			}
			if (result.attempted) {
				await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
			}
			return result;
		})();
		const trackedConnectRecovery = connectRecovery.finally(() => {
			if (connectRecoveryInFlight === trackedConnectRecovery) {
				connectRecoveryInFlight = null;
			}
		});
		connectRecoveryInFlight = trackedConnectRecovery;

		return await trackedConnectRecovery;
	};

	const createRecoveryResult = (
		result: TailscaleRecoveryAttemptResult,
		available: boolean,
	) =>
		result.failed === true
			? { attempted: result.attempted, failed: true, available }
			: { attempted: result.attempted, available };

	return {
		async ensureReady() {
			const available = await checkAvailability();
			if (!available) {
				return { attempted: false, available };
			}

			const result = await connectWithCooldown();
			return createRecoveryResult(result, available);
		},

		async recoverAfterFailure(error: unknown) {
			const available = await checkAvailability();
			const networkLikeFailure = isNetworkLikeSshError(error);

			if (!available || !networkLikeFailure) {
				return { attempted: false, networkLikeFailure, available };
			}

			const result = await connectWithCooldown();
			return result.failed === true
				? {
						attempted: result.attempted,
						failed: true,
						networkLikeFailure,
						available,
					}
				: { attempted: result.attempted, networkLikeFailure, available };
		},

		async reset() {
			if (!isSupported()) {
				return { attempted: false };
			}

			const disconnectResult = await native.disconnect();
			if (disconnectResult.attempted) {
				await sleep(DEFAULT_TAILSCALE_RESET_DELAY_MS);
			}

			const connectResult = await connectWithTimeout();
			if (shouldRecordCooldown(connectResult)) {
				cooldown.recordAttempt(getNowMs());
			}
			if (connectResult.attempted) {
				await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
			}

			const result = {
				attempted: disconnectResult.attempted || connectResult.attempted,
			};
			return disconnectResult.failed === true || connectResult.failed === true
				? { ...result, failed: true }
				: result;
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
