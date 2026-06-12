import { type DetectedOpenCandidate } from '@/lib/detected-open-actions';

export function handleDetectedOpenPickerSelect({
	candidate,
	onClose,
	onSelect,
}: {
	candidate: DetectedOpenCandidate;
	onClose: () => void;
	onSelect: (candidate: DetectedOpenCandidate) => void;
}) {
	onClose();
	onSelect(candidate);
}

export function handleDetectedOpenPickerClose({
	onClose,
}: {
	onClose: () => void;
}) {
	onClose();
}

export function getDetectedOpenCandidateSubtitle(
	candidate: DetectedOpenCandidate,
): string {
	switch (candidate.kind) {
		case 'remote-url':
			return 'Remote URL';
		case 'local-url':
			return 'Local URL';
		case 'file':
			return 'File';
	}
}
