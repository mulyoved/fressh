import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';

const require = createRequire(import.meta.url);
const mobileRoot = path.resolve(import.meta.dirname, '../..');
const srcRoot = path.join(mobileRoot, 'src');

async function resolveSourcePath(sourcePath: string) {
	for (const candidate of [
		sourcePath,
		`${sourcePath}.ts`,
		`${sourcePath}.tsx`,
		`${sourcePath}.js`,
		`${sourcePath}.jsx`,
		path.join(sourcePath, 'index.ts'),
		path.join(sourcePath, 'index.tsx'),
	]) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next Metro-style extension.
		}
	}
	return sourcePath;
}

const aliasPlugin: Plugin = {
	name: 'mobile-render-test-alias',
	setup(buildApi) {
		buildApi.onResolve({ filter: /^react-native$/ }, () => ({
			namespace: 'react-native-render-test',
			path: 'react-native',
		}));
		buildApi.onLoad({ filter: /.*/, namespace: 'react-native-render-test' }, () => ({
			contents: `
				import React from 'react';
				export function View(props) {
					const { children, pointerEvents, ...rest } = props;
					return React.createElement('div', rest, children);
				}
				export function Text(props) {
					const { children, numberOfLines, ...rest } = props;
					return React.createElement('span', rest, children);
				}
			`,
			loader: 'js',
			resolveDir: mobileRoot,
		}));
		buildApi.onResolve({ filter: /^lucide-react-native$/ }, () => ({
			namespace: 'empty-lucide',
			path: 'lucide-react-native',
		}));
		buildApi.onLoad({ filter: /.*/, namespace: 'empty-lucide' }, () => ({
			contents: 'export {};',
			loader: 'js',
		}));
		buildApi.onResolve({ filter: /^@\// }, async (args) => ({
			path: await resolveSourcePath(path.join(srcRoot, args.path.slice(2))),
		}));
	},
};

async function renderWorkLongPressPopup() {
	const tempDir = await mkdtemp(
		path.join(tmpdir(), 'terminal-keyboard-render-test-'),
	);
	const outfile = path.join(tempDir, 'render.cjs');

	try {
		await build({
			bundle: true,
			format: 'cjs',
			outfile,
			platform: 'node',
			plugins: [aliasPlugin],
			stdin: {
				resolveDir: mobileRoot,
				sourcefile: 'render-terminal-keyboard-popup.tsx',
				loader: 'tsx',
				contents: `
					import React from 'react';
					import { renderToStaticMarkup } from 'react-dom/server';
					import { TerminalKeyboardLongPressPopup } from './src/app/shell/components/TerminalKeyboardLongPressPopup';
					import { getLongPressPopupLayout } from './src/lib/keyboard-long-press';
					import { getWorkKeyLongPressOptions } from './src/lib/work-key-long-press-options';
					import type { KeyboardSlot } from './src/lib/shell-config';

					const theme = {
						colors: {
							background: '#000',
							surface: '#111',
							terminalBackground: '#000',
							border: '#222',
							borderStrong: '#333',
							textPrimary: '#fff',
							textSecondary: '#ccc',
							muted: '#999',
							primary: '#2563EB',
							buttonTextOnPrimary: '#fff',
							inputBackground: '#000',
							danger: '#f00',
							overlay: 'rgba(0,0,0,0.4)',
							transparent: 'transparent',
							shadow: '#000',
							primaryDisabled: '#3B82F6',
						},
					};
					const workSlot: KeyboardSlot = {
						type: 'action',
						actionId: 'WORKMUX_NAV_NEXT',
						label: 'Work',
						icon: 'AppWindow',
						span: 2,
						longPress: {
							options: [
								{
									type: 'action',
									actionId: 'WORKMUX_NAV_PREV',
									label: 'Prev',
									icon: null,
								},
								{
									type: 'action',
									actionId: 'WORKMUX_NAV_NEXT',
									label: 'Next',
									icon: null,
								},
								{
									type: 'action',
									actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
									label: 'Active',
									icon: null,
								},
								{
									type: 'action',
									actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
									label: '+Busy',
									icon: null,
								},
								{
									type: 'action',
									actionId: 'WORKMUX_NAV_SCOPE_ALL',
									label: 'All',
									icon: null,
								},
							],
						},
					};
					const options = getWorkKeyLongPressOptions(workSlot, 'visible');
					if (!options) throw new Error('expected Work options');

					export const html = renderToStaticMarkup(
						<TerminalKeyboardLongPressPopup
							popup={{
								slot: workSlot,
								options,
								layout: getLongPressPopupLayout({
									keyboardWidth: 360,
									anchorX: 160,
									anchorY: 200,
									anchorWidth: 40,
									optionCount: options.length,
								}),
								highlightedIndex: null,
							}}
							navScope="visible"
							theme={theme}
						/>,
					);
				`,
			},
		});
		const module = require(outfile) as {
			html: string;
		};
		return module.html;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

void test('Work long-press popup renders dynamic visible-scope labels and badges', async () => {
	const html = await renderWorkLongPressPopup();

	for (const label of [
		'Prev +Busy',
		'Prev All',
		'Next All',
		'Active',
		'+Busy',
		'All',
	]) {
		assert.match(html, new RegExp(`>${label.replace('+', '\\+')}<`));
	}
	assert.match(html, />\+B</);
	assert.match(html, />\u2200</);
});
