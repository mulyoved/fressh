export type GenerationRequestToken = number & {
	readonly __generationRequestToken: unique symbol;
};

export type GenerationRequestGate = {
	begin(): GenerationRequestToken | null;
	invalidate(): void;
	isCurrent(token: GenerationRequestToken): boolean;
	finish(token: GenerationRequestToken): void;
};

export function createGenerationRequestGate(): GenerationRequestGate {
	let generation = 0;
	let owner: GenerationRequestToken | null = null;

	return {
		begin: () => {
			if (owner !== null) return null;
			generation += 1;
			owner = generation as GenerationRequestToken;
			return owner;
		},
		invalidate: () => {
			generation += 1;
			owner = null;
		},
		isCurrent: (token) => owner === token,
		finish: (token) => {
			if (owner === token) owner = null;
		},
	};
}
