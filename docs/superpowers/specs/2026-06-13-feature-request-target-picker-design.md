# Feature Request Target Picker Design

## Goal

Let the user redirect a feature request to one of a few pinned projects without
leaving their current shell. Today the Feature Request dialog files the issue
against whatever GitHub repository resolves from the focused tmux pane. The user
can only change the target by switching panes.

## Scope

This applies only to `FeatureRequestModal` in the mobile shell and the
`useFeatureRequestController` controller. The set of pinned targets is small,
fixed, and hardcoded in source. Editing the list requires a code change. No
device-side configuration, no remote sync.

Pinned list (order matters; order on screen matches this order):

1. Cube9 — `cube-9/cube9`
2. Fresh — `mulyoved/fressh`
3. Pro Skills — `mulyoved/skills`

The auto-resolved current project remains the default selection so existing
behavior is preserved when the user does nothing.

## Behavior

When the modal opens, the target selection defaults to "Current". The
controller's auto-resolve flow runs as before and populates the current
repository slug.

The user can tap the Target row to open a small picker overlay that lists four
choices: Current plus the three pinned projects. Selecting a row updates the
modal's local target state and closes the overlay. Selection persists only for
the lifetime of the modal session; closing the modal resets the selection back
to Current the next time it opens.

The Submit button enable rule depends on the selection:

- Current selected: existing rule. Submit is disabled while resolving, while
  submitting, while description is empty, or when the auto-resolved repository
  is `null`.
- Pinned selected: Submit is enabled when description is non-empty and no
  submission is in flight. Submit does not depend on the auto-resolve outcome.

The submit pipeline is unchanged downstream. The controller builds the same
`gh issue create` command via `buildCreateGitHubIssueCommand` and runs it via
`executeSideChannelCommand`. The only change is which repository slug feeds the
builder.

## UI

The modal replaces its current single-line `Target: <repo>` text with a
tappable Target row above the Description field.

The Target row shows:

- the selected label on the left (e.g. `Current`, `Cube9`);
- the resolved repository slug on the right (e.g. `mulyoved/skills`);
- a chevron-style affordance indicating the row is tappable.

For the Current selection, the slug area shows `Resolving…` while the
controller is resolving and `Unavailable` if the resolve failed. For pinned
selections, the slug is always the static pinned slug.

Tapping the Target row opens the picker overlay. The overlay is a sibling
`Modal`, styled to match `DetectedOpenPickerModal`: bottom-aligned sheet,
themed background, list of rows. Each row shows the label, the repository slug,
and a leading indicator for the selected row (filled vs. empty marker). Tapping
a row selects it and closes the overlay.

The overlay receives the same `bottomOffset` value the host modal already
threads through, so it floats above the Android keyboard when the description
input is focused.

## Components

A new presentational component `FeatureRequestTargetPicker.tsx` lives next to
`FeatureRequestModal.tsx`. Props:

```ts
type Selection =
  | { kind: 'current' }
  | { kind: 'pinned'; repository: string };

type FeatureRequestTargetPickerProps = {
  open: boolean;
  bottomOffset: number;
  currentRepository: string | null;
  isResolvingCurrent: boolean;
  selection: Selection;
  pinned: readonly PinnedFeatureRequestRepo[];
  onClose: () => void;
  onSelect: (selection: Selection) => void;
};
```

The component renders no state; it reflects props. Visual style matches the
existing picker family (rounded sheet, theme colors, accessibility roles).

`FeatureRequestModal.tsx` gains two pieces of local state:

- `selection: Selection` defaults to `{ kind: 'current' }`. Resets to default
  whenever the modal's `open` prop transitions to `false`, in the same effect
  that resets `description`.
- `pickerOpen: boolean` defaults to `false`. Closing the host modal also
  closes the picker overlay.

The Target row reads `selection`, `targetRepository`, and `isResolvingTarget`
to render its label and slug.

`canSubmit` becomes:

```ts
const effectiveRepository =
  selection.kind === 'pinned' ? selection.repository : targetRepository;
const canSubmit =
  description.trim().length > 0 &&
  !isSubmitting &&
  effectiveRepository != null &&
  (selection.kind === 'pinned' || !isResolvingTarget);
```

`handleSubmit` calls `onSubmit(description.trim(), effectiveRepository)` and
relies on the guard above to ensure `effectiveRepository` is non-null.

## Data

A new export in `apps/mobile/src/lib/repo-feature-request.ts`:

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
```

A module-level loop validates each entry's `repository` against
`githubRepositoryPattern` at import time and throws on mismatch, so a typo in
the list trips on first load (covered by the existing module's import path in
tests) instead of failing only on submit.

## Controller changes

`FeatureRequestModalProps.onSubmit` changes from

```ts
onSubmit: (description: string) => Promise<void>;
```

to

```ts
onSubmit: (description: string, repository: string) => Promise<void>;
```

`useFeatureRequestController.submit` accepts the explicit repository and
ignores `targetRepository` when building the command:

```ts
const submit = useCallback(
  async (description: string, repository: string) => {
    // existing in-flight guard, connection check, request-id setup
    const command = buildCreateGitHubIssueCommand({
      description,
      repository,
    });
    // existing executeSideChannelCommand flow + alert + error handling
  },
  [/* deps without targetRepository */],
);
```

The controller keeps its internal `targetRepository`, `isResolvingTarget`, and
auto-resolve effect. Those values still feed the Current row in the picker so
the user can see what would happen if they keep Current selected. They are no
longer the authoritative repository at submit time.

## Tests

Add tests at `apps/mobile/test/integration/`:

- `repo-feature-request.test.ts`
  - `PINNED_FEATURE_REQUEST_REPOS` has the expected three entries in order.
  - Every pinned `repository` matches `githubRepositoryPattern`.
- `feature-request-target-picker.test.ts` (new)
  - Picker renders four rows in the expected order (Current first).
  - Selecting a pinned row updates the selection and closes the overlay.
- `shell-modals.test.ts`
  - Submitting with a pinned selection calls the side-channel command with the
    pinned slug, not the auto-resolved slug.
  - Submitting with Current uses the auto-resolved slug.
  - Submit stays disabled when Current is selected and auto-resolve failed.
  - Submit is enabled when a pinned row is selected even if auto-resolve is
    still running or failed.

## Out of scope

- Adding, removing, or reordering pinned projects from the UI.
- Persisting last-used target across modal sessions.
- Changing the auto-resolve mechanism, GitHub authentication flow, or the
  generated issue body.
- Picking a non-pinned repository through free text entry.
- Cross-cutting refactors of the FeatureRequestModal beyond the additions
  described above.
