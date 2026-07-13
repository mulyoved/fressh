import { type AsyncStringStorage } from '../../../src/lib/transactional-secure-storage/contracts';

export type StorageFault =
	| 'throw-before'
	| 'throw-after-visible'
	| 'volatile-success'
	| 'delete-noop';

export class FaultInjectingStringStorage implements AsyncStringStorage {
	readonly operationLog: {
		type: 'get' | 'set' | 'delete';
		key: string;
	}[] = [];

	private visible: Map<string, string>;
	private durable: Map<string, string>;
	private readonly faults = new Map<number, StorageFault>();
	private readFault?: { pattern: string; remainingMatches: number };
	private operationNumber = 0;

	constructor(initial: Record<string, string> = {}) {
		this.visible = new Map(Object.entries(initial));
		this.durable = new Map(Object.entries(initial));
	}

	failOperation(operationNumber: number, fault: StorageFault): void {
		this.faults.set(operationNumber, fault);
	}

	failMatchingRead(pattern: string, occurrence: number): void {
		this.readFault = { pattern, remainingMatches: occurrence };
	}

	restart(): void {
		this.visible = new Map(this.durable);
	}

	snapshotDurable(): Record<string, string> {
		return Object.fromEntries(this.durable);
	}

	async getItem(key: string): Promise<string | null> {
		this.operationLog.push({ type: 'get', key });
		if (this.readFault !== undefined && key.includes(this.readFault.pattern)) {
			this.readFault.remainingMatches -= 1;
			if (this.readFault.remainingMatches === 0) {
				this.readFault = undefined;
				throw new Error('Injected storage read fault');
			}
		}
		return this.visible.get(key) ?? null;
	}

	async setItem(key: string, value: string): Promise<void> {
		this.operationLog.push({ type: 'set', key });
		const fault = this.nextFault();
		if (fault === 'throw-before') {
			throw new Error('Injected storage fault before operation');
		}
		if (fault === 'delete-noop') {
			return;
		}
		this.visible.set(key, value);
		if (fault === 'throw-after-visible') {
			throw new Error('Injected storage fault after visible write');
		}
		if (fault !== 'volatile-success') {
			this.durable.set(key, value);
		}
	}

	async deleteItem(key: string): Promise<void> {
		this.operationLog.push({ type: 'delete', key });
		const fault = this.nextFault();
		if (fault === 'throw-before') {
			throw new Error('Injected storage fault before operation');
		}
		if (fault === 'delete-noop') {
			return;
		}
		this.visible.delete(key);
		if (fault === 'throw-after-visible') {
			throw new Error('Injected storage fault after visible delete');
		}
		if (fault !== 'volatile-success') {
			this.durable.delete(key);
		}
	}

	private nextFault(): StorageFault | undefined {
		this.operationNumber += 1;
		const fault = this.faults.get(this.operationNumber);
		this.faults.delete(this.operationNumber);
		return fault;
	}
}
