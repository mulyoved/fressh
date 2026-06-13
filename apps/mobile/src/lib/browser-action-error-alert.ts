// eslint-disable-next-line import/consistent-type-specifier-style -- Inline type specifiers preserve a React Native runtime import under verbatimModuleSyntax.
import type { AlertButton } from 'react-native';

import {
	formatBrowserActionErrorReport,
	redactBrowserActionErrorText,
	type BrowserActionErrorReport,
} from './browser-action-error-report';

export type BrowserActionErrorAlertButton = Pick<
	AlertButton,
	'text' | 'onPress'
>;

export type BrowserActionErrorAlertDeps = {
	alert: (
		title: string,
		message: string,
		buttons: BrowserActionErrorAlertButton[],
	) => void;
	copyText: (text: string) => Promise<void>;
	warn: (message: string, error: unknown) => void;
};

export function showBrowserActionErrorReport(
	report: BrowserActionErrorReport,
	deps: BrowserActionErrorAlertDeps,
) {
	const copyText = formatBrowserActionErrorReport(report);
	deps.alert(
		redactBrowserActionErrorText(report.title),
		redactBrowserActionErrorText(report.message),
		[
			{
				text: 'Copy Error',
				onPress: () => {
					void deps.copyText(copyText).catch((error: unknown) => {
						deps.warn('copy Browser action error failed', error);
						deps.alert(
							'Copy Error failed',
							`Clipboard copy failed. Error report:\n\n${copyText}`,
							[{ text: 'OK' }],
						);
					});
				},
			},
			{ text: 'OK' },
		],
	);
}
