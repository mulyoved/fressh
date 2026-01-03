import { type InputConnectionDetails } from './secrets-manager';

type SavedConnectionMetadata = {
	modifiedAtMs: number;
	createdAtMs: number;
	priority: number;
	label?: string;
};

export type SavedConnectionEntry = {
	id: string;
	metadata: SavedConnectionMetadata;
	value: InputConnectionDetails;
};

type PartialConnectionEntry = {
	id: string;
	metadata: { modifiedAtMs?: number } | SavedConnectionMetadata;
	value: InputConnectionDetails;
};

export const pickLatestConnection = <T extends PartialConnectionEntry>(
	entries?: T[] | null,
): T | null => {
	if (!entries || entries.length === 0) return null;
	return entries.reduce((latest, entry) => {
		const latestModified = latest.metadata.modifiedAtMs ?? 0;
		const entryModified = entry.metadata.modifiedAtMs ?? 0;
		return entryModified > latestModified ? entry : latest;
	});
};
