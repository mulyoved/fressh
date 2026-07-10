export type OrderedWriteFn = (
	bytes: Uint8Array<ArrayBufferLike>,
) => Promise<void>;

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener('abort', finish);
			resolve();
		};
		const timeout = setTimeout(finish, ms);
		signal?.addEventListener('abort', finish, { once: true });
	});

// Single-writer queue that guarantees no interleaving across all PTY writes.
export class OrderedWriter {
	private tail: Promise<void> = Promise.resolve();

	constructor(private write: OrderedWriteFn) {}

	send(bytes: Uint8Array<ArrayBufferLike>) {
		return this.enqueue(async () => {
			await this.write(bytes);
		});
	}

	sendBatch(
		segments: Uint8Array<ArrayBufferLike>[],
		opts?: {
			interSegmentDelayMs?: number;
			isCurrent?: () => boolean;
			signal?: AbortSignal;
		},
	) {
		const delayMs = opts?.interSegmentDelayMs ?? 0;
		const isCurrent = opts?.isCurrent;
		const signal = opts?.signal;
		return this.enqueue(async () => {
			for (let i = 0; i < segments.length; i += 1) {
				if (signal?.aborted) return;
				if (isCurrent && !isCurrent()) return;
				const segment = segments[i];
				if (segment) await this.write(segment);
				if (delayMs > 0 && i + 1 < segments.length) {
					await sleep(delayMs, signal);
				}
			}
		});
	}

	private enqueue(task: () => Promise<void>) {
		const next = this.tail.then(task, task);
		this.tail = next.catch(() => {});
		return next;
	}
}
