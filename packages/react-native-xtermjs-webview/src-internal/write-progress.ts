import { type BridgeInboundDraftMessage } from '../src/bridge';

export type WriteProgressReporter = {
	received(byteCount: number): void;
	completed(): void;
};

export function createWriteProgressReporter(input: {
	instanceId: string;
	now(): number;
	sendToRn(message: BridgeInboundDraftMessage): void;
	minIntervalMs?: number;
}): WriteProgressReporter {
	const minIntervalMs = input.minIntervalMs ?? 250;
	let receivedMessages = 0;
	let receivedBytes = 0;
	let completedWrites = 0;
	let lastReportAt = Number.NEGATIVE_INFINITY;
	return {
		received: (byteCount) => {
			receivedMessages += 1;
			receivedBytes += byteCount;
		},
		completed: () => {
			completedWrites += 1;
			const reportAt = input.now();
			if (reportAt - lastReportAt < minIntervalMs) return;
			lastReportAt = reportAt;
			input.sendToRn({
				type: 'outputProgress',
				instanceId: input.instanceId,
				receivedMessages,
				receivedBytes,
				completedWrites,
			});
		},
	};
}
