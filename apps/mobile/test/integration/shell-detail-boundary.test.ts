import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const detailPath = join(process.cwd(), 'src/app/shell/detail.tsx');
const viewPath = join(process.cwd(), 'src/app/shell/ShellScreenView.tsx');
const worktreePath = join(
	process.cwd(),
	'src/lib/shell-controllers/worktree-workspace.tsx',
);
const worktreeAdapterPath = join(
	process.cwd(),
	'src/lib/shell-controllers/worktree-workspace-adapter.ts',
);
const scrollbackContractsPath = join(
	process.cwd(),
	'src/lib/shell-controllers/scrollback-contracts.ts',
);
const terminalContractsPath = join(
	process.cwd(),
	'src/lib/shell-controllers/terminal-contracts.ts',
);
const terminalRuntimePath = join(
	process.cwd(),
	'src/lib/shell-controllers/terminal-hook-runtime.ts',
);
const scrollbackCorePath = join(
	process.cwd(),
	'src/lib/shell-controllers/scrollback-core.ts',
);

function parse(source: string, fileName: string): ts.SourceFile {
	return ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
}

function countNonblankLines(source: string): number {
	return source.split('\n').filter((line) => line.trim().length > 0).length;
}

function countFunctionLines(file: ts.SourceFile, name: string): number {
	let match: ts.FunctionDeclaration | undefined;
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
			match = node;
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	assert.ok(match, `missing function ${name}`);
	const start = file.getLineAndCharacterOfPosition(match.getStart(file)).line;
	const end = file.getLineAndCharacterOfPosition(match.getEnd()).line;
	return end - start + 1;
}

function collectIdentifiers(file: ts.SourceFile): Set<string> {
	const identifiers = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node)) identifiers.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return identifiers;
}

function jsxElementNames(file: ts.SourceFile): string[] {
	const names: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			names.push(node.tagName.getText(file));
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return names;
}

const explicitWorkflowNames = new Set([
	'clearTimeout',
	'createManualTerminalFitRunner',
	'createWorkmuxControlChannel',
	'loadRuntimeShellConfigState',
	'reloadRuntimeShellConfigFromRemote',
	'setTimeout',
	'useAutoConnectStore',
	'useConnectionDebugCommand',
	'useShellSimpleModals',
	'useSshStore',
	'wisprAutomationNative',
]);

const explicitWorkflowModules = [
	'/auto-connect-store',
	'/shell-config-store-native',
	'/ssh-store',
	'/terminal-fit-runner',
	'/use-connection-debug-command',
	'/wispr-automation-native',
	'/workmux-control-channel',
];

function isControllerHook(name: string): boolean {
	return /^use[A-Z]\w*Controller$/.test(name);
}

function valueImportNames(node: ts.ImportDeclaration): string[] {
	const clause = node.importClause;
	if (!clause || clause.isTypeOnly) return [];
	const names: string[] = [];
	if (clause.name) names.push(clause.name.text);
	if (clause.namedBindings) {
		if (ts.isNamespaceImport(clause.namedBindings)) {
			names.push(clause.namedBindings.name.text);
		} else {
			for (const element of clause.namedBindings.elements) {
				if (!element.isTypeOnly) names.push(element.name.text);
			}
		}
	}
	return names;
}

function findViewWorkflowViolations(file: ts.SourceFile): string[] {
	const violations = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			const moduleName = node.moduleSpecifier.text;
			for (const name of valueImportNames(node)) {
				if (
					moduleName.includes('/shell-controllers/') ||
					explicitWorkflowModules.some((suffix) =>
						moduleName.endsWith(suffix),
					) ||
					isControllerHook(name) ||
					explicitWorkflowNames.has(name)
				) {
					violations.add(`value import ${name} from ${moduleName}`);
				}
			}
		}
		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const name = ts.isIdentifier(callee)
				? callee.text
				: ts.isPropertyAccessExpression(callee)
					? callee.name.text
					: callee.getText(file);
			const owner = ts.isPropertyAccessExpression(callee)
				? callee.expression.getText(file)
				: '';
			if (
				isControllerHook(name) ||
				explicitWorkflowNames.has(name) ||
				explicitWorkflowNames.has(owner)
			) {
				violations.add(`call ${callee.getText(file)}`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return [...violations].sort();
}

void test('shell detail is a small composition root without workflow ownership', () => {
	const source = readFileSync(detailPath, 'utf8');
	const file = parse(source, detailPath);
	const identifiers = collectIdentifiers(file);
	const elements = jsxElementNames(file);

	assert.ok(
		countNonblankLines(source) < 650,
		`detail.tsx has ${countNonblankLines(source)} nonblank lines`,
	);
	assert.ok(
		countFunctionLines(file, 'ShellDetail') < 300,
		`ShellDetail has ${countFunctionLines(file, 'ShellDetail')} physical lines`,
	);
	assert.ok(identifiers.has('useShellSessionController'));
	assert.ok(identifiers.has('useShellWisprController'));
	assert.ok(elements.includes('ShellScreenView'));

	for (const forbidden of [
		'setTimeout',
		'clearTimeout',
		'createWorkmuxControlChannel',
		'wisprAutomationNative',
		'useSshStore',
		'useAutoConnectStore',
	]) {
		assert.equal(identifiers.has(forbidden), false, forbidden);
	}
	let currentAssignment = false;
	const visit = (node: ts.Node): void => {
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isPropertyAccessExpression(node.left) &&
			node.left.name.text === 'current'
		) {
			currentAssignment = true;
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	assert.equal(currentAssignment, false, 'detail.tsx assigns ref.current');
});

void test('shell screen view owns the real render tree without shell workflows', () => {
	assert.equal(existsSync(viewPath), true, 'ShellScreenView.tsx is missing');
	const source = readFileSync(viewPath, 'utf8');
	const file = parse(source, viewPath);
	const elements = jsxElementNames(file);

	for (const component of [
		'XtermJsWebView',
		'TerminalKeyboard',
		'TextEntryModal',
		'WorktreeWorkspaceModal',
	]) {
		assert.ok(elements.includes(component), `${component} JSX is missing`);
	}
	assert.deepEqual(findViewWorkflowViolations(file), []);

	let unchangedSpreadWrapper = false;
	const visit = (node: ts.Node): void => {
		if (
			ts.isFunctionDeclaration(node) &&
			node.name?.text === 'ShellScreenView' &&
			node.body?.statements.length === 1
		) {
			const statement = node.body.statements[0];
			if (!statement) return;
			if (
				ts.isReturnStatement(statement) &&
				statement.expression &&
				ts.isJsxSelfClosingElement(statement.expression) &&
				statement.expression.attributes.properties.some((property) =>
					ts.isJsxSpreadAttribute(property),
				)
			) {
				unchangedSpreadWrapper = true;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	assert.equal(
		unchangedSpreadWrapper,
		false,
		'ShellScreenView must own the real JSX tree',
	);
});

void test('Worktree workspace consumes typed shell ports and is rendered only by the view', () => {
	const detail = readFileSync(detailPath, 'utf8');
	const view = readFileSync(viewPath, 'utf8');
	const worktree = [worktreePath, worktreeAdapterPath]
		.map((path) => readFileSync(path, 'utf8'))
		.join('\n');

	assert.doesNotMatch(worktree, /\bWorkmuxControlChannel\b/);
	assert.doesNotMatch(worktree, /\bRegisteredSshConnection\b/);
	assert.match(worktree, /\bShellWorkmuxPort\b/);
	assert.match(worktree, /\bShellTargetKey\b/);
	assert.match(view, /<WorktreeWorkspaceModal\b/);
	assert.doesNotMatch(detail, /<WorktreeWorkspaceModal\b/);
});

void test('React-free controller contracts do not import sibling React controllers', () => {
	const source = readFileSync(scrollbackContractsPath, 'utf8');
	const file = parse(source, scrollbackContractsPath);
	const imports = file.statements
		.filter(ts.isImportDeclaration)
		.map((declaration) => declaration.moduleSpecifier)
		.filter(ts.isStringLiteral)
		.map((specifier) => specifier.text);
	assert.equal(imports.includes('./terminal'), false);
});

void test('scrollback composes the remote copy mode owner without inline ownership cells', () => {
	const source = readFileSync(scrollbackCorePath, 'utf8');
	assert.match(source, /createScrollbackRemoteCopyModeOwner/);
	assert.doesNotMatch(source, /createRemoteCopyOwnershipRef/);
	assert.doesNotMatch(source, /createScrollbackRetirementRegistration/);
	assert.doesNotMatch(source, /remoteCopyModeActive\?: \{ current: boolean \}/);
});

void test('terminal contracts own the runtime view interface', () => {
	const contracts = readFileSync(terminalContractsPath, 'utf8');
	const runtime = readFileSync(terminalRuntimePath, 'utf8');
	const consumers = [
		'keyboard-controller-adapter.ts',
		'keyboard-hook-contracts.ts',
		'keyboard-hook-runtime.ts',
		'keyboard-input-contracts.ts',
		'keyboard-input-support.ts',
		'scrollback-contracts.ts',
	].map((name) =>
		readFileSync(
			join(process.cwd(), 'src/lib/shell-controllers', name),
			'utf8',
		),
	);

	assert.match(contracts, /export type ShellTerminalViewPort\s*=\s*\{/);
	assert.match(contracts, /getRuntimeKey\(\):/);
	assert.doesNotMatch(contracts, /from ['"]\.\/terminal-hook-runtime['"]/);
	assert.doesNotMatch(runtime, /export type ShellTerminalRuntimeView\s*=/);
	assert.match(
		runtime,
		/from ['"]\.\/terminal-contracts['"]/,
		'terminal runtime must consume the canonical contract',
	);
	for (const source of consumers) {
		assert.doesNotMatch(
			source,
			/import[^;]*ShellTerminal(?:RuntimeView|ViewPort)[^;]*from ['"]\.\/terminal-hook-runtime['"];/s,
		);
	}
});

void test('view ownership guard rejects workflow values but permits controller types', () => {
	const fixture = parse(
		`import {
			type ShellTerminalControllerHandle,
			useShellActivityController,
			useBrowserActionsController,
		} from '@/lib/shell-controllers/terminal';
		import { useShellSimpleModals } from '@/lib/shell-controllers/simple-modals';
		import { wisprAutomationNative } from '@/lib/wispr-automation-native';
		import { createWorkmuxControlChannel } from '@/lib/workmux-control-channel';
		function BadView() {
			useBrowserActionsController({});
			useShellNotificationsController({});
			useShellSimpleModals({});
			const timer = setTimeout(() => {}, 1);
			clearTimeout(timer);
			createWorkmuxControlChannel({});
			wisprAutomationNative.getStatus();
			return null;
		}`,
		'BadView.tsx',
	);

	assert.deepEqual(findViewWorkflowViolations(fixture), [
		'call clearTimeout',
		'call createWorkmuxControlChannel',
		'call setTimeout',
		'call useBrowserActionsController',
		'call useShellNotificationsController',
		'call useShellSimpleModals',
		'call wisprAutomationNative.getStatus',
		'value import createWorkmuxControlChannel from @/lib/workmux-control-channel',
		'value import useBrowserActionsController from @/lib/shell-controllers/terminal',
		'value import useShellActivityController from @/lib/shell-controllers/terminal',
		'value import useShellSimpleModals from @/lib/shell-controllers/simple-modals',
		'value import wisprAutomationNative from @/lib/wispr-automation-native',
	]);
});
