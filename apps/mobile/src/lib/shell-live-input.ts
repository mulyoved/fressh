import {
	buildTmuxScrollbackLiveInputSendPlan,
	type TmuxScrollbackLiveInputSendPlan,
} from './tmux-scrollback';

const bytesEqual = (a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>) => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
};

const isSingleExitKeyPayload = (
	payloadSegments: Uint8Array<ArrayBuffer>[],
	exitKeyBytes: Uint8Array<ArrayBuffer>,
) =>
	payloadSegments.length === 1 &&
	payloadSegments[0] != null &&
	bytesEqual(payloadSegments[0], exitKeyBytes);

export function buildShellLiveInputSendPlan({
	scrollbackActive,
	cancelKeyBytes,
	exitKeyBytes,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	isCurrentPayloadExitKey,
}: {
	scrollbackActive: boolean;
	cancelKeyBytes: Uint8Array<ArrayBuffer>;
	exitKeyBytes: Uint8Array<ArrayBuffer>;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
	isCurrentPayloadExitKey?: boolean;
}): TmuxScrollbackLiveInputSendPlan {
	return buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive,
		cancelKey: cancelKeyBytes,
		payloadSegments,
		interSegmentDelayMs,
		scrollbackExitDelayMs,
		dropPayloadAfterExit:
			isCurrentPayloadExitKey ??
			isSingleExitKeyPayload(payloadSegments, exitKeyBytes),
	});
}

export function sendShellLiveInputSegments({
	scrollbackActive,
	cancelKeyBytes,
	exitKeyBytes,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	isCurrentPayloadExitKey,
	sendBytesQueued,
	clearScrollbackState,
	warn,
}: {
	scrollbackActive: boolean;
	cancelKeyBytes: Uint8Array<ArrayBuffer>;
	exitKeyBytes: Uint8Array<ArrayBuffer>;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
	isCurrentPayloadExitKey?: boolean;
	sendBytesQueued: (
		segments: Uint8Array<ArrayBuffer>[],
		opts?: { interSegmentDelayMs?: number },
	) => Promise<unknown> | undefined;
	clearScrollbackState: () => void;
	warn: (message: string) => void;
}): boolean {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive,
		cancelKeyBytes,
		exitKeyBytes,
		payloadSegments,
		interSegmentDelayMs,
		scrollbackExitDelayMs,
		isCurrentPayloadExitKey,
	});

	if (plan.type === 'block') {
		warn('cancelKey invalid; blocking input until Jump to live is used');
		return false;
	}

	if (plan.clearScrollback) {
		clearScrollbackState();
	}
	if (!plan.segments.length) return false;

	const send = sendBytesQueued(plan.segments, {
		interSegmentDelayMs: plan.interSegmentDelayMs,
	});
	void send;
	return send != null;
}
