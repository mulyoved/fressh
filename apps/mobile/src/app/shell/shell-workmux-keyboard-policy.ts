import { shouldShowFocusedActiveFeedback } from '@/lib/focused-active-request';
import {
	isMdevBridgeDisposedByReconnectFailureClass,
	type MdevBridgeFailureClass,
} from '@/lib/mdev-bridge-client';

export function shouldShowShellWorkmuxKeyboardFailure({
	failureClass,
	isAppActive,
	isFocused,
}: {
	failureClass?: MdevBridgeFailureClass;
	isAppActive: boolean;
	isFocused: boolean;
}): boolean {
	if (isMdevBridgeDisposedByReconnectFailureClass(failureClass)) {
		return false;
	}
	return shouldShowFocusedActiveFeedback({ isFocused, isAppActive });
}
