import {
	isNetworkPreflightUsable,
	type NetworkPreflightSnapshot,
} from './network-preflight-core';
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

type TailscaleNativeAttemptWithFallback = {
	result: TailscaleRecoveryAttemptResult;
	fallback: boolean;
};

type TailscaleConnectCooldownResult =
	| { kind: 'cooldown'; attempted: false }
	| { kind: 'notStarted'; attempted: false }
	| { kind: 'attempted'; attempted: true }
	| { kind: 'failed'; attempted: boolean };

type TailscaleConnectCooldownReason = 'readiness' | 'failure' | 'reset';

type PendingReadinessRetry = {
	source: 'successfulReadinessNudge';
};

export type TailscaleRecoveryNative = {
	isAvailable: () => Promise<boolean>;
	connect: () => Promise<TailscaleRecoveryAttemptResult>;
	disconnect: () => Promise<TailscaleRecoveryAttemptResult>;
	openApp: () => Promise<TailscaleRecoveryAttemptResult>;
};

export type NetworkPreflightChecker =
	() => Promise<NetworkPreflightSnapshot | null>;

type TailscaleRecoveryControllerDeps = {
	getPlatformOS: () => string;
	getNowMs: () => number;
	sleep: (ms: number) => Promise<void>;
	native: TailscaleRecoveryNative;
	networkPreflight?: NetworkPreflightChecker;
	connectTimeoutMs?: number;
};

type ReactNativeModule = {
	Platform: { OS: string };
};
type TailscaleNativeModule = {
	tailscaleNative: TailscaleRecoveryNative;
};
type NetworkPreflightNativeModule = {
	getNetworkPreflightSnapshot: NetworkPreflightChecker;
};

declare const require: (id: string) => unknown;

export function createTailscaleRecoveryController({
	getPlatformOS,
	getNowMs,
	sleep,
	native,
	networkPreflight,
	connectTimeoutMs = DEFAULT_TAILSCALE_CONNECT_TIMEOUT_MS,
}: TailscaleRecoveryControllerDeps) {
	const cooldown = createTailscaleRecoveryCooldown();
	let connectRecoveryInFlight: Promise<TailscaleConnectCooldownResult> | null =
		null;
	let connectRecoveryInFlightReason: TailscaleConnectCooldownReason | null =
		null;
	let pendingReadinessRetry: PendingReadinessRetry | null = null;

	const isSupported = () => isTailscaleRecoverySupported(getPlatformOS());

	const shouldRecordCooldown = (result: TailscaleRecoveryAttemptResult) =>
		result.attempted || result.failed === true;

	const clearPendingReadinessRetry = () => {
		pendingReadinessRetry = null;
	};

	const grantPendingReadinessRetry = (
		result: TailscaleRecoveryAttemptResult,
	) => {
		pendingReadinessRetry =
			result.attempted && result.failed !== true
				? { source: 'successfulReadinessNudge' }
				: null;
	};

	const consumePendingReadinessRetry = () => {
		if (pendingReadinessRetry === null) {
			return false;
		}
		clearPendingReadinessRetry();
		return true;
	};

	const recordConnectCooldown = (
		reason: TailscaleConnectCooldownReason,
		nowMs: number,
		result: TailscaleRecoveryAttemptResult,
	) => {
		cooldown.recordAttempt(nowMs);
		if (reason === 'readiness') {
			grantPendingReadinessRetry(result);
			return;
		}
		clearPendingReadinessRetry();
	};

	const createFailedAttempt = (): TailscaleRecoveryAttemptResult => ({
		attempted: false,
		failed: true,
	});

	const runBooleanWithTimeout = async (
		attempt: () => Promise<boolean>,
		fallback: boolean,
	): Promise<boolean> => {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const timeoutResult = new Promise<boolean>((resolve) => {
			timeoutId = setTimeout(() => {
				timeoutId = null;
				resolve(fallback);
			}, connectTimeoutMs);
		});

		let nativeResult: Promise<boolean>;
		try {
			nativeResult = attempt().catch(() => fallback);
		} catch {
			nativeResult = Promise.resolve(fallback);
		}

		try {
			return await Promise.race([nativeResult, timeoutResult]);
		} finally {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}
	};

	const checkAvailability = async () =>
		await runBooleanWithTimeout(() => native.isAvailable(), false);

	const checkNetworkPreflight =
		(): Promise<NetworkPreflightSnapshot | null> | null => {
			if (!networkPreflight) return null;

			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			const timeoutResult = new Promise<null>((resolve) => {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					resolve(null);
				}, connectTimeoutMs);
			});

			let preflightResult: Promise<NetworkPreflightSnapshot | null>;
			try {
				preflightResult = networkPreflight().catch(() => null);
			} catch {
				preflightResult = Promise.resolve(null);
			}

			return (async () => {
				try {
					return await Promise.race([preflightResult, timeoutResult]);
				} finally {
					if (timeoutId !== null) {
						clearTimeout(timeoutId);
					}
				}
			})();
		};

	const withNetworkPreflight = <Result extends object>(
		result: Result,
		network: NetworkPreflightSnapshot | null,
	): Result & { network?: NetworkPreflightSnapshot } => {
		return network === null ? result : { ...result, network };
	};

	const runNativeAttemptWithTimeout = async (
		attempt: () => Promise<TailscaleRecoveryAttemptResult>,
	): Promise<TailscaleNativeAttemptWithFallback> => {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const timeoutResult = new Promise<TailscaleNativeAttemptWithFallback>(
			(resolve) => {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					resolve({ result: createFailedAttempt(), fallback: true });
				}, connectTimeoutMs);
			},
		);

		let nativeResult: Promise<TailscaleNativeAttemptWithFallback>;
		try {
			nativeResult = attempt().then(
				(result): TailscaleNativeAttemptWithFallback => ({
					result,
					fallback: false,
				}),
				(): TailscaleNativeAttemptWithFallback => ({
					result: createFailedAttempt(),
					fallback: true,
				}),
			);
		} catch {
			nativeResult = Promise.resolve({
				result: createFailedAttempt(),
				fallback: true,
			});
		}

		try {
			return await Promise.race([nativeResult, timeoutResult]);
		} finally {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}
	};

	const connectWithTimeout = async () => {
		const { result } = await runNativeAttemptWithTimeout(() =>
			native.connect(),
		);
		return result;
	};

	const disconnectWithTimeout =
		async (): Promise<TailscaleNativeAttemptWithFallback> =>
			await runNativeAttemptWithTimeout(() => native.disconnect());

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

	const connectWithCooldown = async (
		reason: TailscaleConnectCooldownReason,
	): Promise<TailscaleConnectCooldownResult> => {
		if (connectRecoveryInFlight) {
			if (
				reason === 'failure' &&
				connectRecoveryInFlightReason === 'readiness'
			) {
				connectRecoveryInFlightReason = 'failure';
				clearPendingReadinessRetry();
			}
			return await connectRecoveryInFlight;
		}

		const nowMs = getNowMs();
		if (!cooldown.canAttempt(nowMs)) {
			return { kind: 'cooldown', attempted: false };
		}

		const connectRecovery = (async () => {
			const result = await connectWithTimeout();
			if (shouldRecordCooldown(result)) {
				recordConnectCooldown(
					connectRecoveryInFlightReason ?? reason,
					nowMs,
					result,
				);
			}
			if (result.attempted) {
				await sleep(DEFAULT_TAILSCALE_SETTLE_DELAY_MS);
			}
			return createConnectRecoveryResult(result);
		})();
		const trackedConnectRecovery = connectRecovery.finally(() => {
			if (connectRecoveryInFlight === trackedConnectRecovery) {
				connectRecoveryInFlight = null;
				connectRecoveryInFlightReason = null;
			}
		});
		connectRecoveryInFlightReason = reason;
		connectRecoveryInFlight = trackedConnectRecovery;

		return await trackedConnectRecovery;
	};

	const createReadyResult = (
		result: TailscaleConnectCooldownResult,
		network: NetworkPreflightSnapshot | null,
	): TailscaleReadyResult => {
		switch (result.kind) {
			case 'failed':
				return withNetworkPreflight(
					{ kind: 'failed', attempted: result.attempted, available: true },
					network,
				);
			case 'attempted':
				return withNetworkPreflight(
					{ kind: 'ready', attempted: true, available: true },
					network,
				);
			case 'cooldown':
				return withNetworkPreflight(
					{ kind: 'cooldown', attempted: false, available: true },
					network,
				);
			case 'notStarted':
				return withNetworkPreflight(
					{ kind: 'notStarted', attempted: false, available: true },
					network,
				);
		}
	};

	const createRecoverAfterFailureResult = (
		result: TailscaleConnectCooldownResult,
		network: NetworkPreflightSnapshot | null,
	): TailscaleRecoverAfterFailureResult => {
		switch (result.kind) {
			case 'failed':
				return withNetworkPreflight(
					{
						kind: 'failed',
						attempted: result.attempted,
						networkLikeFailure: true,
						available: true,
					},
					network,
				);
			case 'attempted':
				return withNetworkPreflight(
					{
						kind: 'recovered',
						attempted: true,
						networkLikeFailure: true,
						available: true,
					},
					network,
				);
			case 'cooldown':
				return withNetworkPreflight(
					{
						kind: 'cooldown',
						attempted: false,
						networkLikeFailure: true,
						available: true,
					},
					network,
				);
			case 'notStarted':
				return withNetworkPreflight(
					{
						kind: 'notStarted',
						attempted: false,
						networkLikeFailure: true,
						available: true,
					},
					network,
				);
		}
	};

	return {
		async ensureReady(): Promise<TailscaleReadyResult> {
			if (!isSupported()) {
				return { kind: 'unsupported', attempted: false, available: false };
			}

			const readinessPreflight = checkNetworkPreflight();
			const network =
				readinessPreflight === null ? null : await readinessPreflight;
			if (network !== null && !isNetworkPreflightUsable(network)) {
				return {
					kind: 'networkUnavailable',
					attempted: false,
					available: false,
					network,
				};
			}

			const available = await checkAvailability();
			if (!available) {
				return withNetworkPreflight(
					{ kind: 'unavailable', attempted: false, available: false },
					network,
				);
			}

			const result = await connectWithCooldown('readiness');
			return createReadyResult(result, network);
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

			let network: NetworkPreflightSnapshot | null = null;
			if (networkLikeFailure) {
				const failurePreflight = checkNetworkPreflight();
				network = failurePreflight === null ? null : await failurePreflight;
				if (network !== null && !isNetworkPreflightUsable(network)) {
					return {
						kind: 'networkUnavailable',
						attempted: false,
						networkLikeFailure: true,
						available: false,
						network,
					};
				}
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
				return withNetworkPreflight(
					{
						kind: 'unavailable',
						attempted: false,
						networkLikeFailure,
						available,
					},
					network,
				);
			}

			const result = await connectWithCooldown('failure');
			if (result.kind === 'cooldown' && consumePendingReadinessRetry()) {
				return withNetworkPreflight(
					{
						kind: 'preflightReady',
						attempted: false,
						networkLikeFailure: true,
						available: true,
					},
					network,
				);
			}
			return createRecoverAfterFailureResult(result, network);
		},

		async reset(): Promise<TailscaleManualResetResult> {
			if (!isSupported()) {
				return { kind: 'unsupported', attempted: false };
			}

			clearPendingReadinessRetry();

			let disconnectResult: TailscaleRecoveryAttemptResult;
			const disconnectAttempt = await disconnectWithTimeout();
			if (disconnectAttempt.fallback) {
				return { kind: 'failed', attempted: false };
			}
			disconnectResult = disconnectAttempt.result;
			if (disconnectResult.attempted) {
				await sleep(DEFAULT_TAILSCALE_RESET_DELAY_MS);
			}

			const connectResult = await connectWithTimeout();
			if (shouldRecordCooldown(connectResult)) {
				recordConnectCooldown('reset', getNowMs(), connectResult);
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
			clearPendingReadinessRetry();
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
const getNetworkPreflightNative = async () =>
	(await import('./network-preflight-native')) as NetworkPreflightNativeModule;

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

const defaultNetworkPreflight: NetworkPreflightChecker = async () => {
	const { getNetworkPreflightSnapshot } = await getNetworkPreflightNative();
	return await getNetworkPreflightSnapshot();
};

export const tailscaleRecovery = createTailscaleRecoveryController({
	getPlatformOS: () => getReactNative().Platform.OS,
	getNowMs: () => Date.now(),
	sleep: defaultSleep,
	native: defaultNative,
	networkPreflight: defaultNetworkPreflight,
});
