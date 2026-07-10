import { type DetectedOpenCandidate } from '@/lib/detected-open-actions';

export function handleDetectedOpenPickerSelection(
	candidate: DetectedOpenCandidate,
	callbacks: {
		onSelect(candidate: DetectedOpenCandidate): void;
	},
): void {
	callbacks.onSelect(candidate);
}
