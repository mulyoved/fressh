import {
	buildHerdrTerminalControlCommand,
	createBoundedHerdrStderr,
	createHerdrLineDecoder,
	encodeHerdrInput,
	encodeHerdrRelease,
	encodeHerdrResize,
	encodeHerdrScroll,
	parseHerdrRecord,
	sanitizeHerdrDiagnostic,
} from './protocol';

export const HERDR_FIRST_FRAME_TIMEOUT_MS = 10_000;
export const HERDR_RESIZE_COALESCE_MS = 100;
export const HERDR_RELEASE_GRACE_MS = 250;

export type HerdrTerminalState =
	| Readonly<{ phase: 'starting'; generation: number }>
	| Readonly<{ phase: 'active'; generation: number }>
	| Readonly<{
			phase: 'owned-elsewhere';
			generation: number;
			reason: string;
	  }>
	| Readonly<{ phase: 'backgrounded'; generation: number }>
	| Readonly<{ phase: 'releasing'; generation: number }>
	| Readonly<{
			phase: 'error';
			generation: number;
			kind: 'synchronization' | 'timeout' | 'closed' | 'transport';
			reason: string;
	  }>;

export type HerdrCommandStreamEvent =
	| Readonly<{ type: 'stdout'; bytes: ArrayBuffer }>
	| Readonly<{ type: 'stderr'; bytes: ArrayBuffer }>
	| Readonly<{ type: 'exitStatus'; exitStatus: number }>
	| Readonly<{ type: 'exitSignal'; signalName: string }>
	| Readonly<{ type: 'closed' }>;

export type HerdrCommandStream = Readonly<{
	sendData(data: ArrayBuffer): Promise<void>;
	close(): Promise<void>;
}>;

export type HerdrTerminalConnection = Readonly<{
	startCommandStream(input: {
		command: string;
		onEvent(event: HerdrCommandStreamEvent): void;
		abortSignal?: AbortSignal;
	}): Promise<HerdrCommandStream>;
}>;

export type HerdrRendererPort = Readonly<{
	replace(bytes: Uint8Array): void;
	append(bytes: Uint8Array): void;
}>;

type HerdrLogMetadata = Readonly<
	Record<string, string | number | boolean | null>
>;

export type HerdrTerminalLogger = Readonly<{
	debug(message: string, metadata?: HerdrLogMetadata): void;
	warn(message: string, metadata?: HerdrLogMetadata): void;
}>;

export type HerdrTerminalClock = Readonly<{
	now(): number;
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
}>;

export type HerdrTerminalOwner = Readonly<{
	getState(): HerdrTerminalState;
	subscribe(listener: (state: HerdrTerminalState) => void): () => void;
	start(input: { cols: number; rows: number }): void;
	retry(input: { cols: number; rows: number }): void;
	takeOver(input: { cols: number; rows: number }): void;
	sendInput(bytes: Uint8Array): boolean;
	resize(cols: number, rows: number): boolean;
	scroll(direction: 'up' | 'down', lines: number): boolean;
	retire(
		reason: 'back' | 'switch' | 'retry' | 'failure' | 'unmount',
	): Promise<void>;
	background(): void;
}>;

type ResizeReady = Readonly<{
	promise: Promise<void>;
	resolve(): void;
}>;

type Generation = {
	id: number;
	retired: boolean;
	admitting: boolean;
	releaseQueued: boolean;
	releaseWindowExpired: boolean;
	stream: HerdrCommandStream | null;
	streamPromise: Promise<HerdrCommandStream> | null;
	closeImmediatelyWhenStarted: boolean;
	closeInvoked: boolean;
	closeInvokedReady: ResizeReady;
	decoder: ReturnType<typeof createHerdrLineDecoder>;
	stderr: ReturnType<typeof createBoundedHerdrStderr>;
	lastSeq: number | null;
	queue: Promise<void>;
	firstFrameTimer: ReturnType<typeof setTimeout> | null;
	resizeTimer: ReturnType<typeof setTimeout> | null;
	pendingResize: { cols: number; rows: number } | null;
	resizeReady: ResizeReady | null;
	cleanupPromise: Promise<void> | null;
	startedAtMs: number;
};

type CreateHerdrTerminalOwnerInput = Readonly<{
	terminalId: string;
	connection: HerdrTerminalConnection;
	renderer: HerdrRendererPort;
	logger: HerdrTerminalLogger;
	clock?: HerdrTerminalClock;
}>;

const defaultClock: HerdrTerminalClock = {
	now: () => Date.now(),
	setTimeout: globalThis.setTimeout,
	clearTimeout: globalThis.clearTimeout,
};

const synchronizationReason = 'Herdr terminal output lost synchronization.';
const timeoutReason =
	'Herdr terminal did not provide an initial frame in time.';
const ownershipConflictPhrase =
	'already has an attached client; retry with --takeover';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function isPositiveSize(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function createResizeReady(): ResizeReady {
	let resolve!: () => void;
	const promise = new Promise<void>((onResolve) => {
		resolve = onResolve;
	});
	return { promise, resolve };
}

export function createHerdrTerminalOwner(
	input: CreateHerdrTerminalOwnerInput,
): HerdrTerminalOwner {
	const clock = input.clock ?? defaultClock;
	const listeners = new Set<(state: HerdrTerminalState) => void>();
	let state: HerdrTerminalState = { phase: 'starting', generation: 0 };
	let generationCounter = 0;
	let current: Generation | null = null;
	let successorRequestEpoch = 0;

	function invalidateSuccessorRequests(): void {
		successorRequestEpoch += 1;
	}

	function isCurrent(generation: Generation): boolean {
		return current === generation;
	}

	function isCurrentAndLive(generation: Generation): boolean {
		return isCurrent(generation) && !generation.retired;
	}

	function publish(nextState: HerdrTerminalState): void {
		state = nextState;
		for (const listener of listeners) {
			try {
				listener(nextState);
			} catch {
				input.logger.warn('Herdr terminal state listener failed.', {
					generation: nextState.generation,
					phase: nextState.phase,
				});
			}
		}
	}

	function clearFirstFrameTimer(generation: Generation): void {
		if (generation.firstFrameTimer === null) return;
		clock.clearTimeout(generation.firstFrameTimer);
		generation.firstFrameTimer = null;
	}

	function cancelPendingResize(generation: Generation): void {
		if (generation.resizeTimer !== null) {
			clock.clearTimeout(generation.resizeTimer);
			generation.resizeTimer = null;
		}
		generation.pendingResize = null;
		generation.resizeReady?.resolve();
		generation.resizeReady = null;
	}

	function discardRawStderr(generation: Generation): void {
		generation.stderr = createBoundedHerdrStderr();
		input.logger.debug('Herdr terminal diagnostic buffer discarded.', {
			generation: generation.id,
		});
	}

	function logCleanupFailure(
		generation: Generation,
		operation: 'release' | 'close',
		error: unknown,
	): void {
		input.logger.warn('Herdr terminal cleanup failed.', {
			generation: generation.id,
			operation,
			errorClass:
				error instanceof Error && error.name ? error.name : typeof error,
		});
	}

	function resolveCloseWithoutStream(generation: Generation): void {
		if (generation.closeInvoked) return;
		generation.closeInvoked = true;
		generation.closeInvokedReady.resolve();
	}

	function invokeClose(
		generation: Generation,
		stream: HerdrCommandStream,
	): void {
		if (generation.closeInvoked) return;
		generation.closeInvoked = true;
		let close: Promise<void>;
		try {
			close = stream.close();
		} catch (error) {
			logCleanupFailure(generation, 'close', error);
			generation.closeInvokedReady.resolve();
			return;
		}
		generation.closeInvokedReady.resolve();
		void close.catch((error) => {
			logCleanupFailure(generation, 'close', error);
		});
	}

	function beginGracefulCleanup(generation: Generation): Promise<void> {
		if (generation.cleanupPromise) return generation.cleanupPromise;
		const shouldQueueRelease = !generation.releaseQueued;
		generation.releaseQueued = true;

		let resolveCleanup!: () => void;
		const cleanup = new Promise<void>((resolve) => {
			resolveCleanup = resolve;
		});
		generation.cleanupPromise = cleanup;

		let finished = false;
		let releaseTimer: ReturnType<typeof setTimeout> | null = null;
		const finish = (): void => {
			if (finished) return;
			finished = true;
			if (releaseTimer !== null) {
				clock.clearTimeout(releaseTimer);
				releaseTimer = null;
			}
			generation.closeImmediatelyWhenStarted = true;
			if (generation.stream) {
				invokeClose(generation, generation.stream);
			} else if (!generation.streamPromise) {
				resolveCloseWithoutStream(generation);
			}
			resolveCleanup();
		};

		const release = (
			shouldQueueRelease ? generation.queue : Promise.resolve()
		).then(async () => {
			if (!shouldQueueRelease) return;
			if (generation.releaseWindowExpired || generation.closeInvoked) return;
			let stream = generation.stream;
			if (!stream && generation.streamPromise) {
				try {
					stream = await generation.streamPromise;
				} catch {
					return;
				}
			}
			if (
				!stream ||
				generation.releaseWindowExpired ||
				generation.closeInvoked
			) {
				return;
			}
			try {
				await stream.sendData(toArrayBuffer(encodeHerdrRelease()));
			} catch (error) {
				logCleanupFailure(generation, 'release', error);
			}
		});
		void release.then(finish, finish);

		releaseTimer = clock.setTimeout(() => {
			generation.releaseWindowExpired = true;
			finish();
		}, HERDR_RELEASE_GRACE_MS);
		const maybeNodeTimer = releaseTimer as ReturnType<typeof setTimeout> & {
			unref?: () => void;
		};
		maybeNodeTimer.unref?.();
		return cleanup;
	}

	function bestEffortReleaseWithoutBlockingClose(generation: Generation): void {
		if (generation.releaseQueued) return;
		generation.releaseQueued = true;
		const stream = generation.stream;
		if (!stream) return;
		let release: Promise<void>;
		try {
			release = stream.sendData(toArrayBuffer(encodeHerdrRelease()));
		} catch (error) {
			logCleanupFailure(generation, 'release', error);
			return;
		}
		void release.catch((error) => {
			logCleanupFailure(generation, 'release', error);
		});
	}

	function fail(
		generation: Generation,
		kind: 'synchronization' | 'timeout' | 'closed' | 'transport',
		reason: string,
	): void {
		if (!isCurrentAndLive(generation)) return;
		invalidateSuccessorRequests();
		generation.admitting = false;
		generation.retired = true;
		clearFirstFrameTimer(generation);
		cancelPendingResize(generation);
		discardRawStderr(generation);
		publish({
			phase: 'error',
			generation: generation.id,
			kind,
			reason,
		});
		input.logger.warn('Herdr terminal generation failed.', {
			generation: generation.id,
			kind,
			lastSequence: generation.lastSeq,
		});
		void beginGracefulCleanup(generation);
	}

	function failOwnershipConflict(generation: Generation, reason: string): void {
		if (!isCurrentAndLive(generation)) return;
		invalidateSuccessorRequests();
		generation.admitting = false;
		generation.retired = true;
		clearFirstFrameTimer(generation);
		cancelPendingResize(generation);
		discardRawStderr(generation);
		publish({
			phase: 'owned-elsewhere',
			generation: generation.id,
			reason,
		});
		input.logger.debug('Herdr terminal is owned by another controller.', {
			generation: generation.id,
		});
		void beginGracefulCleanup(generation);
	}

	function failSynchronization(generation: Generation): void {
		fail(generation, 'synchronization', synchronizationReason);
	}

	function handleFrame(
		generation: Generation,
		record: ReturnType<typeof parseHerdrRecord> & {
			type: 'terminal.frame';
		},
	): void {
		if (!isCurrentAndLive(generation)) return;
		if (generation.lastSeq === null) {
			if (!record.full) {
				failSynchronization(generation);
				return;
			}
			generation.lastSeq = record.seq;
			clearFirstFrameTimer(generation);
			input.renderer.replace(record.bytes);
			if (!isCurrentAndLive(generation)) return;
			publish({ phase: 'active', generation: generation.id });
			input.logger.debug('Herdr terminal baseline accepted.', {
				generation: generation.id,
				sequence: record.seq,
				cols: record.width,
				rows: record.height,
				byteCount: record.bytes.byteLength,
				timeToFirstFrameMs: Math.max(0, clock.now() - generation.startedAtMs),
			});
			return;
		}

		if (record.seq <= generation.lastSeq) return;
		if (record.seq !== generation.lastSeq + 1) {
			failSynchronization(generation);
			return;
		}
		generation.lastSeq = record.seq;
		input.renderer.append(record.bytes);
		input.logger.debug('Herdr terminal delta accepted.', {
			generation: generation.id,
			sequence: record.seq,
			byteCount: record.bytes.byteLength,
		});
	}

	function dispatchLines(
		generation: Generation,
		lines: readonly string[],
	): void {
		for (const line of lines) {
			if (!isCurrentAndLive(generation)) return;
			const record = parseHerdrRecord(line);
			if (record.type === 'terminal.frame') {
				handleFrame(generation, record);
				continue;
			}
			if (record.type === 'terminal.closed') {
				const reason = sanitizeHerdrDiagnostic(record.reason ?? '');
				if (reason.includes(ownershipConflictPhrase)) {
					failOwnershipConflict(generation, reason);
					continue;
				}
				fail(generation, 'closed', reason || 'Herdr terminal stream closed.');
			}
		}
	}

	function handleStdout(generation: Generation, bytes: ArrayBuffer): void {
		if (!isCurrentAndLive(generation)) return;
		try {
			dispatchLines(generation, generation.decoder.push(bytes));
		} catch {
			failSynchronization(generation);
		}
	}

	function finalizeStdout(generation: Generation): void {
		try {
			dispatchLines(generation, generation.decoder.finish());
		} catch {
			failSynchronization(generation);
		}
	}

	function handleEvent(
		generation: Generation,
		event: HerdrCommandStreamEvent,
	): void {
		if (!isCurrentAndLive(generation)) return;
		if (event.type === 'stdout') {
			handleStdout(generation, event.bytes);
			return;
		}
		if (event.type === 'stderr') {
			generation.stderr.push(event.bytes);
			return;
		}
		finalizeStdout(generation);
		if (!isCurrentAndLive(generation)) return;
		if (event.type === 'exitStatus') {
			fail(
				generation,
				'transport',
				`Herdr terminal exited with status ${event.exitStatus}.`,
			);
			return;
		}
		if (event.type === 'exitSignal') {
			const signal = sanitizeHerdrDiagnostic(event.signalName);
			fail(
				generation,
				'transport',
				signal
					? `Herdr terminal exited with signal ${signal}.`
					: 'Herdr terminal exited unexpectedly.',
			);
			return;
		}
		const diagnostic = generation.stderr.getDisplayText();
		fail(generation, 'closed', diagnostic || 'Herdr terminal stream closed.');
	}

	function handleWriteFailure(generation: Generation, error: unknown): void {
		if (!isCurrentAndLive(generation)) return;
		input.logger.warn('Herdr terminal write failed.', {
			generation: generation.id,
			errorClass:
				error instanceof Error && error.name ? error.name : typeof error,
		});
		fail(generation, 'transport', 'Herdr terminal input failed.');
	}

	function enqueueWrite(
		generation: Generation,
		write: (stream: HerdrCommandStream) => Promise<void>,
	): void {
		const operation = generation.queue.then(async () => {
			if (!isCurrentAndLive(generation) || !generation.admitting) return;
			const streamPromise = generation.streamPromise;
			let stream = generation.stream;
			if (!stream) {
				if (!streamPromise) return;
				stream = await streamPromise;
			}
			if (!isCurrentAndLive(generation) || !generation.admitting) return;
			await write(stream);
		});
		generation.queue = operation.catch(() => {});
		void operation.catch((error) => handleWriteFailure(generation, error));
	}

	function startGeneration(startInput: {
		cols: number;
		rows: number;
		takeover: boolean;
	}): void {
		const generation: Generation = {
			id: ++generationCounter,
			retired: false,
			admitting: true,
			releaseQueued: false,
			releaseWindowExpired: false,
			stream: null,
			streamPromise: null,
			closeImmediatelyWhenStarted: false,
			closeInvoked: false,
			closeInvokedReady: createResizeReady(),
			decoder: createHerdrLineDecoder(),
			stderr: createBoundedHerdrStderr(),
			lastSeq: null,
			queue: Promise.resolve(),
			firstFrameTimer: null,
			resizeTimer: null,
			pendingResize: null,
			resizeReady: null,
			cleanupPromise: null,
			startedAtMs: clock.now(),
		};
		current = generation;
		publish({ phase: 'starting', generation: generation.id });
		generation.firstFrameTimer = clock.setTimeout(() => {
			if (!isCurrentAndLive(generation) || generation.lastSeq !== null) return;
			generation.firstFrameTimer = null;
			fail(generation, 'timeout', timeoutReason);
		}, HERDR_FIRST_FRAME_TIMEOUT_MS);
		const maybeNodeTimer = generation.firstFrameTimer as ReturnType<
			typeof setTimeout
		> & { unref?: () => void };
		maybeNodeTimer.unref?.();

		let streamPromise: Promise<HerdrCommandStream>;
		try {
			streamPromise = input.connection.startCommandStream({
				command: buildHerdrTerminalControlCommand({
					terminalId: input.terminalId,
					cols: startInput.cols,
					rows: startInput.rows,
					takeover: startInput.takeover,
				}),
				onEvent: (event) => handleEvent(generation, event),
			});
		} catch (error) {
			fail(generation, 'transport', 'Herdr terminal stream failed to start.');
			input.logger.warn('Herdr terminal stream start failed.', {
				generation: generation.id,
				errorClass:
					error instanceof Error && error.name ? error.name : typeof error,
			});
			return;
		}
		generation.streamPromise = streamPromise;
		void streamPromise.then(
			(stream) => {
				const live = isCurrentAndLive(generation);
				generation.stream = stream;
				if (!live && generation.closeImmediatelyWhenStarted) {
					invokeClose(generation, stream);
				}
			},
			(error) => {
				if (!isCurrentAndLive(generation)) {
					resolveCloseWithoutStream(generation);
					return;
				}
				input.logger.warn('Herdr terminal stream start failed.', {
					generation: generation.id,
					errorClass:
						error instanceof Error && error.name ? error.name : typeof error,
				});
				fail(generation, 'transport', 'Herdr terminal stream failed to start.');
				resolveCloseWithoutStream(generation);
			},
		);
		input.logger.debug('Herdr terminal generation started.', {
			generation: generation.id,
			terminalId: input.terminalId,
			cols: startInput.cols,
			rows: startInput.rows,
			takeover: startInput.takeover,
		});
	}

	function startAfterRetirement(
		startInput: { cols: number; rows: number },
		takeover: boolean,
	): void {
		const requestEpoch = ++successorRequestEpoch;
		const previous = current;
		if (!previous) {
			startGeneration({ ...startInput, takeover });
			return;
		}
		if (previous.retired) {
			void beginGracefulCleanup(previous);
		} else {
			void retireGeneration(previous, 'retry');
		}
		void previous.closeInvokedReady.promise.then(() => {
			if (
				requestEpoch !== successorRequestEpoch ||
				current !== previous ||
				!previous.retired ||
				!previous.closeInvoked
			) {
				return;
			}
			startGeneration({ ...startInput, takeover });
		});
	}

	function retireGeneration(
		generation: Generation,
		reason: 'back' | 'switch' | 'retry' | 'failure' | 'unmount',
	): Promise<void> {
		if (generation.retired) return beginGracefulCleanup(generation);
		generation.admitting = false;
		generation.retired = true;
		clearFirstFrameTimer(generation);
		cancelPendingResize(generation);
		discardRawStderr(generation);
		if (isCurrent(generation)) {
			publish({ phase: 'releasing', generation: generation.id });
		}
		input.logger.debug('Herdr terminal generation retiring.', {
			generation: generation.id,
			reason,
		});
		return beginGracefulCleanup(generation);
	}

	return {
		getState() {
			return state;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		start(startInput) {
			if (current) {
				startAfterRetirement(startInput, false);
				return;
			}
			startGeneration({
				...startInput,
				takeover: false,
			});
		},
		retry(startInput) {
			startAfterRetirement(startInput, false);
		},
		takeOver(startInput) {
			startAfterRetirement(startInput, true);
		},
		sendInput(bytes) {
			const generation = current;
			if (
				!generation ||
				!isCurrentAndLive(generation) ||
				!generation.admitting
			) {
				return false;
			}
			let payload: Uint8Array | null = encodeHerdrInput(bytes);
			enqueueWrite(generation, async (stream) => {
				try {
					if (payload) await stream.sendData(toArrayBuffer(payload));
				} finally {
					payload = null;
				}
			});
			return true;
		},
		resize(cols, rows) {
			const generation = current;
			if (
				!generation ||
				!isCurrentAndLive(generation) ||
				!generation.admitting ||
				!isPositiveSize(cols) ||
				!isPositiveSize(rows)
			) {
				return false;
			}
			generation.pendingResize = { cols, rows };
			if (generation.resizeTimer !== null) return true;

			const ready = createResizeReady();
			let expiredResize: { cols: number; rows: number } | null = null;
			generation.resizeReady = ready;
			generation.resizeTimer = clock.setTimeout(() => {
				if (!isCurrentAndLive(generation)) {
					ready.resolve();
					return;
				}
				expiredResize = generation.pendingResize;
				generation.pendingResize = null;
				generation.resizeTimer = null;
				generation.resizeReady = null;
				ready.resolve();
			}, HERDR_RESIZE_COALESCE_MS);
			enqueueWrite(generation, async (stream) => {
				await ready.promise;
				if (!isCurrentAndLive(generation) || !generation.admitting) return;
				const latest = expiredResize;
				expiredResize = null;
				if (!latest) return;
				await stream.sendData(
					toArrayBuffer(encodeHerdrResize(latest.cols, latest.rows)),
				);
			});
			return true;
		},
		scroll(direction, lines) {
			const generation = current;
			if (
				!generation ||
				!isCurrentAndLive(generation) ||
				!generation.admitting
			) {
				return false;
			}
			let payload: Uint8Array | null = encodeHerdrScroll(direction, lines);
			enqueueWrite(generation, async (stream) => {
				try {
					if (payload) await stream.sendData(toArrayBuffer(payload));
				} finally {
					payload = null;
				}
			});
			return true;
		},
		retire(reason) {
			invalidateSuccessorRequests();
			return current ? retireGeneration(current, reason) : Promise.resolve();
		},
		background() {
			invalidateSuccessorRequests();
			if (!current) return;
			const generation = current;
			generation.admitting = false;
			generation.retired = true;
			clearFirstFrameTimer(generation);
			cancelPendingResize(generation);
			discardRawStderr(generation);
			publish({ phase: 'backgrounded', generation: generation.id });
			input.logger.debug('Herdr terminal generation backgrounded.', {
				generation: generation.id,
			});
			bestEffortReleaseWithoutBlockingClose(generation);
			generation.closeImmediatelyWhenStarted = true;
			if (generation.stream) {
				invokeClose(generation, generation.stream);
			} else if (!generation.streamPromise) {
				resolveCloseWithoutStream(generation);
			}
		},
	};
}
