import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { type WorktreeWorkspaceState } from '../../src/lib/shell-controllers/worktree-workspace-contracts';
import {
	type CloseWorktreeWorkspacePreparation,
	type NewWorktreeWorkspacePreparation,
} from '../../src/lib/worktree-workspace-bridge';

const componentPath = join(
	process.cwd(),
	'src/app/shell/components/WorktreeWorkspaceModal.tsx',
);
const componentSource = readFileSync(componentPath, 'utf8');
const componentSourceFile = ts.createSourceFile(
	componentPath,
	componentSource,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.TSX,
);

const NEW_PREPARATION: NewWorktreeWorkspacePreparation = {
	target: 'main:codex',
	repositoryName: 'fressh',
	projectRoot: '/home/muly/code/fressh',
	suggestedBranch: 'issue-131-native-worktree-workspace',
};

const CLOSE_PREPARATION: CloseWorktreeWorkspacePreparation = {
	session: 'main',
	workspaceId: 'workspace-131',
	workspaceLabel: 'Issue 131',
	worktreePath: '/home/muly/code/fressh/.worktrees/issue-131',
	closeFingerprint: `sha256:${'a'.repeat(64)}`,
	windows: [
		{ id: '@1', name: 'editor' },
		{ id: '@2', name: 'tests' },
	],
};

async function loadModalPropsModule() {
	return import(
		'../../src/lib/shell-controllers/worktree-workspace-modal-props'
	);
}

function jsxElements(tagName: string): ts.JsxElement[] {
	const elements: ts.JsxElement[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isJsxElement(node) &&
			node.openingElement.tagName.getText(componentSourceFile) === tagName
		) {
			elements.push(node);
		}
		ts.forEachChild(node, visit);
	};
	visit(componentSourceFile);
	return elements;
}

function jsxSelfClosingElements(tagName: string): ts.JsxSelfClosingElement[] {
	const elements: ts.JsxSelfClosingElement[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isJsxSelfClosingElement(node) &&
			node.tagName.getText(componentSourceFile) === tagName
		) {
			elements.push(node);
		}
		ts.forEachChild(node, visit);
	};
	visit(componentSourceFile);
	return elements;
}

function jsxElementContaining(tagName: string, label: string): string {
	const element = jsxElements(tagName)
		.filter((candidate) =>
			candidate.getText(componentSourceFile).includes(label),
		)
		.sort(
			(left, right) =>
				left.getText(componentSourceFile).length -
				right.getText(componentSourceFile).length,
		)[0];
	assert.ok(element, `${tagName} containing ${label} was not found`);
	return element.getText(componentSourceFile);
}

void test('every controller phase maps to exact modal props and callback routes', async () => {
	const { buildWorktreeWorkspaceModalControllerProps } =
		await loadModalPropsModule();
	const events: string[] = [];
	const callbacks = {
		onRetry: () => events.push('retry'),
		onClose: () => {
			events.push('close');
			return true;
		},
		onCreate: (branch: string) => events.push(`create:${branch}`),
		onConfirm: () => events.push('confirm'),
	};
	const failure = { kind: 'remote', message: 'Remote failed.' } as const;
	const cases: readonly Readonly<{
		state: WorktreeWorkspaceState;
		expected: unknown;
	}>[] = [
		{
			state: { phase: 'idle' },
			expected: { open: false, mode: 'closed' },
		},
		{
			state: { phase: 'preparing-new', error: failure },
			expected: {
				open: true,
				mode: 'new',
				phase: 'preparing',
				preparation: null,
				error: failure.message,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onCreate: callbacks.onCreate,
			},
		},
		{
			state: {
				phase: 'editing-new',
				preparation: NEW_PREPARATION,
				error: failure,
			},
			expected: {
				open: true,
				mode: 'new',
				phase: 'editing',
				preparation: NEW_PREPARATION,
				error: failure.message,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onCreate: callbacks.onCreate,
			},
		},
		{
			state: { phase: 'creating', preparation: NEW_PREPARATION },
			expected: {
				open: true,
				mode: 'new',
				phase: 'submitting',
				preparation: NEW_PREPARATION,
				error: null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onCreate: callbacks.onCreate,
			},
		},
		{
			state: { phase: 'preparing-close', error: failure },
			expected: {
				open: true,
				mode: 'close',
				phase: 'preparing',
				preview: null,
				error: failure.message,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onConfirm: callbacks.onConfirm,
			},
		},
		{
			state: {
				phase: 'confirming-close',
				preparation: CLOSE_PREPARATION,
				error: failure,
			},
			expected: {
				open: true,
				mode: 'close',
				phase: 'confirming',
				preview: CLOSE_PREPARATION,
				error: failure.message,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onConfirm: callbacks.onConfirm,
			},
		},
		{
			state: { phase: 'closing', preparation: CLOSE_PREPARATION },
			expected: {
				open: true,
				mode: 'close',
				phase: 'submitting',
				preview: CLOSE_PREPARATION,
				error: null,
				onRetry: callbacks.onRetry,
				onClose: callbacks.onClose,
				onConfirm: callbacks.onConfirm,
			},
		},
	];

	for (const { state, expected } of cases) {
		assert.deepEqual(
			buildWorktreeWorkspaceModalControllerProps(state, callbacks),
			expected,
			state.phase,
		);
	}

	const editableCase = cases.find(({ state }) => state.phase === 'editing-new');
	assert.ok(editableCase);
	const editable = buildWorktreeWorkspaceModalControllerProps(
		editableCase.state,
		callbacks,
	);
	assert.equal(editable.mode, 'new');
	if (editable.mode !== 'new') return;
	editable.onRetry();
	assert.equal(editable.onClose(), true);
	editable.onCreate('task-branch');

	const confirmingCase = cases.find(
		({ state }) => state.phase === 'confirming-close',
	);
	assert.ok(confirmingCase);
	const confirming = buildWorktreeWorkspaceModalControllerProps(
		confirmingCase.state,
		callbacks,
	);
	assert.equal(confirming.mode, 'close');
	if (confirming.mode !== 'close') return;
	confirming.onConfirm();
	assert.deepEqual(events, ['retry', 'close', 'create:task-branch', 'confirm']);
});

void test('draft reset key preserves only the same prepared target and root', async () => {
	const { getWorktreeWorkspaceDraftResetKey } = await loadModalPropsModule();
	const callbacks = {
		onRetry: () => {},
		onClose: () => true,
		onCreate: () => {},
		onConfirm: () => {},
	};
	const editing = {
		open: true,
		mode: 'new',
		phase: 'editing',
		preparation: NEW_PREPARATION,
		error: null,
		...callbacks,
	} as const;
	const submitting = { ...editing, phase: 'submitting' } as const;
	const sameIdentityDifferentSuggestion = {
		...editing,
		preparation: { ...NEW_PREPARATION, suggestedBranch: 'another-name' },
	} as const;
	const differentTarget = {
		...editing,
		preparation: { ...NEW_PREPARATION, target: 'main:other' },
	} as const;
	const ambiguousDelimiterTarget = {
		...editing,
		preparation: {
			...NEW_PREPARATION,
			target: 'main',
			projectRoot: 'codex:/home/muly/code/fressh',
		},
	} as const;

	const editingKey = getWorktreeWorkspaceDraftResetKey(editing);
	assert.equal(getWorktreeWorkspaceDraftResetKey(submitting), editingKey);
	assert.equal(
		getWorktreeWorkspaceDraftResetKey(sameIdentityDifferentSuggestion),
		editingKey,
	);
	assert.notEqual(
		getWorktreeWorkspaceDraftResetKey(differentTarget),
		editingKey,
	);
	assert.notEqual(
		getWorktreeWorkspaceDraftResetKey(ambiguousDelimiterTarget),
		editingKey,
	);
	assert.equal(
		getWorktreeWorkspaceDraftResetKey({
			...editing,
			phase: 'preparing',
			preparation: null,
		}),
		null,
	);
	assert.equal(
		getWorktreeWorkspaceDraftResetKey({
			open: true,
			mode: 'close',
			phase: 'confirming',
			preview: CLOSE_PREPARATION,
			error: null,
			onRetry: callbacks.onRetry,
			onClose: callbacks.onClose,
			onConfirm: callbacks.onConfirm,
		}),
		null,
	);
	assert.equal(
		getWorktreeWorkspaceDraftResetKey({ open: false, mode: 'closed' }),
		null,
	);
});

void test('modal source renders the native controls, labels, and complete preview', () => {
	const reactNativeImport = componentSourceFile.statements.find(
		(statement): statement is ts.ImportDeclaration =>
			ts.isImportDeclaration(statement) &&
			statement.moduleSpecifier.getText(componentSourceFile) ===
				"'react-native'",
	);
	assert.ok(reactNativeImport, 'react-native import was not found');
	const nativeImports = new Set(
		reactNativeImport.importClause?.namedBindings &&
		ts.isNamedImports(reactNativeImport.importClause.namedBindings)
			? reactNativeImport.importClause.namedBindings.elements.map(
					(element) => element.name.text,
				)
			: [],
	);
	for (const required of [
		'Modal',
		'KeyboardAvoidingView',
		'TextInput',
		'ActivityIndicator',
		'Pressable',
		'ScrollView',
		'Text',
		'View',
	]) {
		assert.ok(
			nativeImports.has(required),
			`${required} is not imported natively`,
		);
	}

	assert.ok(jsxElements('Modal').length > 0);
	assert.ok(jsxElements('KeyboardAvoidingView').length > 0);
	assert.ok(jsxElements('ScrollView').length > 0);
	assert.ok(jsxSelfClosingElements('TextInput').length > 0);
	assert.ok(jsxSelfClosingElements('ActivityIndicator').length > 0);
	assert.match(componentSource, /New Worktree Workspace/);
	assert.match(componentSource, /Close Worktree Workspace/);
	assert.match(componentSource, /Task branch/);
	assert.match(componentSource, /Remove Worktree/);

	const createButton = jsxElementContaining('Pressable', 'Create');
	const removeButton = jsxElementContaining('Pressable', 'Remove Worktree');
	const cancelButton = jsxElementContaining('Pressable', 'Cancel');
	const retryButton = jsxElementContaining('Pressable', 'Retry');
	assert.match(createButton, /disabled=\{busy\}/);
	assert.match(removeButton, /disabled=\{busy\}/);
	assert.match(cancelButton, /disabled=\{busy\}/);
	assert.match(cancelButton, /onPress=\{onDismiss\}/);
	assert.match(retryButton, /onPress=\{onRetry\}/);

	const inputElement = jsxSelfClosingElements('TextInput')[0];
	assert.ok(inputElement, 'TextInput was not found');
	const input = inputElement.getText(componentSourceFile);
	assert.match(input, /value=\{draft\}/);
	assert.match(input, /editable=\{!busy\}/);
	assert.match(componentSource, /useState\(suggestedBranch\)/);
	assert.match(componentSource, /key=\{draftResetKey\}/);
	assert.match(componentSource, /preview\.workspaceLabel/);
	assert.match(componentSource, /preview\.worktreePath/);
	assert.match(componentSource, /preview\.windows\.length/);
	assert.match(componentSource, /preview\.windows\.map/);
	assert.match(componentSource, /window\.name/);
});

void test('busy modal blocks dismissal and source has no terminal-input path', () => {
	const modalElement = jsxElements('Modal')[0];
	assert.ok(modalElement, 'Modal was not found');
	const modal = modalElement.getText(componentSourceFile);
	assert.match(modal, /onRequestClose=\{onDismiss\}/);
	const backdrop = jsxElements('Pressable').find((element) =>
		element.openingElement.attributes.properties.some(
			(property) =>
				ts.isJsxAttribute(property) && property.name.getText() === 'testID',
		),
	);
	assert.ok(backdrop, 'modal backdrop was not found');
	const backdropSource = backdrop.getText(componentSourceFile);
	assert.match(backdropSource, /onPress=\{onDismiss\}/);
	assert.match(backdropSource, /disabled=\{busy\}/);
	assert.match(componentSource, /if \(busy\) return;/);

	const importSources = componentSourceFile.statements
		.filter(ts.isImportDeclaration)
		.map((statement) => statement.moduleSpecifier.getText(componentSourceFile));
	for (const source of importSources) {
		assert.doesNotMatch(source, /terminal|keyboard-action|workmux|tmux/i);
	}
	assert.doesNotMatch(
		componentSource,
		/sendBytes|sendData|onTerminalInput|runWorkmux|tmux/i,
	);
});
