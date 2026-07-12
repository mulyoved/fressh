export type WorkmuxScrollbackLiveInputSendPlan = {
	segments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	clearScrollback: boolean;
};

export type WorkmuxScrollbackLiveInputCleanupBarrier = {
	current: () => Promise<boolean> | null;
	track: (cleanup?: Promise<boolean> | null) => Promise<boolean> | null;
};

export function isWorkmuxScrollbackLiveInputRequestCurrent<TWriter>({
	requestInstanceId,
	requestWriter,
	currentInstanceId,
	currentWriter,
	isFocused,
	isAppActive,
	requestGeneration,
	currentGeneration,
}: {
	requestInstanceId?: string | null;
	requestWriter?: TWriter | null;
	currentInstanceId?: string | null;
	currentWriter?: TWriter | null;
	isFocused: boolean;
	isAppActive: boolean;
	requestGeneration?: number;
	currentGeneration?: number;
}): boolean {
	return (
		isFocused &&
		isAppActive &&
		(requestGeneration === undefined ||
			requestGeneration === currentGeneration) &&
		requestInstanceId != null &&
		requestInstanceId === currentInstanceId &&
		requestWriter != null &&
		requestWriter === currentWriter
	);
}

export function createWorkmuxScrollbackLiveInputCleanupBarrier(): WorkmuxScrollbackLiveInputCleanupBarrier {
	type CleanupCycle = {
		cleanups: Set<Promise<boolean>>;
		allSucceeded: boolean;
		hasFailure: boolean;
		failure: unknown;
		promise: Promise<boolean>;
		resolve(value: boolean): void;
		reject(error: unknown): void;
	};

	let cycle: CleanupCycle | null = null;

	const createCycle = (): CleanupCycle => {
		let resolve!: (value: boolean) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<boolean>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		// The barrier may be tracked for state only; keep rejection observable to
		// callers without allowing an ignored returned promise to go unhandled.
		void promise.catch(() => {});
		return {
			cleanups: new Set(),
			allSucceeded: true,
			hasFailure: false,
			failure: undefined,
			promise,
			resolve,
			reject,
		};
	};

	const settle = (
		settledCycle: CleanupCycle,
		cleanup: Promise<boolean>,
		result: { value: boolean } | { error: unknown },
	): void => {
		if (!settledCycle.cleanups.delete(cleanup)) return;
		if ('error' in result) {
			if (!settledCycle.hasFailure) settledCycle.failure = result.error;
			settledCycle.hasFailure = true;
		} else if (!result.value) {
			settledCycle.allSucceeded = false;
		}
		if (settledCycle.cleanups.size > 0) return;
		if (cycle === settledCycle) cycle = null;
		if (settledCycle.hasFailure) {
			settledCycle.reject(settledCycle.failure);
		} else {
			settledCycle.resolve(settledCycle.allSucceeded);
		}
	};

	return {
		current: () => cycle?.promise ?? null,
		track: (cleanup?: Promise<boolean> | null) => {
			if (!cleanup) return cycle?.promise ?? null;
			const activeCycle = cycle ?? (cycle = createCycle());
			if (activeCycle.cleanups.has(cleanup)) return activeCycle.promise;
			activeCycle.cleanups.add(cleanup);
			void cleanup.then(
				(value) => settle(activeCycle, cleanup, { value }),
				(error) => settle(activeCycle, cleanup, { error }),
			);
			return activeCycle.promise;
		},
	};
}

export function registerWorkmuxScrollbackLiveInputCleanup(
	barrier: WorkmuxScrollbackLiveInputCleanupBarrier,
	cleanup?: Promise<boolean> | null,
): Promise<boolean> | null {
	return barrier.track(cleanup);
}

export function resolveWorkmuxScrollbackLiveInputCleanup({
	clearScrollback,
	currentCleanup,
	startCleanup,
}: {
	clearScrollback: boolean;
	currentCleanup?: Promise<boolean> | null;
	startCleanup: () => Promise<boolean> | null;
}): Promise<boolean> | null {
	if (currentCleanup) return currentCleanup;
	return clearScrollback ? startCleanup() : null;
}

export function runWorkmuxScrollbackLiveInputSendPlan({
	plan,
	currentCleanup,
	startCleanup,
	remoteCopyModeActive,
	sendSegments,
	onPayloadAccepted,
	isRequestCurrent = () => true,
}: {
	plan: WorkmuxScrollbackLiveInputSendPlan;
	currentCleanup?: Promise<boolean> | null;
	startCleanup: () => Promise<boolean> | null;
	remoteCopyModeActive: boolean;
	isRequestCurrent?: () => boolean;
	sendSegments: (
		segments: Uint8Array<ArrayBuffer>[],
		options?: { interSegmentDelayMs?: number },
	) => void | Promise<unknown> | undefined;
	onPayloadAccepted?: () => void;
}): Promise<boolean> | null {
	const cleanupBarrier = resolveWorkmuxScrollbackLiveInputCleanup({
		clearScrollback: plan.clearScrollback,
		currentCleanup,
		startCleanup,
	});
	if (!plan.segments.length) return cleanupBarrier ?? null;

	const send = () => {
		onPayloadAccepted?.();
		return sendSegments(plan.segments, {
			interSegmentDelayMs: plan.interSegmentDelayMs,
		});
	};
	if (!cleanupBarrier && remoteCopyModeActive) return null;
	if (cleanupBarrier) {
		void cleanupBarrier
			.then((exited) => {
				if (exited && isRequestCurrent()) {
					void Promise.resolve(send()).catch(() => {});
				}
			})
			.catch(() => {});
		return cleanupBarrier;
	}
	if (!isRequestCurrent()) return null;
	void Promise.resolve(send()).catch(() => {});
	return null;
}

export function buildWorkmuxScrollbackLiveInputSendPlan({
	scrollbackActive,
	payloadSegments,
	scrollbackExitKeyPayload,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
}: {
	scrollbackActive: boolean;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	scrollbackExitKeyPayload?: Uint8Array<ArrayBuffer>;
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
}): WorkmuxScrollbackLiveInputSendPlan {
	const nonEmptyPayloadSegments = payloadSegments.filter(
		(segment) => segment.length > 0,
	);

	if (!scrollbackActive) {
		return {
			segments: nonEmptyPayloadSegments,
			interSegmentDelayMs,
			clearScrollback: false,
		};
	}

	const isExitKeyOnlyPayload =
		scrollbackExitKeyPayload != null &&
		nonEmptyPayloadSegments.length === 1 &&
		bytesEqual(nonEmptyPayloadSegments[0], scrollbackExitKeyPayload);

	return {
		segments: isExitKeyOnlyPayload ? [] : nonEmptyPayloadSegments,
		interSegmentDelayMs: scrollbackExitDelayMs,
		clearScrollback: true,
	};
}

function bytesEqual(
	a: Uint8Array<ArrayBuffer> | undefined,
	b: Uint8Array<ArrayBuffer>,
): boolean {
	if (!a || a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) {
		if (a[index] !== b[index]) return false;
	}
	return true;
}
