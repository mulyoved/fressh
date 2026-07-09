export function extractTmuxAttachFailureReason(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;

	const candidate = error as { inner?: unknown; tag?: unknown };
	if (candidate.tag !== 'TmuxAttachFailed') return null;
	if (!Array.isArray(candidate.inner)) return null;

	const reason = candidate.inner[0];
	if (typeof reason !== 'string') return null;

	const trimmed = reason.trim();
	return trimmed.length ? trimmed : null;
}

function extractStructuredInnerText(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;

	const inner = (error as { inner?: unknown }).inner;
	if (!Array.isArray(inner)) return null;

	const text = inner
		.filter((value): value is string => typeof value === 'string')
		.join(' ')
		.trim();
	return text.length ? text : null;
}

export function formatSshErrorMessage(error: unknown): string {
	const structuredText = extractStructuredInnerText(error);
	if (structuredText !== null) return structuredText;
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	if (typeof error === 'string' && error.trim().length > 0) {
		return error;
	}
	return 'Failed to connect';
}
