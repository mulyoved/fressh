# Feature Request Target Picker — Native Dropdown Design

## Goal

Replace the custom bottom-sheet target picker in the Feature Request modal with
the standard React Native community picker (`@react-native-picker/picker`). On
Android the component renders as a native `Spinner` whose dropdown anchors
directly under the field, matching the familiar OS select behavior.

The user-facing feature does not change. The user still chooses between
`Current` (auto-resolve) and the three pinned projects defined in
`PINNED_FEATURE_REQUEST_REPOS`. Only the visual control changes.

## Scope

This spec covers only the picker control inside `FeatureRequestModal` and the
tests that pin its wiring. The pure helpers (`PINNED_FEATURE_REQUEST_REPOS`,
`FeatureRequestTargetSelection`, `selectFeatureRequestRepository`,
`canSubmitFeatureRequest`) and the controller (`useFeatureRequestController`,
`buildCreateGitHubIssueCommand`) are unchanged.

This change introduces a new native dependency. The next on-device install is a
local EAS preview APK rebuild plus `adb install`. OTA delivery is not eligible
for this change.

## Behavior

When the modal opens, the picker reflects the current selection (defaulting to
`Current`). Tapping the picker drops the native Android menu directly under it.
Tapping a row updates the selection and dismisses the menu. The Submit button
follows the existing `canSubmitFeatureRequest` rule unchanged:

- `Current` selected: Submit is disabled while resolving, while submitting,
  while description is empty, or when `targetRepository` is `null`.
- A pinned project selected: Submit is enabled when description is non-empty
  and no submission is in flight, independent of auto-resolve outcome.

While a submission is in flight, the picker is locked via the `enabled={false}`
prop so the user cannot change the target mid-submit.

Closing the modal resets the selection to `Current` in the same effect that
resets the draft description.

## UI

The modal still shows a `Target` label above the control. The control itself is
a single `<Picker>` rendered in place of the previous `Pressable`. No sibling
`Modal`, no custom row component, no chevron drawn in JSX (the native Spinner
provides its own affordance).

Picker items:

1. `Current — <subtitle>` with `value="current"`.
2. One item per pinned entry: `<label> — <repository>` with `value=<repository>`.

The `Current` item subtitle depends on resolution state:

- resolving → `Resolving…`
- resolved → the auto-resolved `owner/repo` slug
- failed → `Unavailable`

A pinned item label is fixed at module load (e.g. `Cube9 — cube-9/cube9`).

## Components

`FeatureRequestModal.tsx` gains a single import:

```ts
import { Picker } from '@react-native-picker/picker';
```

Local state shrinks. Removed:

- `pickerOpen`
- `openPicker`, `closePicker`, `handlePickerSelect`
- `targetRowLabel`, `targetRowSlug`

Kept:

- `description`
- `selection: FeatureRequestTargetSelection` defaulting to `{ kind: 'current' }`,
  still reset to default whenever the modal's `open` prop transitions to
  `false`, and on `handleClose` when `onClose()` does not veto.

New derivations:

```ts
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
```

Render:

```tsx
<Picker
  selectedValue={pickerValue}
  onValueChange={handlePickerChange}
  enabled={!isSubmitting}
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
```

Style is left to native defaults. If theming is needed later, `<Picker>`
exposes `style`, `dropdownIconColor`, and `mode="dropdown"` knobs.

## Files

Delete:

- `apps/mobile/src/app/shell/components/FeatureRequestTargetPicker.tsx`.

Modify:

- `apps/mobile/src/app/shell/components/FeatureRequestModal.tsx` — replace the
  Target `Pressable` plus the sibling `<Modal>` render and the React Fragment
  wrapper with a single `<Picker>`. Drop the picker-specific state and
  callbacks listed above.
- `apps/mobile/test/integration/feature-request-target-picker.test.ts` — keep
  the file, rewrite its assertions against the new wiring.
- `apps/mobile/package.json` — `@react-native-picker/picker` added by
  `pnpm exec expo install`.

Unchanged:

- `apps/mobile/src/lib/repo-feature-request.ts`.
- `apps/mobile/src/lib/shell-modals.tsx`.
- `apps/mobile/src/app/shell/detail.tsx`.
- `apps/mobile/test/integration/repo-feature-request.test.ts`.

## Tests

Source-string assertions in
`apps/mobile/test/integration/feature-request-target-picker.test.ts`:

- `FeatureRequestModal` imports `Picker` from `@react-native-picker/picker`.
- `FeatureRequestModal` renders `<Picker selectedValue={...} onValueChange={...}
  enabled={...}>`.
- A `Picker.Item` with `value="current"` exists.
- The modal iterates `PINNED_FEATURE_REQUEST_REPOS` to emit one
  `Picker.Item` per entry with `value={entry.repository}`.
- The modal still uses `canSubmitFeatureRequest({` and calls
  `onSubmit(description.trim(), effectiveRepository)`.
- Tests that referenced the deleted `FeatureRequestTargetPicker.tsx` component
  are removed.

Pure-helper tests in `repo-feature-request.test.ts` are untouched.

## Build and install

This change adds a native module. After implementation:

1. `cd apps/mobile && pnpm exec expo install --check` reports
   `Dependencies are up to date`.
2. `cd apps/mobile && pnpm typecheck` exits 0.
3. `cd apps/mobile && pnpm test:integration` is green.
4. `cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk
   ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1
   pnpm exec eas build --local --profile preview --platform android` produces a
   new APK.
5. `adb connect 100.113.210.6:38977 && adb -s 100.113.210.6:38977 install -r
   <apk-path>` installs the new build on the target device.
6. Launch with
   `adb -s 100.113.210.6:38977 shell monkey -p com.finalapp.vibe2 -c
   android.intent.category.LAUNCHER 1` and manually verify the dropdown
   behavior in the Feature Request modal.

OTA delivery (`eas update`) is not eligible for this change because the
dependency graph picks up a new native module.

## Out of scope

- iOS picker styling (project is Android-only).
- Theming the native Spinner beyond the defaults.
- Persisting last-used target across modal sessions.
- Changing the pinned list, the auto-resolve mechanism, or the gh issue body.
