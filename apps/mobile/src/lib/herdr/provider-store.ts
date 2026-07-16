import { create } from 'zustand';

import { type HerdrHostState } from './contracts';

type HerdrProviderState = {
	host: HerdrHostState | null;
	setHost: (host: HerdrHostState) => void;
	clearHost: () => void;
};

export const useHerdrProviderStore = create<HerdrProviderState>((set) => ({
	host: null,
	setHost: (host) => set({ host }),
	clearHost: () => set({ host: null }),
}));
