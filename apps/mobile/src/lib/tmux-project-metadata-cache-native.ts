import { MMKV } from 'react-native-mmkv';

import {
	createTmuxProjectMetadataCache,
	type TmuxProjectMetadataCacheStorage,
} from '@/lib/tmux-project-metadata';

const storage = new MMKV({ id: 'tmux-project-metadata-cache' });

const tmuxProjectMetadataCacheStorage: TmuxProjectMetadataCacheStorage = {
	getString: (key) => storage.getString(key),
	set: (key, value) => {
		storage.set(key, value);
	},
	delete: (key) => {
		storage.delete(key);
	},
};

export const tmuxProjectMetadataCache = createTmuxProjectMetadataCache({
	storage: tmuxProjectMetadataCacheStorage,
});
