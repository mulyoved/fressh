# Feature Request Target Picker Native Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom bottom-sheet target picker in `FeatureRequestModal` with the standard React Native community picker (`@react-native-picker/picker`) so the dropdown anchors under the field and matches the native Android Spinner behavior.

**Architecture:** Add the `@react-native-picker/picker` Expo-managed dependency. Rewrite `FeatureRequestModal.tsx` to render a single `<Picker>` in place of the previous `Pressable` + sibling `<Modal>`. Map the discriminated union `FeatureRequestTargetSelection` to/from string values at the Picker boundary. Delete the now-unused `FeatureRequestTargetPicker.tsx`. Pure helpers (`PINNED_FEATURE_REQUEST_REPOS`, `selectFeatureRequestRepository`, `canSubmitFeatureRequest`) and the controller (`useFeatureRequestController`) are unchanged.

**Tech Stack:** React Native (Expo, Android-only), TypeScript, `node:test` + `node:assert/strict`, pnpm workspaces (commands run from `apps/mobile`). New runtime dep: `@react-native-picker/picker`. EAS local preview build for on-device install.

**Reference spec:** `docs/superpowers/specs/2026-06-13-feature-request-target-picker-native-dropdown-design.md`.

---

## File Structure

**Create:** none.

**Delete:**
- `apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx` — replaced by inline `<Picker>` in the modal.

**Modify:**
- `apps/mobile/package.json` — `@react-native-picker/picker` added by `expo install` (Expo pins the version compatible with the SDK).
- `pnpm-lock.yaml` — locked version added automatically.
- `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx` — drop the Target `Pressable`, the sibling `<Modal>` render, the React Fragment wrapper, and the picker-state callbacks (`pickerOpen`, `openPicker`, `closePicker`, `handlePickerSelect`, `targetRowLabel`, `targetRowSlug`). Render `<Picker>` instead.
- `apps/mobile/test/integration/feature-request-target-picker.test.ts` — rewrite assertions against the new `<Picker>` wiring; drop assertions tied to the deleted picker component file.

**Unchanged:**
- `apps/mobile/src/lib/repo-feature-request.ts`
- `apps/mobile/src/lib/shell-modals.tsx`
- `apps/mobile/src/app/shell/detail.tsx`
- `apps/mobile/test/integration/repo-feature-request.test.ts`

---

## Task 1: Add `@react-native-picker/picker` dependency

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install via the Expo-managed installer**

```bash
cd apps/mobile && pnpm exec expo install @react-native-picker/picker
```

Expected: command exits 0; `@react-native-picker/picker` appears as a new `dependencies` entry in `apps/mobile/package.json`; `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Verify dependency compatibility**

```bash
cd apps/mobile && pnpm exec expo install --check
```

Expected: `Dependencies are up to date`.

- [ ] **Step 3: Verify typecheck still passes (no source changes yet)**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 4: Verify the integration suite still passes**

```bash
cd apps/mobile && pnpm test:integration
```

Expected: 839/839 pass (the suite count from the previous feature's verification; the dep-only commit should not change it).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "chore(mobile): add @react-native-picker/picker dependency"
```

---

## Task 2: Replace the custom picker with `<Picker>`

This task rewrites the modal, rewrites its source-string test file, and deletes the now-unused picker component file. The three changes are tightly coupled — committing them together keeps `git bisect` history compiling and the test suite green.

**Files:**
- Delete: `apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx`
- Modify: `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx`
- Modify: `apps/mobile/test/integration/feature-request-target-picker.test.ts`

- [ ] **Step 1: Rewrite the test file with the new failing assertions**

Replace the entire contents of `apps/mobile/test/integration/feature-request-target-picker.test.ts` with:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const modalPath = join(
	process.cwd(),
	'src/app/shell/components/FeatureRequestModal.tsx',
);

const shellModalsPath = join(process.cwd(), 'src/lib/shell-modals.tsx');

void test('FeatureRequestModal imports Picker from @react-native-picker/picker', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(
		source,
		/import \{ Picker \} from '@react-native-picker\/picker';/,
	);
});

void test('FeatureRequestModal renders a Picker bound to selection state', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(source, /<Picker/);
	assert.match(source, /selectedValue=\{pickerValue\}/);
	assert.match(source, /onValueChange=\{handlePickerChange\}/);
	assert.match(source, /enabled=\{!isSubmitting\}/);
});

void test('FeatureRequestModal emits the Current Picker.Item with the dynamic label', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(
		source,
		/<Picker\.Item label=\{currentItemLabel\} value="current" \/>/,
	);
	assert.match(source, /'Current — Resolving…'/);
	assert.match(source, /'Current — Unavailable'/);
	assert.match(source, /`Current — \$\{targetRepository\}`/);
});

void test('FeatureRequestModal maps PINNED_FEATURE_REQUEST_REPOS into Picker.Items', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(source, /PINNED_FEATURE_REQUEST_REPOS\.map\(\(entry\)/);
	assert.match(source, /value=\{entry\.repository\}/);
	assert.match(
		source,
		/label=\{`\$\{entry\.label\} — \$\{entry\.repository\}`\}/,
	);
});

void test('FeatureRequestModal owns selection state defaulting to current', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(
		source,
		/useState<FeatureRequestTargetSelection>\(\s*\{\s*kind:\s*'current',?\s*\}\s*\)/,
	);
	assert.match(source, /setSelection\(\{ kind: 'current' \}\);/);
});

void test('FeatureRequestModal derives pickerValue and handlePickerChange from selection', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(
		source,
		/const pickerValue =\s*selection\.kind === 'pinned' \? selection\.repository : 'current';/,
	);
	assert.match(
		source,
		/const handlePickerChange = useCallback\(\(value: string\) => \{/,
	);
	assert.match(source, /setSelection\(\{ kind: 'pinned', repository: value \}\);/);
});

void test('FeatureRequestModal uses canSubmitFeatureRequest and forwards repository on submit', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.match(source, /canSubmitFeatureRequest\(\{/);
	assert.match(
		source,
		/onSubmit\(description\.trim\(\), effectiveRepository\)/,
	);
});

void test('FeatureRequestModal no longer imports FeatureRequestTargetPicker', () => {
	const source = readFileSync(modalPath, 'utf8');
	assert.doesNotMatch(source, /FeatureRequestTargetPicker/);
});

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

- [ ] **Step 2: Run the test file to confirm it fails**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "FeatureRequestModal|FeatureRequestModalProps|useFeatureRequestController"
```

Expected: FAIL — several of the new assertions don't match the current modal source (Picker isn't imported yet; `pickerValue` / `handlePickerChange` don't exist; `FeatureRequestTargetPicker` is still referenced).

- [ ] **Step 3: Replace `FeatureRequestModal.tsx` with the Picker-based implementation**

Overwrite `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx` with:

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
import { Picker } from '@react-native-picker/picker';
import {
	canSubmitFeatureRequest,
	PINNED_FEATURE_REQUEST_REPOS,
	selectFeatureRequestRepository,
	type FeatureRequestTargetSelection,
} from '@/lib/repo-feature-request';
import { useTheme } from '@/lib/theme';

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

	useEffect(() => {
		if (!open) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset draft text and selection when parent closes the modal.
			setDescription('');
			setSelection({ kind: 'current' });
		}
	}, [open]);

	const handleClose = useCallback(() => {
		if (isSubmitting) return;
		const didClose = onClose();
		if (didClose === false) return;
		setDescription('');
		setSelection({ kind: 'current' });
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

	const pickerValue =
		selection.kind === 'pinned' ? selection.repository : 'current';

	const handlePickerChange = useCallback((value: string) => {
		if (value === 'current') {
			setSelection({ kind: 'current' });
		} else {
			setSelection({ kind: 'pinned', repository: value });
		}
	}, []);

	const currentItemLabel = isResolvingTarget
		? 'Current — Resolving…'
		: targetRepository
			? `Current — ${targetRepository}`
			: 'Current — Unavailable';

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
							<View
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									borderRadius: 10,
									marginBottom: 16,
									overflow: 'hidden',
								}}
							>
								<Picker
									selectedValue={pickerValue}
									onValueChange={handlePickerChange}
									enabled={!isSubmitting}
									dropdownIconColor={theme.colors.textSecondary}
									style={{ color: theme.colors.textPrimary }}
								>
									<Picker.Item label={currentItemLabel} value="current" />
									{PINNED_FEATURE_REQUEST_REPOS.map((entry) => (
										<Picker.Item
											key={entry.repository}
											label={`${entry.label} — ${entry.repository}`}
											value={entry.repository}
										/>
									))}
								</Picker>
							</View>
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
		</Modal>
	);
}
```

- [ ] **Step 4: Delete the unused custom picker file**

```bash
rm apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx
```

- [ ] **Step 5: Run the targeted tests to confirm pass**

```bash
cd apps/mobile && pnpm test:integration --test-name-pattern "FeatureRequestModal|FeatureRequestModalProps|useFeatureRequestController"
```

Expected: all 10 new assertions PASS; previously-existing modal-side assertions in the same file (now overwritten) are gone.

- [ ] **Step 6: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: exits 0. The deleted file is no longer referenced; the new `Picker` import resolves through `@react-native-picker/picker`'s shipped types.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/app/shell/components/FeatureRequestModal.tsx apps/mobile/test/integration/feature-request-target-picker.test.ts
git rm apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx
git commit -m "feat(mobile): use native Picker for feature request target"
```

---

## Task 3: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Run the entire integration test suite**

```bash
cd apps/mobile && pnpm test:integration
```

Expected: all tests pass. The replacement test file overwrites the previous nine tests (four `FeatureRequestTargetPicker` source tests, three modal-wiring tests, two controller-wiring tests) with ten new tests, so the total count moves from 839 to ~840. Exact count is not material as long as zero fail.

- [ ] **Step 2: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Confirm the call site in `detail.tsx` is unaffected**

```bash
grep -n "featureRequest.modalProps" apps/mobile/src/app/shell/detail.tsx
```

Expected: a single hit inside the `<FeatureRequestModal …>` JSX (currently at line 3404). No code changes required.

- [ ] **Step 4: Confirm the deleted file is gone**

```bash
ls apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx 2>&1 || echo "deleted: OK"
```

Expected: prints `ls: cannot access … No such file or directory` followed by `deleted: OK`.

---

## Task 4: Native rebuild and install

**Files:** none — produces an APK, no source edits.

This task produces a new local EAS preview APK and installs it on the test device. OTA is not eligible because Task 1 added a native module.

- [ ] **Step 1: Confirm the test device is reachable**

```bash
adb connect 100.113.210.6:38977 && adb devices -l
```

Expected: lists `100.113.210.6:38977` as `device` (not `unauthorized`/`offline`).

- [ ] **Step 2: Build the local EAS preview APK**

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android
```

Expected: command emits `Build successful` and prints a path to the generated APK (typically under `apps/mobile/build-*.apk` or a temp dir; the actual path is printed in the final lines of the build output). Capture the path for Step 3.

- [ ] **Step 3: Install the APK on the device**

Replace `<apk-path>` with the path printed in Step 2.

```bash
adb -s 100.113.210.6:38977 install -r <apk-path>
```

Expected: `Performing Streamed Install` followed by `Success`.

- [ ] **Step 4: Launch the app and confirm it boots**

```bash
PKG=com.finalapp.vibe2
adb -s 100.113.210.6:38977 shell am force-stop "$PKG"
adb -s 100.113.210.6:38977 shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
```

Expected: `Events injected: 1`.

- [ ] **Step 5: Quick startup log check**

```bash
PID=$(adb -s 100.113.210.6:38977 shell pidof -s com.finalapp.vibe2 | tr -d '\r')
echo "pid=$PID"
adb -s 100.113.210.6:38977 logcat -d --pid="$PID" -t 500 \
  | grep -iE "fatal|exception|crash|Fressh App Init|ErrorRecovery"
```

Expected: `Fressh App Init` appears and there are no fatal crash lines.

---

## Done criteria

- The Feature Request modal renders a native Android Spinner labelled `Target` above the Description field.
- Tapping the Spinner drops a menu anchored under the field with four entries: `Current — …`, `Cube9 — cube-9/cube9`, `Fresh — mulyoved/fressh`, `Pro Skills — mulyoved/skills`.
- Choosing one selects it and dismisses the menu; the submit pipeline still routes to the picked slug.
- The Spinner is disabled while a submit is in flight.
- Closing the modal resets the selection back to `Current` on next open.
- `apps/mobile` `typecheck` and `test:integration` both pass.
- The `FeatureRequestTargetPicker.tsx` file no longer exists in the tree.
