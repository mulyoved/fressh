export type WisprNativeControlLease = {
	release(): void;
	poison(): void;
};

export type WisprNativeControlSettlement = 'inactive' | 'unknown';

export type WisprNativeControlAcquisitionOutcome =
	| { status: 'acquired'; lease: WisprNativeControlLease }
	| { status: 'superseded' }
	| { status: 'cancelled' }
	| { status: 'blocked' };

export type WisprNativeControlAcquisition =
	| {
			status: 'acquired';
			lease: WisprNativeControlLease;
			outcome: Promise<WisprNativeControlAcquisitionOutcome>;
	  }
	| {
			status: 'waiting';
			outcome: Promise<WisprNativeControlAcquisitionOutcome>;
			cancel(): void;
	  }
	| {
			status: 'blocked';
			outcome: Promise<WisprNativeControlAcquisitionOutcome>;
	  };

export type WisprNativeControlAuthority = {
	acquire(): WisprNativeControlAcquisition;
};

type PendingAcquisition = {
	resolve(outcome: WisprNativeControlAcquisitionOutcome): void;
};

type AuthorityState =
	| { phase: 'idle' }
	| { phase: 'owned'; owner: symbol }
	| { phase: 'blocked' };

export function createWisprNativeControlAuthority(): WisprNativeControlAuthority {
	let state: AuthorityState = { phase: 'idle' };
	let pending: PendingAcquisition | null = null;

	const grant = (acquisition: PendingAcquisition) => {
		const leaseOwner = Symbol('wispr-native-control-lease');
		state = { phase: 'owned', owner: leaseOwner };
		const lease: WisprNativeControlLease = {
			release: () => {
				if (state.phase !== 'owned' || state.owner !== leaseOwner) return;
				state = { phase: 'idle' };
				const successor = pending;
				pending = null;
				if (successor) grant(successor);
			},
			poison: () => {
				if (state.phase !== 'owned' || state.owner !== leaseOwner) return;
				state = { phase: 'blocked' };
				const blocked = pending;
				pending = null;
				blocked?.resolve({ status: 'blocked' });
			},
		};
		acquisition.resolve({
			status: 'acquired',
			lease,
		});
		return lease;
	};

	return {
		acquire: () => {
			let resolve!: (outcome: WisprNativeControlAcquisitionOutcome) => void;
			const acquisition: PendingAcquisition = {
				resolve: (outcome) => resolve(outcome),
			};
			const outcome = new Promise<WisprNativeControlAcquisitionOutcome>(
				(onResolve) => {
					resolve = onResolve;
				},
			);
			if (state.phase === 'blocked') {
				acquisition.resolve({ status: 'blocked' });
				return {
					status: 'blocked' as const,
					outcome,
				};
			}
			if (state.phase === 'idle') {
				const lease = grant(acquisition);
				return {
					status: 'acquired' as const,
					lease,
					outcome,
				};
			}
			pending?.resolve({ status: 'superseded' });
			pending = acquisition;
			return {
				status: 'waiting' as const,
				outcome,
				cancel: () => {
					if (pending !== acquisition) return;
					pending = null;
					acquisition.resolve({ status: 'cancelled' });
				},
			};
		},
	};
}
