import { useFocusEffect } from 'expo-router';
import React, { startTransition, useRef, useState } from 'react';

export function useShellRouteReady(): boolean {
	const [ready, setReady] = useState(false);
	const hasShownRef = useRef(false);

	useFocusEffect(
		React.useCallback(() => {
			if (hasShownRef.current) {
				setReady(true);
				return undefined;
			}

			let timeout: ReturnType<typeof setTimeout> | null = null;
			startTransition(() => {
				timeout = setTimeout(() => {
					hasShownRef.current = true;
					setReady(true);
				}, 16);
			});

			return () => {
				if (timeout) clearTimeout(timeout);
			};
		}, []),
	);

	return ready;
}
