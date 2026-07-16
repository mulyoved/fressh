import { withTimeout, type WisprTimerPort } from '../wispr-automation';

const TAP_TIMEOUT_MS = 750;
const OPENING_FALLBACK_MS = 750;

export type WisprTextInputBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WisprFocusProtocol = {
	clearOpeningTimer(): void;
	focus(
		value: string,
		bounds: WisprTextInputBounds | undefined,
		requestId: number,
		capture: number,
	): void;
	scheduleFallback(input: {
		requestId: number;
		capture: number;
		currentText(): string;
	}): void;
};

export type CreateWisprFocusProtocolInput = WisprTimerPort & {
	primeDeadlineTimers: WisprTimerPort;
	tapScreen(x: number, y: number): Promise<unknown>;
	pixelRatio(): number;
	requestCurrent(requestId: number, capture: number): boolean;
	canFocus(): boolean;
	canStartTap(): boolean;
	onFocused(value: string): void;
	startTap(requestId: number, capture: number): Promise<void>;
	onScheduleFailure(error: unknown): void;
	warn(message: string, error: unknown): void;
};

export function createWisprFocusProtocol(
	deps: CreateWisprFocusProtocolInput,
): WisprFocusProtocol {
	let openingTimer: unknown;

	const clearOpeningTimer = () => {
		if (openingTimer === undefined) return;
		try {
			deps.clearTimeout(openingTimer);
		} catch {
			// A failed cancellation must not keep the protocol active.
		}
		openingTimer = undefined;
	};
	const focus = (
		value: string,
		bounds: WisprTextInputBounds | undefined,
		requestId: number,
		capture: number,
	) => {
		if (!deps.canFocus() || !deps.requestCurrent(requestId, capture)) return;
		clearOpeningTimer();
		deps.onFocused(value);
		void (async () => {
			if (bounds && bounds.width > 0 && bounds.height > 0) {
				try {
					if (!deps.requestCurrent(requestId, capture)) return;
					const ratio = deps.pixelRatio();
					const x = (bounds.x + bounds.width / 2) * ratio;
					const y = (bounds.y + Math.min(bounds.height / 2, 48)) * ratio;
					await withTimeout(
						deps.tapScreen(x, y),
						TAP_TIMEOUT_MS,
						deps.primeDeadlineTimers,
					);
					if (!deps.requestCurrent(requestId, capture)) return;
				} catch (error) {
					if (!deps.requestCurrent(requestId, capture)) return;
					deps.warn('Failed to prime Wispr text field', error);
				}
			}
			if (!deps.requestCurrent(requestId, capture)) return;
			if (!deps.canStartTap()) return;
			await deps.startTap(requestId, capture);
		})();
	};

	return {
		clearOpeningTimer,
		focus,
		scheduleFallback: ({ requestId, capture, currentText }) => {
			try {
				openingTimer = deps.setTimeout(
					() => focus(currentText(), undefined, requestId, capture),
					OPENING_FALLBACK_MS,
				);
			} catch (error) {
				deps.onScheduleFailure(error);
			}
		},
	};
}
