import {
	canStartWisprTextEntryAutomation,
	type WisprPendingAutoCloseRequest,
} from '../wispr-automation';
import { type WisprNativeControlSettlement } from './wispr-native-control-authority';

export type WisprCloseCoordinator = {
	requestAfterStart(request: WisprPendingAutoCloseRequest): void;
	expirePendingStart(requestId: number): boolean;
	consumeStartResult(requestId: number, started: boolean): boolean;
	blocksAutoStart(): boolean;
	deferAutoStart(requestId: number): void;
	takeDeferredAutoStart(): number | null;
	retireDeferredStart(): void;
	dispose(): void;
};

export type CreateWisprCloseCoordinatorInput = {
	close(retry: boolean): Promise<boolean>;
	onDeferredReady(): void;
	onTransactionSettled(
		requestId: number,
		settlement: WisprNativeControlSettlement,
	): void;
};

type CloseOperation = {
	requestId: number;
	closing: Promise<boolean>;
};

export function createWisprCloseCoordinator(
	deps: CreateWisprCloseCoordinatorInput,
): WisprCloseCoordinator {
	const pending = new Map<number, WisprPendingAutoCloseRequest>();
	const closes = new Set<CloseOperation>();
	let deferredRequestId: number | null = null;
	let readyRequestId: number | null = null;
	let disposed = false;

	const clearDeferred = () => {
		deferredRequestId = null;
		readyRequestId = null;
	};
	const blocksAutoStart = () =>
		!canStartWisprTextEntryAutomation({
			closeInFlight: closes.size > 0,
			pendingRequests: [...pending.values()],
		});
	const releaseDeferred = () => {
		if (blocksAutoStart() || deferredRequestId == null || disposed) return;
		readyRequestId = deferredRequestId;
		deferredRequestId = null;
		try {
			deps.onDeferredReady();
		} catch {
			clearDeferred();
		}
	};
	const finishClose = (operation: CloseOperation, successful: boolean) => {
		if (!closes.delete(operation)) return;
		deps.onTransactionSettled(
			operation.requestId,
			successful ? 'inactive' : 'unknown',
		);
		if (successful && !disposed) releaseDeferred();
		else clearDeferred();
	};
	const startClose = (requestId: number, retry: boolean) => {
		let closing: Promise<boolean>;
		try {
			closing = deps.close(retry);
		} catch {
			deps.onTransactionSettled(requestId, 'unknown');
			clearDeferred();
			return;
		}
		const operation: CloseOperation = { requestId, closing };
		closes.add(operation);
		void closing.then(
			(successful) => finishClose(operation, successful),
			() => finishClose(operation, false),
		);
	};
	const retireDeferredStart = () => {
		// UI work retires here; issued native toggles stay serialized until settled.
		clearDeferred();
	};

	return {
		requestAfterStart: (request) => {
			if (disposed) return;
			pending.set(request.requestId, request);
		},
		expirePendingStart: (requestId) => {
			if (!pending.delete(requestId)) return false;
			deps.onTransactionSettled(requestId, 'unknown');
			clearDeferred();
			return true;
		},
		consumeStartResult: (requestId, started) => {
			const request = pending.get(requestId);
			if (!request) return false;
			pending.delete(requestId);
			if (started) startClose(requestId, request.retryClose);
			else {
				deps.onTransactionSettled(requestId, 'inactive');
				releaseDeferred();
			}
			return true;
		},
		blocksAutoStart,
		deferAutoStart: (requestId) => {
			if (disposed) return;
			deferredRequestId = requestId;
			readyRequestId = null;
		},
		takeDeferredAutoStart: () => {
			const requestId = readyRequestId;
			readyRequestId = null;
			return requestId;
		},
		retireDeferredStart,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			retireDeferredStart();
		},
	};
}
