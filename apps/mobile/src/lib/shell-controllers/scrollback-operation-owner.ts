declare const scrollbackOperationOwnerBrand: unique symbol;

export type ScrollbackOperationOwner = Readonly<{
	[scrollbackOperationOwnerBrand]: true;
}>;

export function createScrollbackOperationOwnerRegistry<T extends object>() {
	const owners = new WeakMap<object, T>();
	return {
		create(value: T): ScrollbackOperationOwner {
			const owner = value as T & ScrollbackOperationOwner;
			owners.set(owner, value);
			return owner;
		},
		resolve(owner: ScrollbackOperationOwner | undefined): T | null {
			return owner ? (owners.get(owner) ?? null) : null;
		},
		release(owner: ScrollbackOperationOwner): void {
			owners.delete(owner);
		},
	};
}
