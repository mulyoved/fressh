import {
	DEFAULT_TAILSCALE_RESET_DELAY_MS,
	DEFAULT_TAILSCALE_SETTLE_DELAY_MS,
	createTailscaleRecoveryCooldown,
	isNetworkLikeSshError,
	isTailscaleRecoverySupported,
	type TailscaleManualResetResult,
	type TailscaleReadyResult,
	type TailscaleRecoverAfterFailureResult,
} from './tailscale-recovery-core';

const DEFAULT_TAILSCALE_CONNECT_TIMEOUT_MS = 5_000;

type TailscaleRecoveryAttemptResult = {
	attempted: boolean;
	failed?: boolean;
};

type TailscaleConnectCooldownResult =
	| { kind: 'cooldown'; attempted: false }
	| { kind: 'notStarted'; attempted: false }
	| { kind: 'attempted'; attempted: true }
	| { kind: 'failed'; attempted: boolean };

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
	let connectRecoveryInFlight: Promise<TailscaleConnectCooldownResult> | null =
		null;

	const isSupported = () => isTailscaleRecoverySupported(getPlatformOS());

	const checkAvailability = async () => {
		try {
			return await native.isAvailable();
		} catch {
			return false;
		}
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

	const createConnectRecoveryResult = (
		result: TailscaleRecoveryAttemptResult,
	): TailscaleConnectCooldownResult => {
		if (result.failed === true) {
			return { kind: 'failed', attempted: result.attempted };
		}
		if (result.attempted) {
			return { kind: 'attempted', attempted: true };
		}
		return { kind: 'notStarted', attempted: false };
	};

	const connectWithCooldown =
		async (): Promise<TailscaleConnectCooldownResult> => {
			if (connectRecoveryInFlight) {
				return await connectRecoveryInFlight;
			}

			const nowMs = getNowMs();
			if (!cooldown.canAttempt(nowMs)) {
				return { kind: 'cooldown', attempted: false };
			}

			const connectRecovery = (async () => {
				const result = await connectWithTimeout();
				if (shouldRecordCooldown(result)) {
					cooldown.recordAttempt(nowMs);
				}
				if (result.attempted) {
					await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
				}
				return createConnectRecoveryResult(result);
			})();
			const trackedConnectRecovery = connectRecovery.finally(() => {
				if (connectRecoveryInFlight === trackedConnectRecovery) {
					connectRecoveryInFlight = null;
				}
			});
			connectRecoveryInFlight = trackedConnectRecovery;

			return await trackedConnectRecovery;
		};

	const createReadyResult = (
		result: TailscaleConnectCooldownResult,
	): TailscaleReadyResult => {
		switch (result.kind) {
			case 'failed':
				return { kind: 'failed', attempted: result.attempted, available: true };
			case 'attempted':
				return { kind: 'ready', attempted: true, available: true };
			case 'cooldown':
				return { kind: 'cooldown', attempted: false, available: true };
			case 'notStarted':
				return { kind: 'notStarted', attempted: false, available: true };
		}
	};

	const createRecoverAfterFailureResult = (
		result: TailscaleConnectCooldownResult,
	): TailscaleRecoverAfterFailureResult => {
		switch (result.kind) {
			case 'failed':
				return {
					kind: 'failed',
					attempted: result.attempted,
					networkLikeFailure: true,
					available: true,
				};
			case 'attempted':
				return {
					kind: 'recovered',
					attempted: true,
					networkLikeFailure: true,
					available: true,
				};
			case 'cooldown':
				return {
					kind: 'cooldown',
					attempted: false,
					networkLikeFailure: true,
					available: true,
				};
			case 'notStarted':
				return {
					kind: 'notStarted',
					attempted: false,
					networkLikeFailure: true,
					available: true,
				};
		}
	};

	return {
		async ensureReady(): Promise<TailscaleReadyResult> {
			if (!isSupported()) {
				return { kind: 'unsupported', attempted: false, available: false };
			}

			const available = await checkAvailability();
			if (!available) {
				return { kind: 'unavailable', attempted: false, available: false };
			}

			const result = await connectWithCooldown();
			return createReadyResult(result);
		},

		async recoverAfterFailure(
			error: unknown,
		): Promise<TailscaleRecoverAfterFailureResult> {
			const networkLikeFailure = isNetworkLikeSshError(error);
			if (!isSupported()) {
				if (!networkLikeFailure) {
					return {
						kind: 'nonNetworkFailure',
						attempted: false,
						networkLikeFailure: false,
						available: false,
					};
				}
				return {
					kind: 'unsupported',
					attempted: false,
					networkLikeFailure: true,
					available: false,
				};
			}

			const available = await checkAvailability();

			if (!networkLikeFailure) {
				return {
					kind: 'nonNetworkFailure',
					attempted: false,
					networkLikeFailure: false,
					available,
				};
			}
			if (!available) {
				return {
					kind: 'unavailable',
					attempted: false,
					networkLikeFailure,
					available,
				};
			}

			const result = await connectWithCooldown();
			return createRecoverAfterFailureResult(result);
		},

		async reset(): Promise<TailscaleManualResetResult> {
			if (!isSupported()) {
				return { kind: 'unsupported', attempted: false };
			}

			let disconnectResult: TailscaleRecoveryAttemptResult;
			try {
				disconnectResult = await native.disconnect();
			} catch {
				return { kind: 'failed', attempted: false };
			}
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

			const attempted = disconnectResult.attempted || connectResult.attempted;
			if (disconnectResult.failed === true || connectResult.failed === true) {
				return { kind: 'failed', attempted };
			}
			if (attempted) {
				return { kind: 'reset', attempted: true };
			}
			return { kind: 'notStarted', attempted: false };
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
