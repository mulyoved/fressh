import {
	isMdevBridgeCloseClass,
	mdevBridgeDiagnosticEvents,
	type ConnectionDiagnosticEvent,
	type MdevBridgeCloseClass,
} from './connection-diagnostics';
import { prepareWorkmuxBridgeCommandForRemoteShell } from './workmux-app-commands';

export const MDEV_BRIDGE_UPDATE_MESSAGE =
	'Update mdev on the remote machine; this action requires mdev bridge --jsonl.';

export type MdevBridgeStreamEvent =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

export type MdevBridgeCommandStream = {
	sendData: (
		data: ArrayBuffer,
		opts?: { signal?: AbortSignal },
	) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type MdevBridgeStreamConnection = {
	startCommandStream: (opts: {
		command: string;
		onEvent: (event: MdevBridgeStreamEvent) => void;
		abortSignal?: AbortSignal;
	}) => Promise<MdevBridgeCommandStream>;
};

export type MdevBridgeClient = {
	runOperation: (input: {
		operation: string;
		params: Record<string, unknown>;
		timeoutMs?: number;
	}) => Promise<MdevBridgeResult>;
	prepareDispose: (opts?: MdevBridgeDisposeOptions) => void;
	dispose: (opts?: MdevBridgeDisposeOptions) => Promise<void>;
};

export const MDEV_BRIDGE_DISPOSED_BY_RECONNECT_FAILURE_CLASS =
	'disposedByReconnect';

export type MdevBridgeFailureClass = MdevBridgeCloseClass;

export type MdevBridgeResult = {
	success: boolean;
	output: string;
	error?: string;
	failureClass?: MdevBridgeFailureClass;
};

export type MdevBridgeDisposeOptions = {
	reason?: 'reconnect' | 'unmount' | 'manual';
};

type MdevBridgeValidationResult = {
	result: MdevBridgeResult;
	fatal: boolean;
};

type PendingRequest = {
	id: string;
	operation: string | null;
	resolve: (result: MdevBridgeResult) => void;
	timer: ReturnType<typeof setTimeout>;
	validate: (response: unknown) => MdevBridgeValidationResult | null;
};

type MdevBridgeRequestDeadline = {
	expiresAtMs: number;
};

const MDEV_BRIDGE_PROTOCOL_ERROR = 'mdev bridge protocol error.';
const MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR = 'mdev bridge request timed out.';
const MDEV_BRIDGE_STREAM_CLOSED_ERROR = 'mdev bridge stream closed.';
const MDEV_BRIDGE_CLIENT_DISPOSED_ERROR = 'mdev bridge client disposed.';
const MDEV_BRIDGE_COMMAND = prepareWorkmuxBridgeCommandForRemoteShell(
	'mdev bridge --jsonl',
);

function errorResult(
	error: string,
	failureClass?: MdevBridgeFailureClass,
): MdevBridgeResult {
	return failureClass
		? { success: false, output: '', error, failureClass }
		: { success: false, output: '', error };
}

export function isMdevBridgeDisposedByReconnectFailureClass(
	failureClass: unknown,
): failureClass is typeof MDEV_BRIDGE_DISPOSED_BY_RECONNECT_FAILURE_CLASS {
	return failureClass === MDEV_BRIDGE_DISPOSED_BY_RECONNECT_FAILURE_CLASS;
}

export function isMdevBridgeFailureClass(
	failureClass: unknown,
): failureClass is MdevBridgeFailureClass {
	return isMdevBridgeCloseClass(failureClass);
}

function fatalResult(error: string): MdevBridgeValidationResult {
	return { result: errorResult(error), fatal: true };
}

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function createRequestDeadline(timeoutMs: number): MdevBridgeRequestDeadline {
	return {
		expiresAtMs: nowMs() + timeoutMs,
	};
}

function getRemainingTimeoutMs(deadline: MdevBridgeRequestDeadline): number {
	return Math.max(0, Math.ceil(deadline.expiresAtMs - nowMs()));
}

function raceQueueWaitWithRequestDeadline(
	queueWaitPromise: Promise<void>,
	queuedResultPromise: Promise<MdevBridgeResult>,
	deadline: MdevBridgeRequestDeadline,
): Promise<MdevBridgeResult> {
	const timeoutMs = getRemainingTimeoutMs(deadline);
	if (timeoutMs <= 0) {
		return Promise.resolve(
			errorResult(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR, 'timeout'),
		);
	}

	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(errorResult(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR, 'timeout'));
		}, timeoutMs);
		const maybeNodeTimer = timer as ReturnType<typeof setTimeout> & {
			unref?: () => void;
		};
		maybeNodeTimer.unref?.();

		queueWaitPromise.then(
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				queuedResultPromise.then(
					(result) => resolve(result),
					() => resolve(errorResult(MDEV_BRIDGE_UPDATE_MESSAGE)),
				);
			},
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(errorResult(MDEV_BRIDGE_UPDATE_MESSAGE));
			},
		);
	});
}

async function withBridgeTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: (error: Error) => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					const error = new Error(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR);
					reject(error);
					onTimeout(error);
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function includesAllRequiredOperations(
	operations: unknown[],
	requiredOperations: readonly string[],
): boolean {
	return requiredOperations.every((operation) =>
		operations.includes(operation),
	);
}

function validateHelloResponse(
	response: unknown,
	requiredOperations: readonly string[],
): MdevBridgeValidationResult | null {
	if (!isRecord(response)) return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	if (response.ok !== true) return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	if (response.protocolVersion !== 1) {
		return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	}

	if (
		!Array.isArray(response.supportedRequestTypes) ||
		!Array.isArray(response.operations)
	) {
		return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	}

	if (
		!response.supportedRequestTypes.includes('operation') ||
		!includesAllRequiredOperations(response.operations, requiredOperations)
	) {
		return fatalResult(MDEV_BRIDGE_UPDATE_MESSAGE);
	}

	return null;
}

function validateOperationResponse(
	response: unknown,
): MdevBridgeValidationResult {
	if (!isRecord(response)) return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	if (response.ok === true) {
		return {
			result: {
				success: true,
				output: `${JSON.stringify(response.result ?? {})}\n`,
			},
			fatal: false,
		};
	}
	if (response.ok === false) {
		const message = bridgeErrorMessage(response.error);
		if (message) {
			const failureClass =
				isRecord(response.error) && response.error.code === 'TIMEOUT'
					? 'timeout'
					: undefined;
			return { result: errorResult(message, failureClass), fatal: false };
		}
	}
	return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
}

function bridgeErrorMessage(error: unknown): string | null {
	if (typeof error === 'string') return error;
	if (!isRecord(error)) return null;
	if (typeof error.message === 'string') return error.message;
	return null;
}

export function createMdevBridgeClient({
	connection,
	requiredOperations,
	requestTimeoutMs,
	trace,
}: {
	connection: MdevBridgeStreamConnection;
	requiredOperations: readonly string[];
	requestTimeoutMs: number;
	trace?: { event: (event: ConnectionDiagnosticEvent) => void };
}): MdevBridgeClient {
	let disposed = false;
	let disposedError = MDEV_BRIDGE_CLIENT_DISPOSED_ERROR;
	let disposedClass: MdevBridgeFailureClass = 'clientDisposed';
	let failedError: string | null = null;
	let failedClass: MdevBridgeFailureClass | undefined;
	let nextRequestId = 1;
	let stream: MdevBridgeCommandStream | null = null;
	let streamPromise: Promise<MdevBridgeCommandStream> | null = null;
	let startupAbortController: AbortController | null = null;
	let startupDisposeRejecters: ((error: Error) => void)[] = [];
	let pending: PendingRequest | null = null;
	let stdoutBuffer = '';
	let helloComplete = false;
	const stdoutDecoder = new TextDecoder();
	let queue: Promise<void> = Promise.resolve();

	function emitLifecycle(input: {
		stage:
			| 'stream-starting'
			| 'hello-complete'
			| 'request-started'
			| 'request-completed'
			| 'request-failed'
			| 'stream-closed'
			| 'client-disposed';
		operation?: string | null;
		requestId?: string | null;
		closeClass?: MdevBridgeFailureClass;
		message?: string;
		success?: boolean;
	}) {
		try {
			trace?.event(
				mdevBridgeDiagnosticEvents.lifecycle({
					source: 'mdev-bridge',
					stage: input.stage,
					operation: input.operation ?? undefined,
					requestId: input.requestId ?? undefined,
					helloComplete,
					bridgeRequestInFlight: pending !== null,
					closeClass: input.closeClass,
					message: input.message,
					success: input.success,
				}),
			);
		} catch {
			// Diagnostic sinks must not affect bridge control flow.
		}
	}

	function nextId(): string {
		const id = `mdev-bridge-${nextRequestId}`;
		nextRequestId += 1;
		return id;
	}

	function finishPending(result: MdevBridgeResult) {
		const request = pending;
		if (!request) return;
		pending = null;
		clearTimeout(request.timer);
		emitLifecycle({
			stage: 'request-completed',
			operation: request.operation,
			requestId: request.id,
			closeClass: result.failureClass,
			message: result.error,
			success: result.success,
		});
		request.resolve(result);
	}

	function disposedResult(): MdevBridgeResult {
		return errorResult(disposedError, disposedClass);
	}

	function closeStartedStreamInBackground() {
		const startedStream = stream;
		if (!startedStream) return;
		stream = null;
		void closeStreamWithTimeout(startedStream);
	}

	function markFailed(error: string, failureClass: MdevBridgeFailureClass) {
		if (disposed) return;
		failedError = failedError ?? error;
		failedClass = failedClass ?? failureClass;
		emitLifecycle({
			stage: 'request-failed',
			operation: pending?.operation,
			requestId: pending?.id,
			closeClass: failedClass,
			message: failedError,
		});
		closeStartedStreamInBackground();
		finishPending(errorResult(failedError, failedClass));
	}

	function rejectStartupWaiters(error: Error) {
		const rejecters = startupDisposeRejecters;
		startupDisposeRejecters = [];
		for (const reject of rejecters) {
			reject(error);
		}
	}

	function waitForStartupDispose(): Promise<never> {
		if (disposed) {
			return Promise.reject(new Error(disposedError));
		}
		return new Promise((_, reject) => {
			startupDisposeRejecters.push(reject);
		});
	}

	function handleLine(line: string) {
		if (disposed || failedError) return;

		let response: unknown;
		try {
			response = JSON.parse(line);
		} catch {
			markFailed(MDEV_BRIDGE_PROTOCOL_ERROR, 'protocolError');
			return;
		}

		if (!isRecord(response) || typeof response.id !== 'string') {
			markFailed(MDEV_BRIDGE_PROTOCOL_ERROR, 'protocolError');
			return;
		}

		const request = pending;
		if (!request || response.id !== request.id) {
			markFailed(MDEV_BRIDGE_PROTOCOL_ERROR, 'protocolError');
			return;
		}

		const result = request.validate(response);
		if (result) {
			if (!result.result.success && result.fatal) {
				markFailed(
					result.result.error ?? MDEV_BRIDGE_PROTOCOL_ERROR,
					result.result.error === MDEV_BRIDGE_UPDATE_MESSAGE
						? 'startupFailed'
						: 'protocolError',
				);
				return;
			}
			finishPending(result.result);
			return;
		}

		finishPending({ success: true, output: '' });
	}

	function handleStdout(data: ArrayBuffer) {
		stdoutBuffer += stdoutDecoder.decode(data, { stream: true });
		while (true) {
			const newlineIndex = stdoutBuffer.indexOf('\n');
			if (newlineIndex < 0) return;
			const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			handleLine(line);
		}
	}

	function handleEvent(event: MdevBridgeStreamEvent) {
		switch (event.type) {
			case 'stdout':
				handleStdout(event.bytes);
				break;
			case 'stderr':
				break;
			case 'exitStatus':
			case 'exitSignal':
			case 'closed':
				if (disposed) {
					emitLifecycle({
						stage: 'stream-closed',
						operation: pending?.operation,
						requestId: pending?.id,
						closeClass: disposedClass,
						message: disposedError,
					});
					return;
				}
				emitLifecycle({
					stage: 'stream-closed',
					operation: pending?.operation,
					requestId: pending?.id,
					closeClass: helloComplete ? 'remoteClosed' : 'startupFailed',
					message: helloComplete
						? MDEV_BRIDGE_STREAM_CLOSED_ERROR
						: MDEV_BRIDGE_UPDATE_MESSAGE,
				});
				markFailed(
					helloComplete
						? MDEV_BRIDGE_STREAM_CLOSED_ERROR
						: MDEV_BRIDGE_UPDATE_MESSAGE,
					helloComplete ? 'remoteClosed' : 'startupFailed',
				);
				break;
		}
	}

	async function closeStreamWithTimeout(targetStream: MdevBridgeCommandStream) {
		const abortController = new AbortController();
		let closePromise: Promise<void>;
		try {
			closePromise = targetStream.close({ signal: abortController.signal });
		} catch {
			return;
		}
		await withBridgeTimeout(closePromise, requestTimeoutMs, (error) =>
			abortController.abort(error),
		).catch(() => {});
	}

	async function ensureStream(
		startupTimeoutMs: number,
	): Promise<MdevBridgeCommandStream> {
		if (stream) return stream;
		if (streamPromise) return await streamPromise;

		const abortController = new AbortController();
		startupAbortController = abortController;
		let startCommandStreamPromise: Promise<MdevBridgeCommandStream>;
		try {
			emitLifecycle({ stage: 'stream-starting' });
			startCommandStreamPromise = connection.startCommandStream({
				command: MDEV_BRIDGE_COMMAND,
				onEvent: handleEvent,
				abortSignal: abortController.signal,
			});
		} catch {
			if (startupAbortController === abortController) {
				startupAbortController = null;
				startupDisposeRejecters = [];
			}
			if (disposed) {
				throw new Error(disposedError);
			}
			failedError = failedError ?? MDEV_BRIDGE_UPDATE_MESSAGE;
			failedClass = failedClass ?? 'startupFailed';
			throw new Error(failedError);
		}

		const startedStreamPromise = startCommandStreamPromise
			.then((startedStream) => {
				if (startupAbortController === abortController) {
					startupAbortController = null;
					startupDisposeRejecters = [];
				}
				if (disposed || failedError) {
					void closeStreamWithTimeout(startedStream);
					throw new Error(
						disposed
							? disposedError
							: (failedError ?? MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR),
					);
				}
				stream = startedStream;
				return startedStream;
			})
			.catch(() => {
				if (startupAbortController === abortController) {
					startupAbortController = null;
					startupDisposeRejecters = [];
				}
				if (disposed) {
					throw new Error(disposedError);
				}
				if (failedError) {
					throw new Error(failedError);
				}
				failedError = MDEV_BRIDGE_UPDATE_MESSAGE;
				failedClass = 'startupFailed';
				throw new Error(MDEV_BRIDGE_UPDATE_MESSAGE);
			});

		streamPromise = Promise.race([
			withBridgeTimeout(startedStreamPromise, startupTimeoutMs, (error) => {
				if (startupAbortController === abortController) {
					failedError = MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR;
					failedClass = 'timeout';
					abortController.abort(error);
					startupAbortController = null;
					startupDisposeRejecters = [];
				}
			}),
			waitForStartupDispose(),
		]);

		return await streamPromise;
	}

	async function closeStream() {
		const startedStream = stream;
		if (!startedStream) return;
		stream = null;
		await closeStreamWithTimeout(startedStream);
	}

	async function sendRequest({
		buildRequest,
		deadline,
		id,
		validate,
	}: {
		buildRequest: (timeoutMs: number) => Record<string, unknown>;
		deadline: MdevBridgeRequestDeadline;
		id: string;
		validate: PendingRequest['validate'];
	}): Promise<MdevBridgeResult> {
		if (disposed) {
			return disposedResult();
		}
		if (failedError) return errorResult(failedError, failedClass);

		const startupTimeoutMs = getRemainingTimeoutMs(deadline);
		if (startupTimeoutMs <= 0) {
			return errorResult(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR, 'timeout');
		}

		const startedStream = await ensureStream(startupTimeoutMs);
		if (disposed) {
			return disposedResult();
		}
		if (failedError) return errorResult(failedError, failedClass);

		const localTimeoutMs = getRemainingTimeoutMs(deadline);
		if (localTimeoutMs <= 0) {
			return errorResult(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR, 'timeout');
		}

		return await new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (pending?.id !== id) return;
				markFailed(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR, 'timeout');
			}, localTimeoutMs);

			let request: Record<string, unknown>;
			try {
				request = buildRequest(localTimeoutMs);
			} catch {
				pending = { id, operation: null, resolve, timer, validate };
				markFailed(MDEV_BRIDGE_PROTOCOL_ERROR, 'protocolError');
				return;
			}
			const operation =
				request.type === 'operation' && typeof request.operation === 'string'
					? request.operation
					: null;
			pending = {
				id,
				operation,
				resolve,
				timer,
				validate,
			};
			emitLifecycle({
				stage: 'request-started',
				operation: pending.operation,
				requestId: id,
			});
			let requestLine: string;
			try {
				requestLine = `${JSON.stringify(request)}\n`;
			} catch {
				if (pending?.id !== id) return;
				markFailed(MDEV_BRIDGE_PROTOCOL_ERROR, 'protocolError');
				return;
			}

			let sendPromise: Promise<void>;
			try {
				sendPromise = startedStream.sendData(bytes(requestLine));
			} catch {
				if (pending?.id !== id) return;
				const error = helloComplete
					? MDEV_BRIDGE_STREAM_CLOSED_ERROR
					: MDEV_BRIDGE_UPDATE_MESSAGE;
				markFailed(error, helloComplete ? 'sendFailed' : 'startupFailed');
				return;
			}

			sendPromise.catch(() => {
				if (pending?.id !== id) return;
				const error = helloComplete
					? MDEV_BRIDGE_STREAM_CLOSED_ERROR
					: MDEV_BRIDGE_UPDATE_MESSAGE;
				markFailed(error, helloComplete ? 'sendFailed' : 'startupFailed');
			});
		});
	}

	async function ensureHello(
		deadline: MdevBridgeRequestDeadline,
	): Promise<MdevBridgeResult | null> {
		if (helloComplete) return null;

		const id = nextId();
		const result = await sendRequest({
			deadline,
			id,
			buildRequest: () => ({ id, type: 'hello' }),
			validate: (response) => {
				const validation = validateHelloResponse(response, requiredOperations);
				if (validation) return validation;
				helloComplete = true;
				emitLifecycle({ stage: 'hello-complete', requestId: id });
				return null;
			},
		});

		if (!result.success || result.error) return result;
		return null;
	}

	async function runOperationNow(
		input: {
			operation: string;
			params: Record<string, unknown>;
		},
		deadline: MdevBridgeRequestDeadline,
	): Promise<MdevBridgeResult> {
		if (disposed) {
			return disposedResult();
		}
		if (failedError) return errorResult(failedError, failedClass);

		try {
			const helloResult = await ensureHello(deadline);
			if (helloResult) return helloResult;

			if (disposed) {
				return disposedResult();
			}
			if (failedError) return errorResult(failedError, failedClass);

			const id = nextId();

			return await sendRequest({
				deadline,
				id,
				buildRequest: (timeoutMs) => ({
					id,
					type: 'operation',
					operation: input.operation,
					params: input.params,
					timeoutMs,
				}),
				validate: (response) => validateOperationResponse(response),
			});
		} catch {
			if (disposed) {
				return disposedResult();
			}
			return errorResult(
				failedError ?? MDEV_BRIDGE_UPDATE_MESSAGE,
				failedClass ?? 'startupFailed',
			);
		}
	}

	function prepareDispose(opts: MdevBridgeDisposeOptions = {}) {
		if (disposed) return;
		const closeClass: MdevBridgeFailureClass =
			opts.reason === 'reconnect'
				? MDEV_BRIDGE_DISPOSED_BY_RECONNECT_FAILURE_CLASS
				: 'clientDisposed';
		const error = isMdevBridgeDisposedByReconnectFailureClass(closeClass)
			? MDEV_BRIDGE_STREAM_CLOSED_ERROR
			: MDEV_BRIDGE_CLIENT_DISPOSED_ERROR;
		disposedError = error;
		disposedClass = closeClass;
		emitLifecycle({
			stage: 'client-disposed',
			operation: pending?.operation,
			requestId: pending?.id,
			closeClass,
			message: error,
		});
		disposed = true;
		startupAbortController?.abort();
		startupAbortController = null;
		rejectStartupWaiters(new Error(disposedError));
		finishPending(disposedResult());
	}

	return {
		runOperation: (input) => {
			const deadline = createRequestDeadline(
				input.timeoutMs ?? requestTimeoutMs,
			);
			const queueWaitPromise = queue;
			const queuedResultPromise = queueWaitPromise.then(() =>
				runOperationNow(input, deadline),
			);
			queue = queuedResultPromise.then(
				() => undefined,
				() => undefined,
			);
			return raceQueueWaitWithRequestDeadline(
				queueWaitPromise,
				queuedResultPromise,
				deadline,
			);
		},
		prepareDispose,
		dispose: async (opts = {}) => {
			prepareDispose(opts);
			await closeStream();
		},
	};
}
