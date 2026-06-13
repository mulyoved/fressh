# Feature Request Target Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user redirect a feature request to one of three pinned projects (Cube9, Fresh, Pro Skills) from the Feature Request modal, without leaving the current shell. Default behavior — file against the auto-resolved current repo — is unchanged.

**Architecture:** Add a small selection model (`FeatureRequestTargetSelection`) plus a pure helper (`selectFeatureRequestRepository`) and a submit-gating helper (`canSubmitFeatureRequest`) in `repo-feature-request.ts`. Build a presentational `FeatureRequestTargetPicker.tsx` (sibling Modal patterned on `DetectedOpenPickerModal`). Wire selection state into `FeatureRequestModal.tsx`; change `onSubmit` signature to receive the explicit repository slug. Update `useFeatureRequestController.submit` to accept and forward that slug into `buildCreateGitHubIssueCommand`.

**Tech Stack:** React Native (Expo, Android), TypeScript, `node:test` + `node:assert/strict` for tests, pnpm workspaces (commands run from `apps/mobile`).

**Reference spec:** `docs/superpowers/specs/2026-06-13-feature-request-target-picker-design.md`.

---

## File Structure

**Create:**
- `apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx` — presentational picker overlay (sibling Modal).
- `apps/mobile/test/integration/feature-request-target-picker.test.ts` — source-string + selection-helper tests.

**Modify:**
- `apps/mobile/src/lib/repo-feature-request.ts` — add pinned list + `FeatureRequestTargetSelection` type + `selectFeatureRequestRepository` + `canSubmitFeatureRequest`.
- `apps/mobile/test/integration/repo-feature-request.test.ts` — cover the new exports.
- `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx` — selection state, Target row, picker render, `onSubmit` signature change.
- `apps/mobile/src/lib/shell-modals.tsx` — `useFeatureRequestController.submit(description, repository)`; update `FeatureRequestModalProps.onSubmit` type.

**Untouched (good to verify still compiles):**
- `apps/mobile/src/app/shell/detail.tsx` — only consumes `featureRequest.modalProps` via spread, so the modal prop signature change is invisible here.

---

## Task 1: Pinned feature-request repos constant

**Files:**
- Modify: `apps/mobile/src/lib/repo-feature-request.ts`
- Test: `apps/mobile/test/integration/repo-feature-request.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/test/integration/repo-feature-request.test.ts`:

```ts
import {
	PINNED_FEATURE_REQUEST_REPOS,
} from '../../src/lib/repo-feature-request';

void test('PINNED_FEATURE_REQUEST_REPOS lists the three target projects in order', () => {
	assert.deepEqual(
		PINNED_FEATURE_REQUEST_REPOS.map((entry) => ({
			label: entry.label,
			repository: entry.repository,
		})),
		[
			{ label: 'Cube9', repository: 'cube-9/cube9' },
			{ label: 'Fresh', repository: 'mulyoved/fressh' },
			{ label: 'Pro Skills', repository: 'mulyoved/skills' },
		],
	);
});
```

Add the import to the existing import group at the top of the file alongside the other `repo-feature-request` imports.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "PINNED_FEATURE_REQUEST_REPOS"
```

Expected: FAIL with "PINNED_FEATURE_REQUEST_REPOS is not exported" or a TypeScript error from `tsx`.

- [ ] **Step 3: Implement the constant + module-level validation**

In `apps/mobile/src/lib/repo-feature-request.ts`, immediately below `const githubRepositoryPattern = ...`, add:

```ts
export type PinnedFeatureRequestRepo = {
	label: string;
	repository: string;
};

export const PINNED_FEATURE_REQUEST_REPOS: readonly PinnedFeatureRequestRepo[] = [
	{ label: 'Cube9', repository: 'cube-9/cube9' },
	{ label: 'Fresh', repository: 'mulyoved/fressh' },
	{ label: 'Pro Skills', repository: 'mulyoved/skills' },
] as const;

for (const entry of PINNED_FEATURE_REQUEST_REPOS) {
	if (!githubRepositoryPattern.test(entry.repository)) {
		throw new Error(
			`Invalid pinned feature request repository: ${entry.repository}`,
		);
	}
}
```

- [ ] **Step 4: Add a validation test**

Append to `apps/mobile/test/integration/repo-feature-request.test.ts`:

```ts
void test('PINNED_FEATURE_REQUEST_REPOS entries are valid owner/repo slugs', () => {
	const pattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
	for (const entry of PINNED_FEATURE_REQUEST_REPOS) {
		assert.match(entry.repository, pattern, entry.label);
	}
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "PINNED_FEATURE_REQUEST_REPOS"
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts
git commit -m "feat(mobile): add pinned feature request target list"
```

---

## Task 2: `selectFeatureRequestRepository` helper

**Files:**
- Modify: `apps/mobile/src/lib/repo-feature-request.ts`
- Test: `apps/mobile/test/integration/repo-feature-request.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/test/integration/repo-feature-request.test.ts`:

```ts
import {
	selectFeatureRequestRepository,
	type FeatureRequestTargetSelection,
} from '../../src/lib/repo-feature-request';

void test('selectFeatureRequestRepository returns the auto-resolved slug when Current is selected', () => {
	const selection: FeatureRequestTargetSelection = { kind: 'current' };
	assert.equal(
		selectFeatureRequestRepository(selection, 'mulyoved/skills'),
		'mulyoved/skills',
	);
});

void test('selectFeatureRequestRepository returns null when Current is selected and not yet resolved', () => {
	const selection: FeatureRequestTargetSelection = { kind: 'current' };
	assert.equal(selectFeatureRequestRepository(selection, null), null);
});

void test('selectFeatureRequestRepository returns the pinned slug regardless of the auto-resolved value', () => {
	const selection: FeatureRequestTargetSelection = {
		kind: 'pinned',
		repository: 'cube-9/cube9',
	};
	assert.equal(
		selectFeatureRequestRepository(selection, 'mulyoved/skills'),
		'cube-9/cube9',
	);
	assert.equal(selectFeatureRequestRepository(selection, null), 'cube-9/cube9');
});
```

Merge the new imports into the existing `repo-feature-request` import block.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "selectFeatureRequestRepository"
```

Expected: FAIL — symbol not exported.

- [ ] **Step 3: Implement the helper**

In `apps/mobile/src/lib/repo-feature-request.ts`, immediately below the `PINNED_FEATURE_REQUEST_REPOS` block, add:

```ts
export type FeatureRequestTargetSelection =
	| { kind: 'current' }
	| { kind: 'pinned'; repository: string };

export function selectFeatureRequestRepository(
	selection: FeatureRequestTargetSelection,
	autoResolvedRepository: string | null,
): string | null {
	if (selection.kind === 'pinned') return selection.repository;
	return autoResolvedRepository;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "selectFeatureRequestRepository"
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts
git commit -m "feat(mobile): add feature request target selection helper"
```

---

## Task 3: `canSubmitFeatureRequest` gating helper

**Files:**
- Modify: `apps/mobile/src/lib/repo-feature-request.ts`
- Test: `apps/mobile/test/integration/repo-feature-request.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/test/integration/repo-feature-request.test.ts`:

```ts
import { canSubmitFeatureRequest } from '../../src/lib/repo-feature-request';

void test('canSubmitFeatureRequest requires a non-empty trimmed description', () => {
	assert.equal(
		canSubmitFeatureRequest({
			description: '   ',
			selection: { kind: 'pinned', repository: 'cube-9/cube9' },
			autoResolvedRepository: 'mulyoved/skills',
			isSubmitting: false,
			isResolvingCurrent: false,
		}),
		false,
	);
});

void test('canSubmitFeatureRequest is false while submitting', () => {
	assert.equal(
		canSubmitFeatureRequest({
			description: 'add feature',
			selection: { kind: 'pinned', repository: 'cube-9/cube9' },
			autoResolvedRepository: 'mulyoved/skills',
			isSubmitting: true,
			isResolvingCurrent: false,
		}),
		false,
	);
});

void test('canSubmitFeatureRequest blocks Current selection while auto-resolve is running', () => {
	assert.equal(
		canSubmitFeatureRequest({
			description: 'add feature',
			selection: { kind: 'current' },
			autoResolvedRepository: null,
			isSubmitting: false,
			isResolvingCurrent: true,
		}),
		false,
	);
});

void test('canSubmitFeatureRequest blocks Current selection when auto-resolve failed', () => {
	assert.equal(
		canSubmitFeatureRequest({
			description: 'add feature',
			selection: { kind: 'current' },
			autoResolvedRepository: null,
			isSubmitting: false,
			isResolvingCurrent: false,
		}),
		false,
	);
});

void test('canSubmitFeatureRequest allows Current selection once auto-resolve succeeded', () => {
	assert.equal(
		canSubmitFeatureRequest({
			description: 'add feature',
			selection: { kind: 'current' },
			autoResolvedRepository: 'mulyoved/skills',
			isSubmitting: false,
			isResolvingCurrent: false,
		}),
		true,
	);
});

void test('canSubmitFeatureRequest allows pinned selection even while auto-resolve is unresolved', () => {
	assert.equal(
		canSubmitFeatureRequest({
			description: 'add feature',
			selection: { kind: 'pinned', repository: 'cube-9/cube9' },
			autoResolvedRepository: null,
			isSubmitting: false,
			isResolvingCurrent: true,
		}),
		true,
	);
});
```

Merge the new import into the existing import block.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "canSubmitFeatureRequest"
```

Expected: FAIL — symbol not exported.

- [ ] **Step 3: Implement the helper**

In `apps/mobile/src/lib/repo-feature-request.ts`, immediately below `selectFeatureRequestRepository`, add:

```ts
export type CanSubmitFeatureRequestInput = {
	description: string;
	selection: FeatureRequestTargetSelection;
	autoResolvedRepository: string | null;
	isSubmitting: boolean;
	isResolvingCurrent: boolean;
};

export function canSubmitFeatureRequest(
	input: CanSubmitFeatureRequestInput,
): boolean {
	if (input.description.trim().length === 0) return false;
	if (input.isSubmitting) return false;
	const effectiveRepository = selectFeatureRequestRepository(
		input.selection,
		input.autoResolvedRepository,
	);
	if (effectiveRepository == null) return false;
	if (input.selection.kind === 'current' && input.isResolvingCurrent) {
		return false;
	}
	return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "canSubmitFeatureRequest"
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts
git commit -m "feat(mobile): add feature request submit gating helper"
```

---

## Task 4: `FeatureRequestTargetPicker` component

**Files:**
- Create: `apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx`
- Create: `apps/mobile/test/integration/feature-request-target-picker.test.ts`

- [ ] **Step 1: Write the failing source-string test**

Create `apps/mobile/test/integration/feature-request-target-picker.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const sourcePath = join(
	process.cwd(),
	'src/app/shell/components/FeatureRequestTargetPicker.tsx',
);

void test('FeatureRequestTargetPicker exports the picker component', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /export function FeatureRequestTargetPicker\(/);
});

void test('FeatureRequestTargetPicker renders the Current row and iterates pinned entries', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /onSelect\(\{ kind: 'current' \}\)/);
	assert.match(source, /pinned\.map\(\(/);
	assert.match(
		source,
		/onSelect\(\{ kind: 'pinned', repository: entry\.repository \}\)/,
	);
});

void test('FeatureRequestTargetPicker shows Resolving and Unavailable states for Current', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /Resolving/);
	assert.match(source, /Unavailable/);
});

void test('FeatureRequestTargetPicker threads bottomOffset for keyboard avoidance', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, /bottomOffset/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "FeatureRequestTargetPicker"
```

Expected: FAIL — file does not exist (ENOENT).

- [ ] **Step 3: Create the component**

Create `apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx`:

```tsx
import React, { useCallback } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	type FeatureRequestTargetSelection,
	type PinnedFeatureRequestRepo,
} from '@/lib/repo-feature-request';
import { useTheme } from '@/lib/theme';

export function FeatureRequestTargetPicker({
	open,
	bottomOffset,
	currentRepository,
	isResolvingCurrent,
	selection,
	pinned,
	onClose,
	onSelect,
}: {
	open: boolean;
	bottomOffset: number;
	currentRepository: string | null;
	isResolvingCurrent: boolean;
	selection: FeatureRequestTargetSelection;
	pinned: readonly PinnedFeatureRequestRepo[];
	onClose: () => void;
	onSelect: (selection: FeatureRequestTargetSelection) => void;
}) {
	const theme = useTheme();

	const handleClose = useCallback(() => {
		onClose();
	}, [onClose]);

	const currentSubtitle = isResolvingCurrent
		? 'Resolving…'
		: (currentRepository ?? 'Unavailable');

	const isCurrentSelected = selection.kind === 'current';
	const pinnedSelectedRepository =
		selection.kind === 'pinned' ? selection.repository : null;

	return (
		<Modal
			transparent
			visible={open}
			animationType="fade"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '70%',
						width: '78%',
						maxWidth: 380,
						minWidth: 280,
						marginRight: 8,
						marginBottom: bottomOffset,
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
							}}
						>
							Pick Target Project
						</Text>
						<Pressable
							accessibilityRole="button"
							onPress={handleClose}
							style={{
								paddingHorizontal: 10,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
							}}
						>
							<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
						</Pressable>
					</View>

					<ScrollView>
						<TargetRow
							label="Current"
							subtitle={currentSubtitle}
							selected={isCurrentSelected}
							onPress={() => onSelect({ kind: 'current' })}
							theme={theme}
						/>
						{pinned.map((entry) => (
							<TargetRow
								key={entry.repository}
								label={entry.label}
								subtitle={entry.repository}
								selected={pinnedSelectedRepository === entry.repository}
								onPress={() =>
									onSelect({ kind: 'pinned', repository: entry.repository })
								}
								theme={theme}
							/>
						))}
					</ScrollView>
				</View>
			</Pressable>
		</Modal>
	);
}

function TargetRow({
	label,
	subtitle,
	selected,
	onPress,
	theme,
}: {
	label: string;
	subtitle: string;
	selected: boolean;
	onPress: () => void;
	theme: ReturnType<typeof useTheme>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected }}
			onPress={onPress}
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				paddingVertical: 12,
				paddingHorizontal: 12,
				borderRadius: 10,
				borderWidth: 1,
				borderColor: selected ? theme.colors.primary : theme.colors.border,
				backgroundColor: theme.colors.surface,
				marginBottom: 8,
			}}
		>
			<View
				style={{
					width: 14,
					height: 14,
					borderRadius: 7,
					borderWidth: 2,
					borderColor: selected ? theme.colors.primary : theme.colors.border,
					backgroundColor: selected ? theme.colors.primary : 'transparent',
					marginRight: 10,
				}}
			/>
			<View style={{ flex: 1 }}>
				<Text
					numberOfLines={1}
					style={{
						color: theme.colors.textPrimary,
						fontSize: 14,
						fontWeight: selected ? '700' : '600',
					}}
				>
					{label}
				</Text>
				<Text
					numberOfLines={1}
					style={{
						color: theme.colors.textSecondary,
						fontSize: 12,
						marginTop: 3,
					}}
				>
					{subtitle}
				</Text>
			</View>
		</Pressable>
	);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "FeatureRequestTargetPicker"
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run typecheck to confirm the import paths resolve**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: exits 0 (no new TypeScript errors).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx apps/mobile/test/integration/feature-request-target-picker.test.ts
git commit -m "feat(mobile): add feature request target picker component"
```

---

## Task 5: Wire picker into `FeatureRequestModal`

**Files:**
- Modify: `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx`
- Modify: `apps/mobile/test/integration/feature-request-target-picker.test.ts`

- [ ] **Step 1: Add the failing wiring tests**

Append to `apps/mobile/test/integration/feature-request-target-picker.test.ts`:

```ts
const modalPath = join(
	process.cwd(),
	'src/app/shell/components/FeatureRequestModal.tsx',
);

void test('FeatureRequestModal renders FeatureRequestTargetPicker with pinned list', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(source, /import \{ FeatureRequestTargetPicker \}/);
	assert.match(source, /<FeatureRequestTargetPicker/);
	assert.match(source, /pinned=\{PINNED_FEATURE_REQUEST_REPOS\}/);
});

void test('FeatureRequestModal owns selection state defaulting to current', () => {
	const source = readFileSync(modalPath, 'utf8');
	// useState<FeatureRequestTargetSelection>({ kind: 'current' }) — tolerant of
	// the multi-line formatting prettier produces around the generic.
	assert.match(
		source,
		/useState<FeatureRequestTargetSelection>\(\s*\{\s*kind:\s*'current',?\s*\}\s*\)/,
	);
	assert.match(source, /setSelection\(\{ kind: 'current' \}\);/);
});

void test('FeatureRequestModal uses canSubmitFeatureRequest and forwards repository on submit', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(source, /canSubmitFeatureRequest\(\{/);
	assert.match(
		source,
		/onSubmit\(description\.trim\(\), effectiveRepository\)/,
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "FeatureRequestModal"
```

Expected: FAIL — the new patterns don't appear in the modal yet.

- [ ] **Step 3: Rewrite `FeatureRequestModal.tsx`**

Replace the entire file `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx` with:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import {
	canSubmitFeatureRequest,
	PINNED_FEATURE_REQUEST_REPOS,
	selectFeatureRequestRepository,
	type FeatureRequestTargetSelection,
} from '@/lib/repo-feature-request';
import { useTheme } from '@/lib/theme';
import { FeatureRequestTargetPicker } from './FeatureRequestTargetPicker';

export function FeatureRequestModal({
	open,
	bottomOffset,
	onClose,
	onSubmit,
	targetRepository,
	isResolvingTarget = false,
	isSubmitting = false,
	error,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => boolean | void;
	onSubmit: (description: string, repository: string) => void;
	targetRepository?: string | null;
	isResolvingTarget?: boolean;
	isSubmitting?: boolean;
	error?: string;
}) {
	const theme = useTheme();
	const [description, setDescription] = useState('');
	const [selection, setSelection] = useState<FeatureRequestTargetSelection>({
		kind: 'current',
	});
	const [pickerOpen, setPickerOpen] = useState(false);

	useEffect(() => {
		if (!open) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset draft text and selection when parent closes the modal.
			setDescription('');
			setSelection({ kind: 'current' });
			setPickerOpen(false);
		}
	}, [open]);

	const handleClose = useCallback(() => {
		if (isSubmitting) return;
		const didClose = onClose();
		if (didClose === false) return;
		setDescription('');
		setSelection({ kind: 'current' });
		setPickerOpen(false);
	}, [isSubmitting, onClose]);

	const effectiveRepository = selectFeatureRequestRepository(
		selection,
		targetRepository ?? null,
	);

	const handleSubmit = useCallback(() => {
		if (!effectiveRepository) return;
		if (!description.trim() || isSubmitting) return;
		onSubmit(description.trim(), effectiveRepository);
	}, [description, effectiveRepository, isSubmitting, onSubmit]);

	const canSubmit = canSubmitFeatureRequest({
		description,
		selection,
		autoResolvedRepository: targetRepository ?? null,
		isSubmitting,
		isResolvingCurrent: isResolvingTarget,
	});

	const targetRowLabel =
		selection.kind === 'pinned'
			? (PINNED_FEATURE_REQUEST_REPOS.find(
					(entry) => entry.repository === selection.repository,
				)?.label ?? selection.repository)
			: 'Current';

	const targetRowSlug =
		selection.kind === 'pinned'
			? selection.repository
			: isResolvingTarget
				? 'Resolving…'
				: (targetRepository ?? 'Unavailable');

	const openPicker = useCallback(() => {
		if (isSubmitting) return;
		setPickerOpen(true);
	}, [isSubmitting]);

	const closePicker = useCallback(() => {
		setPickerOpen(false);
	}, []);

	const handlePickerSelect = useCallback(
		(next: FeatureRequestTargetSelection) => {
			setSelection(next);
			setPickerOpen(false);
		},
		[],
	);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{
						flex: 1,
						justifyContent: 'center',
						paddingBottom: bottomOffset,
					}}
				>
					<View
						onStartShouldSetResponder={() => true}
						style={{
							backgroundColor: theme.colors.background,
							borderTopLeftRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: '85%',
							width: '85%',
							maxWidth: 400,
							minWidth: 280,
							alignSelf: 'flex-end',
							marginRight: 8,
						}}
					>
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
								marginBottom: 12,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 18,
									fontWeight: '700',
								}}
							>
								Request a Feature
							</Text>
							<Pressable
								onPress={handleClose}
								disabled={isSubmitting}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text
									style={{
										color: isSubmitting
											? theme.colors.muted
											: theme.colors.textSecondary,
									}}
								>
									Cancel
								</Text>
							</Pressable>
						</View>
						<ScrollView keyboardShouldPersistTaps="handled">
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Target
							</Text>
							<Pressable
								accessibilityRole="button"
								onPress={openPicker}
								disabled={isSubmitting}
								style={{
									flexDirection: 'row',
									alignItems: 'center',
									justifyContent: 'space-between',
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									marginBottom: 16,
								}}
							>
								<View style={{ flex: 1, marginRight: 8 }}>
									<Text
										numberOfLines={1}
										style={{
											color: theme.colors.textPrimary,
											fontSize: 14,
											fontWeight: '600',
										}}
									>
										{targetRowLabel}
									</Text>
									<Text
										numberOfLines={1}
										style={{
											color: theme.colors.textSecondary,
											fontSize: 12,
											marginTop: 2,
										}}
									>
										{targetRowSlug}
									</Text>
								</View>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontSize: 14,
										fontWeight: '700',
									}}
								>
									▾
								</Text>
							</Pressable>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Description
							</Text>
							<TextInput
								value={description}
								onChangeText={setDescription}
								placeholder="Describe the feature or feedback in detail..."
								placeholderTextColor={theme.colors.muted}
								editable={!isSubmitting}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									minHeight: 120,
									textAlignVertical: 'top',
									marginBottom: 16,
								}}
								multiline
							/>
							{error && (
								<View
									style={{
										backgroundColor: theme.colors.danger + '20',
										borderWidth: 1,
										borderColor: theme.colors.danger,
										borderRadius: 8,
										padding: 12,
										marginBottom: 16,
									}}
								>
									<Text
										style={{
											color: theme.colors.danger,
											fontSize: 13,
											fontWeight: '600',
											marginBottom: 4,
										}}
									>
										Submission failed
									</Text>
									<Text
										style={{
											color: theme.colors.danger,
											fontSize: 12,
										}}
									>
										{error}
									</Text>
								</View>
							)}
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
									marginBottom: 16,
								}}
							>
								The title is generated automatically from your description.
								Creates a GitHub issue via the remote server. Requires gh and
								claude CLIs installed and authenticated on the server (gh auth
								login).
							</Text>
							<Pressable
								onPress={handleSubmit}
								disabled={!canSubmit}
								style={{
									backgroundColor: canSubmit
										? theme.colors.primary
										: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									flexDirection: 'row',
									justifyContent: 'center',
								}}
							>
								{(isSubmitting ||
									(selection.kind === 'current' && isResolvingTarget)) && (
									<ActivityIndicator
										size="small"
										color={theme.colors.buttonTextOnPrimary}
										style={{ marginRight: 8 }}
									/>
								)}
								<Text
									style={{
										color: canSubmit
											? theme.colors.buttonTextOnPrimary
											: theme.colors.textSecondary,
										fontWeight: '700',
									}}
								>
									{isSubmitting
										? 'Submitting...'
										: selection.kind === 'current' && isResolvingTarget
											? 'Resolving repository...'
											: 'Submit Feature Request'}
								</Text>
							</Pressable>
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
			<FeatureRequestTargetPicker
				open={pickerOpen}
				bottomOffset={bottomOffset}
				currentRepository={targetRepository ?? null}
				isResolvingCurrent={isResolvingTarget}
				selection={selection}
				pinned={PINNED_FEATURE_REQUEST_REPOS}
				onClose={closePicker}
				onSelect={handlePickerSelect}
			/>
		</Modal>
	);
}
```

- [ ] **Step 4: Run wiring tests to verify they pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "FeatureRequestModal"
```

Expected: PASS (3 tests, plus the four `FeatureRequestTargetPicker` tests from Task 4 continue passing).

- [ ] **Step 5: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: FAIL with an error in `apps/mobile/src/lib/shell-modals.tsx` about `FeatureRequestModalProps.onSubmit` signature mismatch (this is intentional — Task 6 fixes the controller side).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/shell/components/FeatureRequestModal.tsx apps/mobile/test/integration/feature-request-target-picker.test.ts
git commit -m "feat(mobile): pick feature request target from modal"
```

---

## Task 6: Update `useFeatureRequestController` to accept explicit repository

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/test/integration/feature-request-target-picker.test.ts`

- [ ] **Step 1: Write failing source-string tests**

Append to `apps/mobile/test/integration/feature-request-target-picker.test.ts`:

```ts
const shellModalsPath = join(process.cwd(), 'src/lib/shell-modals.tsx');

void test('FeatureRequestModalProps.onSubmit accepts description and repository', () => {
	const source = readFileSync(shellModalsPath, 'utf8');
	assert.match(
		source,
		/onSubmit: \(description: string, repository: string\) => Promise<void>;/,
	);
});

void test('useFeatureRequestController.submit forwards repository into buildCreateGitHubIssueCommand', () => {
	const source = readFileSync(shellModalsPath, 'utf8');
	assert.match(
		source,
		/async \(description: string, repository: string\) => \{/,
	);
	assert.match(
		source,
		/buildCreateGitHubIssueCommand\(\{\s*description,\s*repository,\s*\}\)/,
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "useFeatureRequestController|FeatureRequestModalProps"
```

Expected: FAIL — the patterns don't match the current source.

- [ ] **Step 3: Update `FeatureRequestModalProps.onSubmit` type**

In `apps/mobile/src/lib/shell-modals.tsx`, find the `FeatureRequestModalProps` type (currently around line 407) and replace:

```ts
	onSubmit: (description: string) => Promise<void>;
```

with:

```ts
	onSubmit: (description: string, repository: string) => Promise<void>;
```

- [ ] **Step 4: Update the `submit` callback inside `useFeatureRequestController`**

In the same file, find the `submit = useCallback(...)` (currently around line 526). Replace the entire callback definition with:

```ts
	const submit = useCallback(
		async (description: string, repository: string) => {
			if (submitInFlightRef.current) return;
			const id = submitRequestId.next();
			if (!connection) {
				setError('No SSH connection available');
				return;
			}
			if (!repository) {
				setError('Could not resolve GitHub repository for current window.');
				return;
			}

			submitInFlightRef.current = true;
			sourceStaleRef.current = false;
			setIsSubmitting(true);
			setError(undefined);

			const command = buildCreateGitHubIssueCommand({
				description,
				repository,
			});

			try {
				const result = await executeSideChannelCommand(
					connection,
					command,
					60_000,
				);
				if (!submitRequestId.isCurrent(id)) return;
				if (sourceStaleRef.current) {
					reset();
					sourceStaleRef.current = false;
					return;
				}
				if (result.success) {
					logger.info('Feature request submitted successfully', {
						output: result.output,
						issueUrl: result.issueUrl,
					});
					setOpen(false);
					setError(undefined);
					sourceStaleRef.current = false;
					const alert = buildFeatureRequestSubmittedAlert({
						issueUrl: result.issueUrl ?? null,
					});
					Alert.alert(alert.title, alert.message, [{ text: 'OK' }]);
				} else {
					const errorMsg =
						result.error ||
						'Failed to create issue. Make sure gh and claude CLIs are installed and authenticated on the remote host.';
					logger.error('Feature request failed', { error: errorMsg });
					if (!submitRequestId.isCurrent(id)) return;
					setError(errorMsg);
				}
			} catch (err) {
				const errorMsg =
					err instanceof Error ? err.message : 'Unknown error occurred';
				logger.error('Feature request error', { error: err });
				if (!submitRequestId.isCurrent(id)) return;
				if (sourceStaleRef.current) {
					reset();
					sourceStaleRef.current = false;
					return;
				}
				setError(errorMsg);
			} finally {
				if (submitRequestId.isCurrent(id)) {
					submitInFlightRef.current = false;
					setIsSubmitting(false);
				}
			}
		},
		[
			connection,
			executeSideChannelCommand,
			logger,
			reset,
			submitRequestId,
		],
	);
```

Note: `targetRepository` is removed from the dependency list because the callback no longer reads it. The internal state remains (still rendered for the Current row subtitle).

- [ ] **Step 5: Run source-string tests to verify they pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "useFeatureRequestController|FeatureRequestModalProps"
```

Expected: PASS (2 new tests).

- [ ] **Step 6: Run typecheck across the package**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: exits 0 (no errors).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/test/integration/feature-request-target-picker.test.ts
git commit -m "feat(mobile): submit feature request with picked repository"
```

---

## Task 7: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Run the entire integration test suite**

```bash
cd apps/mobile && pnpm test:integration
```

Expected: all tests pass. No pre-existing tests should have regressed.

- [ ] **Step 2: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run lint:check**

```bash
cd apps/mobile && pnpm lint:check
```

Expected: exits 0. If lint flags formatting in the new component or modal, fix the formatting and re-run.

- [ ] **Step 4: Manual sanity for `detail.tsx`**

```bash
grep -n "featureRequest.modalProps" apps/mobile/src/app/shell/detail.tsx
```

Expected: a single hit inside the `<FeatureRequestModal …>` JSX. No code changes required because the modal receives `onSubmit` through `{...featureRequest.modalProps}` spread; the new two-argument shape flows through automatically.

- [ ] **Step 5: Commit any lint/format fixups**

If Step 3 required edits:

```bash
git add apps/mobile/src/app/shell/components/FeatureRequestModal.tsx apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/lib/repo-feature-request.ts
git commit -m "chore(mobile): lint fixups for feature request target picker"
```

Otherwise skip this step.

---

## Done criteria

- The Feature Request modal shows a Target row above Description with the current label + slug.
- Tapping the Target row opens an overlay listing Current, Cube9, Fresh, Pro Skills.
- Choosing Cube9 / Fresh / Pro Skills files the issue against the pinned slug regardless of the auto-resolved current repo.
- Choosing Current preserves the existing behavior, including the resolving / unavailable states.
- All `apps/mobile` integration tests, typecheck, and lint pass.
