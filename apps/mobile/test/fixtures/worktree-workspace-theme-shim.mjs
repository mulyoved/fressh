const colors = new Proxy({}, { get: () => '#000000' });

export function useTheme() {
	return { colors };
}
