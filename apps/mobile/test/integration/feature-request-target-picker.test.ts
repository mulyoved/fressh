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
