import assert from 'node:assert/strict';
import test from 'node:test';
import { createShellTerminalSourcePort } from '../../src/lib/shell-controllers/session-terminal-source';
import { createShellTransportKey } from '../../src/lib/shell-controllers/source-keys';

void test('terminal source preserves native bigint diagnostics and hides stale generations', () => {
	let generation = 41;
	const values = {
		currentSeq: 9_007_199_254_740_993n,
		ringBytesCount: 9_007_199_254_740_994n,
		usedBytes: 9_007_199_254_740_995n,
		headSeq: 9_007_199_254_740_996n,
		tailSeq: 9_007_199_254_740_997n,
		droppedBytesTotal: 9_007_199_254_740_998n,
		chunksCount: 9_007_199_254_740_999n,
	};
	const shell = {
		bufferStats: () => ({
			ringBytesCount: values.ringBytesCount,
			usedBytes: values.usedBytes,
			headSeq: values.headSeq,
			tailSeq: values.tailSeq,
			droppedBytesTotal: values.droppedBytesTotal,
			chunksCount: values.chunksCount,
		}),
		currentSeq: () => values.currentSeq,
	} as Parameters<typeof createShellTerminalSourcePort>[0]['shell'];
	const port = createShellTerminalSourcePort({
		channelId: 7,
		connectionId: 'connection-1',
		generation,
		getCurrentGeneration: () => generation,
		key: createShellTransportKey('connection-1', 7),
		shell,
	});

	assert.deepEqual(port.getNativeOutputDiagnostics(), {
		currentSeq: values.currentSeq.toString(),
		ringBytesCount: values.ringBytesCount.toString(),
		usedBytes: values.usedBytes.toString(),
		headSeq: values.headSeq.toString(),
		tailSeq: values.tailSeq.toString(),
		droppedBytesTotal: values.droppedBytesTotal.toString(),
		chunksCount: values.chunksCount.toString(),
	});
	generation += 1;
	assert.equal(port.getNativeOutputDiagnostics(), null);
});
