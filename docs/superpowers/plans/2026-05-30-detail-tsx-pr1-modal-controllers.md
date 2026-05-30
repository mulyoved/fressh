# detail.tsx PR 1 — Modal Controllers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the four modal-controller surfaces from `apps/mobile/src/app/shell/detail.tsx` (FeatureRequest, SkillSelector, BrowserActions+HostURL, and the four simple open/close modals) into a new `apps/mobile/src/lib/shell-modals.tsx`, shrinking `detail.tsx` by ~400 LOC and establishing the extraction pattern for the remaining three PRs.

**Architecture:** Four React hooks plus one small shared helper. Each hook owns its modal's state and callbacks; pure formatting/parsing logic stays in `repo-feature-request.ts` and `host-browser-actions.ts`. The coordinator (`detail.tsx`) wires hooks together by passing peer close callbacks as deps — that preserves the existing "close everything else first" ordering. A small `useRequestId()` helper folds away the repeated `++ref.current ... id === ref.current` dedupe pattern.

**Tech Stack:** React Native, TypeScript (verbatimModuleSyntax), node:test via `tsx --test` for pure-logic tests, `pnpm typecheck`/`pnpm lint`/`pnpm test:integration` as gates. No new dependencies.

---

## File Structure

**New files:**
- `apps/mobile/src/lib/shell-modals.tsx` — four hooks: `useShellSimpleModals`, `useSkillSelectorController`, `useFeatureRequestController`, `useBrowserActionsController`. ~500 LOC.
- `apps/mobile/src/lib/request-id.ts` — `useRequestId()` helper. ~25 LOC.

**Modified files:**
- `apps/mobile/src/lib/repo-feature-request.ts` — add `buildFeatureRequestSubmittedAlert`.
- `apps/mobile/test/integration/repo-feature-request.test.ts` — add cases for the new builder.
- `apps/mobile/src/app/shell/detail.tsx` — remove the extracted state/callbacks, call the new hooks, thread props.

**Not touched in PR 1:**
- Wispr automation state, timers, refs — PR 2.
- Keyboard dispatch / action context — PR 3.
- Terminal/PTY session — PR 4.

---

## Task 1: Branch setup and baseline

**Files:** none modified yet.

- [ ] **Step 1: Create the branch from latest `main`**

```bash
git checkout main
git pull
git checkout -b detail-tsx-pr1-modal-controllers
```

- [ ] **Step 2: Confirm baseline checks pass**

Run from the repo root:

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
```

Expected: all three pass cleanly. Record the test count printed by node:test (used as a regression check in later tasks).

- [ ] **Step 3: Record the current `detail.tsx` size**

```bash
wc -l apps/mobile/src/app/shell/detail.tsx
```

Expected: ~3,642 lines (within ±5). Note the number — Task 8 will compare against it (target shrink: ~400 LOC).

---

## Task 2: Pure helper — `buildFeatureRequestSubmittedAlert`

**Files:**
- Modify: `apps/mobile/src/lib/repo-feature-request.ts`
- Test: `apps/mobile/test/integration/repo-feature-request.test.ts`

The existing `handleFeatureRequestSubmit` in `detail.tsx:2088–2099` inlines this logic:

```ts
const issueUrl = result.issueUrl ?? null;
const issueNumberMatch = issueUrl?.match(/\/issues\/(\d+)$/);
const issueNumber = issueNumberMatch?.[1] ?? null;
Alert.alert(
  issueNumber ? `Issue #${issueNumber} Created` : 'Feature Request Submitted',
  issueUrl ? `Your request has been created:\n${issueUrl}` : 'Your feature request has been submitted successfully.',
  [{ text: 'OK' }],
);
```

Extract the title/body computation as a pure function so it's testable without a React Native runtime.

- [ ] **Step 1: Write failing tests**

Append to `apps/mobile/test/integration/repo-feature-request.test.ts` (keep the existing `import`s at the top; add `buildFeatureRequestSubmittedAlert` to the import list):

```ts
void test('buildFeatureRequestSubmittedAlert formats title and message when issue URL has a number', () => {
  const alert = buildFeatureRequestSubmittedAlert({
    issueUrl: 'https://github.com/mulyoved/fressh/issues/123',
  });
  assert.equal(alert.title, 'Issue #123 Created');
  assert.equal(
    alert.message,
    'Your request has been created:\nhttps://github.com/mulyoved/fressh/issues/123',
  );
});

void test('buildFeatureRequestSubmittedAlert falls back to generic title when URL has no issue number', () => {
  const alert = buildFeatureRequestSubmittedAlert({
    issueUrl: 'https://github.com/mulyoved/fressh/pulls/123',
  });
  assert.equal(alert.title, 'Feature Request Submitted');
  assert.equal(
    alert.message,
    'Your request has been created:\nhttps://github.com/mulyoved/fressh/pulls/123',
  );
});

void test('buildFeatureRequestSubmittedAlert falls back to generic message when URL is null', () => {
  const alert = buildFeatureRequestSubmittedAlert({ issueUrl: null });
  assert.equal(alert.title, 'Feature Request Submitted');
  assert.equal(
    alert.message,
    'Your feature request has been submitted successfully.',
  );
});

void test('buildFeatureRequestSubmittedAlert tolerates trailing slash on issue URL', () => {
  const alert = buildFeatureRequestSubmittedAlert({
    issueUrl: 'https://github.com/owner/repo/issues/42/',
  });
  // Regex anchors at end so a trailing slash means no issue number is extracted.
  assert.equal(alert.title, 'Feature Request Submitted');
  assert.equal(
    alert.message,
    'Your request has been created:\nhttps://github.com/owner/repo/issues/42/',
  );
});
```

- [ ] **Step 2: Run the failing tests**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/repo-feature-request.test.ts
```

Expected: fail with `buildFeatureRequestSubmittedAlert is not exported` (or equivalent import error).

- [ ] **Step 3: Add the helper**

Append to `apps/mobile/src/lib/repo-feature-request.ts`:

```ts
export function buildFeatureRequestSubmittedAlert(input: {
  issueUrl: string | null;
}): { title: string; message: string } {
  const { issueUrl } = input;
  const issueNumber = issueUrl?.match(/\/issues\/(\d+)$/)?.[1] ?? null;
  return {
    title: issueNumber
      ? `Issue #${issueNumber} Created`
      : 'Feature Request Submitted',
    message: issueUrl
      ? `Your request has been created:\n${issueUrl}`
      : 'Your feature request has been submitted successfully.',
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/repo-feature-request.test.ts
```

Expected: all four new tests pass; existing tests in the file still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add buildFeatureRequestSubmittedAlert helper

Extract the alert title/body construction (issue URL parsing + fallback
copy) from detail.tsx into a pure helper so it can be tested and reused
by the upcoming useFeatureRequestController hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useRequestId` helper

**Files:**
- Create: `apps/mobile/src/lib/request-id.ts`

The dedupe pattern repeats 5+ times in `detail.tsx`:

```ts
const someRequestIdRef = useRef(0);
const requestId = ++someRequestIdRef.current;
if (requestId !== someRequestIdRef.current) return;
```

The helper consolidates it. The hook holds only a `useRef`, so it's not worth testing in isolation; its correctness is exercised by the controller hooks that consume it.

- [ ] **Step 1: Create the file**

Write `apps/mobile/src/lib/request-id.ts`:

```ts
import { useCallback, useRef } from 'react';

export type RequestIdHandle = {
  next: () => number;
  isCurrent: (id: number) => boolean;
  invalidate: () => void;
};

export function useRequestId(): RequestIdHandle {
  const ref = useRef(0);
  const next = useCallback(() => {
    ref.current += 1;
    return ref.current;
  }, []);
  const isCurrent = useCallback((id: number) => id === ref.current, []);
  const invalidate = useCallback(() => {
    ref.current += 1;
  }, []);
  return { next, isCurrent, invalidate };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/request-id.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add useRequestId helper for async-callback dedupe

The pattern of bumping a ref counter, capturing it locally, and bailing
out if the captured value no longer matches repeats five-plus times in
detail.tsx. Consolidate it so subsequent extractions can use a named
helper instead of copying the pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `useShellSimpleModals` + wire into `detail.tsx`

**Files:**
- Create: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

Four modals (`CommandPresets`, `Commander`, `TextEntry`, `Configure`) have no controller logic — only open/close. Move the state and expose a uniform shape. `TextEntry` additionally exposes a ref because the still-in-`detail.tsx` Wispr code reads `textEntryOpenRef.current` synchronously inside callbacks (this is moved out by PR 2).

- [ ] **Step 1: Create the hook file**

Write `apps/mobile/src/lib/shell-modals.tsx`:

```tsx
import { useCallback, useRef, useState, type RefObject } from 'react';

export type SimpleModalHandle = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

export type TextEntryModalHandle = SimpleModalHandle & {
  openRef: RefObject<boolean>;
};

export type ShellSimpleModalsHandle = {
  commandPresets: SimpleModalHandle;
  commander: SimpleModalHandle;
  textEntry: TextEntryModalHandle;
  configure: SimpleModalHandle;
};

export function useShellSimpleModals(): ShellSimpleModalsHandle {
  const [commandPresetsOpen, setCommandPresetsOpen] = useState(false);
  const [commanderOpen, setCommanderOpen] = useState(false);
  const [textEntryOpen, setTextEntryOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);

  const textEntryOpenRef = useRef(false);
  // Sync ref with state so callers (Wispr handlers in detail.tsx) that read
  // it inside callbacks see the latest value without going through deps.
  textEntryOpenRef.current = textEntryOpen;

  const openCommandPresets = useCallback(() => {
    setCommandPresetsOpen(true);
  }, []);
  const closeCommandPresets = useCallback(() => {
    setCommandPresetsOpen(false);
  }, []);
  const toggleCommandPresets = useCallback(() => {
    setCommandPresetsOpen((prev) => !prev);
  }, []);

  const openCommander = useCallback(() => {
    setCommanderOpen(true);
  }, []);
  const closeCommander = useCallback(() => {
    setCommanderOpen(false);
  }, []);

  const openTextEntry = useCallback(() => {
    textEntryOpenRef.current = true;
    setTextEntryOpen(true);
  }, []);
  const closeTextEntry = useCallback(() => {
    textEntryOpenRef.current = false;
    setTextEntryOpen(false);
  }, []);

  const openConfigure = useCallback(() => {
    setConfigureOpen(true);
  }, []);
  const closeConfigure = useCallback(() => {
    setConfigureOpen(false);
  }, []);

  return {
    commandPresets: {
      open: commandPresetsOpen,
      onOpen: openCommandPresets,
      onClose: closeCommandPresets,
    },
    commander: {
      open: commanderOpen,
      onOpen: openCommander,
      onClose: closeCommander,
    },
    textEntry: {
      open: textEntryOpen,
      openRef: textEntryOpenRef,
      onOpen: openTextEntry,
      onClose: closeTextEntry,
    },
    configure: {
      open: configureOpen,
      onOpen: openConfigure,
      onClose: closeConfigure,
    },
  };
}

// `toggleCommandPresets` is used by the keyboard action context; it lives on
// the keyboard side of the API. Expose it here so the coordinator can pass it
// through.
export function buildToggleCommandPresets(
  handle: ShellSimpleModalsHandle,
): () => void {
  return () => {
    if (handle.commandPresets.open) {
      handle.commandPresets.onClose();
    } else {
      handle.commandPresets.onOpen();
    }
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: clean (file isn't imported yet, but should compile).

- [ ] **Step 3: Wire into `detail.tsx`**

In `apps/mobile/src/app/shell/detail.tsx`:

(a) Add to the existing `@/lib/*` import block (alphabetical):

```ts
import { useShellSimpleModals } from '@/lib/shell-modals';
```

(b) Delete the four `useState` declarations at the top of the component (currently lines 709, 711, 712, 736):

```ts
const [commandPresetsOpen, setCommandPresetsOpen] = useState(false);
// ... (browserActionsOpen stays — it's PR 1 but lives in the BrowserActions hook later)
const [commanderOpen, setCommanderOpen] = useState(false);
const [textEntryOpen, setTextEntryOpen] = useState(false);
// ... (skillSelectorOpen and below stay)
const [configureOpen, setConfigureOpen] = useState(false);
```

(c) Delete `const textEntryOpenRef = useRef(false);` (currently line 765) and the sync line `textEntryOpenRef.current = textEntryOpen;` (currently line 846).

(d) Right after `const writerRef = useRef<OrderedWriter | null>(null);` (or anywhere above the first reference), add:

```ts
const simpleModals = useShellSimpleModals();
const {
  commandPresets: commandPresetsModal,
  commander: commanderModal,
  textEntry: textEntryModal,
  configure: configureModal,
} = simpleModals;
```

(e) Replace every remaining reference in the body of the component:

| Old | New |
|---|---|
| `commandPresetsOpen` | `commandPresetsModal.open` |
| `setCommandPresetsOpen(true)` | `commandPresetsModal.onOpen()` |
| `setCommandPresetsOpen(false)` | `commandPresetsModal.onClose()` |
| `setCommandPresetsOpen((prev) => !prev)` | `commandPresetsModal.onOpen(); /* replaced below */` (see note) |
| `commanderOpen` | `commanderModal.open` |
| `setCommanderOpen(true)` | `commanderModal.onOpen()` |
| `setCommanderOpen(false)` | `commanderModal.onClose()` |
| `textEntryOpen` (state read) | `textEntryModal.open` |
| `textEntryOpenRef.current = false` | `textEntryModal.onClose()` (already sets ref + state) |
| `textEntryOpenRef.current = true` | `textEntryModal.onOpen()` (already sets ref + state) |
| `textEntryOpenRef.current` (read) | `textEntryModal.openRef.current` |
| `setTextEntryOpen(false)` | `textEntryModal.onClose()` |
| `setTextEntryOpen(true)` | `textEntryModal.onOpen()` |
| `configureOpen` | `configureModal.open` |
| `setConfigureOpen(true)` | `configureModal.onOpen()` |
| `setConfigureOpen(false)` | `configureModal.onClose()` |

Note on `toggleCommandPresets`: the `actionContext` memo (currently line 2750) does:

```ts
toggleCommandPresets: () => {
  invalidateHostUrlReads();
  setCommanderOpen(false);
  setBrowserActionsOpen(false);
  closeSkillSelector();
  handleCloseTextEntry();
  setCommandPresetsOpen((prev) => !prev);
},
```

Rewrite as:

```ts
toggleCommandPresets: () => {
  invalidateHostUrlReads();
  commanderModal.onClose();
  setBrowserActionsOpen(false);
  closeSkillSelector();
  handleCloseTextEntry();
  if (commandPresetsModal.open) {
    commandPresetsModal.onClose();
  } else {
    commandPresetsModal.onOpen();
  }
},
```

And add `commandPresetsModal` + `commanderModal` to the deps array (drop the ones replaced).

(f) In the JSX (currently around lines 3379–3473):

```tsx
<CommandPresetsModal
  open={commandPresetsModal.open}
  presets={shellConfig.commandMenus}
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  onClose={commandPresetsModal.onClose}
  onSelect={runCommandPreset}
/>
{/* BrowserActionsModal stays as-is for now (Task 7 replaces it) */}
<TerminalCommanderModal
  open={commanderModal.open}
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  onClose={commanderModal.onClose}
  onExecuteCommand={(value) => { /* unchanged */ }}
  onPasteText={(value) => { /* unchanged */ }}
  onSendShortcut={(sequence) => { /* unchanged */ }}
/>
{/* SkillSelectorModal stays as-is for now (Task 5 replaces it) */}
<TextEntryModal
  open={textEntryModal.open}
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  wisprMode={wisprMode}
  wisprControl={wisprControl}
  onWisprSetup={handleOpenWisprAutomationSettings}
  onWisprAutoStartChange={handleWisprAutoStartChange}
  onClose={handleCloseTextEntry}
  onPaste={handlePasteTextEntry}
  onWisprFocus={handleWisprTextEntryFocus}
  onValueChange={handleWisprTextEntryValueChange}
/>
{/* HostUrlModal stays as-is for now (Task 7 replaces it) */}
<ConfigureModal
  open={configureModal.open}
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  onClose={configureModal.onClose}
  onDevServer={handleDevServer}
  onReloadConfig={handleReloadConfig}
  onHostConfig={handleHostConfig}
  onOpenGitHubIssues={handleOpenGitHubIssues}
  onOpenShellConfigDocs={handleOpenShellConfigDocs}
  onRequestFeature={handleOpenFeatureRequest}
  configVersion={shellConfig.version}
  configUpdatedAt={shellConfig.updatedAt}
  configSource={shellConfigState.source}
  configLastLoadedAt={shellConfigState.lastLoadedAt}
  configLastError={shellConfigState.lastError}
/>
{/* FeatureRequestModal stays as-is for now (Task 6 replaces it) */}
```

- [ ] **Step 4: Run typecheck + lint**

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
```

Expected: clean. If lint complains about unused `useState` imports, leave them — they're still used by the other states that haven't moved yet.

- [ ] **Step 5: Run integration tests**

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: same count as the Task 1 baseline. No new failures.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "$(cat <<'EOF'
refactor(mobile): extract useShellSimpleModals from detail.tsx

Move open/close state for CommandPresets, Commander, TextEntry, and
Configure modals into a single hook in apps/mobile/src/lib/shell-modals.tsx.
TextEntry exposes an openRef so the Wispr handlers (still in detail.tsx
until PR 2) can keep their synchronous reads.

Part of detail.tsx PR 1 (modal controllers). No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `useSkillSelectorController` + wire into `detail.tsx`

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

The current `detail.tsx` blocks involved: lines 713–730 (state), 2340–2345 (source-key memo), 2347–2401 (`loadSkillSelectorSkills`), 2403–2434 (`handleOpenSkillSelector`, `handleSelectSkill`), 2437–2457 (`useLayoutEffect` that resets on source-key change), 2459–2472 (unmount cleanup), 3419–3428 (JSX).

The hook owns: skill list state, request-ID dedupe (via `useRequestId`), source-key tracking, modal open/close, the source-key-change effect, the unmount cleanup. The coordinator passes: `connection`, `tmuxEnabled`, `tmuxTarget`, `runHostBrowserCommand`, `resolveHostBrowserPanePath`, `sendTextRaw`, a `closeOtherModals` callback, source-key inputs.

- [ ] **Step 1: Append to `shell-modals.tsx`**

Add (after the existing exports):

```tsx
import {
  parseSkillDiscoveryOutput,
  buildSkillDiscoveryCommand,
  type DiscoveredSkill,
} from './skill-discovery';
import { useRequestId } from './request-id';
// ... plus useEffect, useLayoutEffect, useMemo from 'react' — merge into the existing import.

export type SkillSelectorModalProps = {
  open: boolean;
  skills: DiscoveredSkill[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onSelect: (skill: DiscoveredSkill) => void;
};

export type SkillSelectorControllerHandle = {
  modalProps: SkillSelectorModalProps;
  open: () => void;
  close: () => void;
};

export type SkillSelectorControllerDeps = {
  connection: { /* match SshConnection structure — see import below */ } | null;
  tmuxEnabled: boolean;
  runHostBrowserCommand: (command: string, timeoutMs?: number) => Promise<string>;
  resolveHostBrowserPanePath: () => Promise<string>;
  sendTextRaw: (text: string) => void;
  sourceKey: string;
  getErrorMessage: (error: unknown) => string;
  closeOtherModals: () => boolean;
};
```

Then the hook body. To avoid pulling SshConnection's full type into shell-modals, accept `connection` as `unknown`-shaped (a presence check is all we use). Use a generic:

```tsx
export function useSkillSelectorController<TConnection>(deps: {
  connection: TConnection | null;
  tmuxEnabled: boolean;
  runHostBrowserCommand: (command: string, timeoutMs?: number) => Promise<string>;
  resolveHostBrowserPanePath: () => Promise<string>;
  sendTextRaw: (text: string) => void;
  sourceKey: string;
  getErrorMessage: (error: unknown) => string;
  closeOtherModals: () => boolean;
}): SkillSelectorControllerHandle {
  const {
    connection,
    tmuxEnabled,
    runHostBrowserCommand,
    resolveHostBrowserPanePath,
    sendTextRaw,
    sourceKey,
    getErrorMessage,
    closeOtherModals,
  } = deps;

  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRequestId();
  const activeSourceKeyRef = useRef<string | null>(null);
  const lastSourceKeyRef = useRef(sourceKey);
  const currentSourceKeyRef = useRef(sourceKey);
  currentSourceKeyRef.current = sourceKey;

  const visible =
    open && activeSourceKeyRef.current === sourceKey;

  const close = useCallback(() => {
    requestId.invalidate();
    activeSourceKeyRef.current = null;
    setOpen(false);
    setIsLoading(false);
    setError(null);
    setSkills([]);
  }, [requestId]);

  const load = useCallback(async () => {
    const requestSourceKey = currentSourceKeyRef.current;
    const id = requestId.next();
    activeSourceKeyRef.current = requestSourceKey;
    setIsLoading(true);
    setError(null);
    setSkills([]);

    try {
      if (!connection) {
        throw new Error('No SSH connection available.');
      }
      if (!tmuxEnabled) {
        throw new Error('Skill selector requires a tmux-enabled connection.');
      }
      const panePath = await resolveHostBrowserPanePath();
      if (currentSourceKeyRef.current !== requestSourceKey) return;
      const output = await runHostBrowserCommand(
        buildSkillDiscoveryCommand(panePath),
        10_000,
      );
      const parsed = parseSkillDiscoveryOutput(output);
      if (
        requestId.isCurrent(id) &&
        activeSourceKeyRef.current === requestSourceKey &&
        currentSourceKeyRef.current === requestSourceKey
      ) {
        setSkills(parsed);
      }
    } catch (err) {
      if (
        requestId.isCurrent(id) &&
        activeSourceKeyRef.current === requestSourceKey &&
        currentSourceKeyRef.current === requestSourceKey
      ) {
        setError(getErrorMessage(err));
      }
    } finally {
      if (
        requestId.isCurrent(id) &&
        activeSourceKeyRef.current === requestSourceKey &&
        currentSourceKeyRef.current === requestSourceKey
      ) {
        setIsLoading(false);
      }
    }
  }, [
    connection,
    getErrorMessage,
    requestId,
    resolveHostBrowserPanePath,
    runHostBrowserCommand,
    tmuxEnabled,
  ]);

  const openController = useCallback(() => {
    if (!closeOtherModals()) return;
    setOpen(true);
    void load();
  }, [closeOtherModals, load]);

  const handleSelect = useCallback(
    (skill: DiscoveredSkill) => {
      if (
        activeSourceKeyRef.current !== currentSourceKeyRef.current
      ) {
        close();
        return;
      }
      sendTextRaw(`$${skill.name} `);
      close();
    },
    [close, sendTextRaw],
  );

  // When the source-key changes (different connection / channel / tmux target),
  // any in-flight skill load belongs to a stale source — close the modal.
  useLayoutEffect(() => {
    if (lastSourceKeyRef.current === sourceKey) return;
    lastSourceKeyRef.current = sourceKey;
    if (open) {
      close();
    }
  }, [close, open, sourceKey]);

  // Unmount: invalidate any in-flight request so late callbacks become no-ops.
  useEffect(() => {
    return () => {
      requestId.invalidate();
    };
  }, [requestId]);

  return {
    modalProps: {
      open: visible,
      skills,
      isLoading,
      error,
      onClose: close,
      onRetry: load,
      onSelect: handleSelect,
    },
    open: openController,
    close,
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: clean. Fix any missing imports inside `shell-modals.tsx` (the React imports `useEffect`, `useLayoutEffect`, `useMemo` if needed).

- [ ] **Step 3: Wire into `detail.tsx`**

(a) Replace the import line added in Task 4 with:

```ts
import {
  useShellSimpleModals,
  useSkillSelectorController,
} from '@/lib/shell-modals';
```

(b) Remove the `useState` declarations (currently lines 713–720): `skillSelectorOpen`, `skillSelectorSkills`, `skillSelectorLoading`, `skillSelectorError`.

(c) Remove `skillSelectorRequestIdRef` (line 721), `skillSelectorActiveSourceKeyRef` (line 722), and the `closeSkillSelector` callback (lines 723–730).

(d) Remove the `skillSelectorSourceKeyRef` / `skillSelectorCurrentSourceKeyRef` declarations and the `skillSelectorVisible` memo (currently lines 2338–2345).

(e) Remove `loadSkillSelectorSkills`, `handleOpenSkillSelector`, `handleCloseSkillSelector`, `handleSelectSkill` (currently lines 2347–2434).

(f) Remove the `useLayoutEffect` that resets on source-key change (lines 2437–2457).

(g) From the unmount cleanup `useEffect` (lines 2459–2472), remove `skillSelectorRequestIdRef.current += 1;` (other cleanups stay for now — they'll move in Task 6 and 7).

(h) Right after the `simpleModals` declaration from Task 4 (and right before `handleOpenFeatureRequest` would have been — but we'll move that in Task 6), insert:

```ts
const activeTmuxSessionName = tmuxTarget.trim() || 'main';
const skillSelectorSourceKey = `${connectionId}:${connectionStoredConnectionId ?? ''}:${channelId}:${tmuxEnabled ? 'tmux' : 'plain'}:${activeTmuxSessionName}`;

const skillSelector = useSkillSelectorController({
  connection,
  tmuxEnabled,
  runHostBrowserCommand,
  resolveHostBrowserPanePath,
  sendTextRaw,
  sourceKey: skillSelectorSourceKey,
  getErrorMessage,
  closeOtherModals: useCallback(() => {
    commandPresetsModal.onClose();
    setBrowserActionsOpen(false);
    commanderModal.onClose();
    configureModal.onClose();
    if (!closeFeatureRequest()) return false;
    resetHostUrlModal();
    handleCloseTextEntry();
    return true;
  }, [
    closeFeatureRequest,
    commandPresetsModal,
    commanderModal,
    configureModal,
    handleCloseTextEntry,
    resetHostUrlModal,
  ]),
});
```

Note: `runHostBrowserCommand` and `resolveHostBrowserPanePath` still live in `detail.tsx` until Task 7. `closeFeatureRequest` and `resetHostUrlModal` still live in `detail.tsx` until Tasks 6 and 7. That's intentional — the wiring transitions as later tasks move state out.

(i) Update `actionContext` (line 2766) — replace `openSkillSelector: handleOpenSkillSelector` with `openSkillSelector: skillSelector.open`. Update the deps array: drop `handleOpenSkillSelector`, add `skillSelector.open`.

(j) Replace remaining references in callbacks that close peers:

| Old | New |
|---|---|
| `closeSkillSelector()` | `skillSelector.close()` |
| `setSkillSelectorOpen(false)` | `skillSelector.close()` |
| `setSkillSelectorOpen(true)` | (not used outside the hook) |
| `skillSelectorVisible` (in JSX) | `skillSelector.modalProps.open` |
| `skillSelectorSkills` | `skillSelector.modalProps.skills` |
| `skillSelectorLoading` | `skillSelector.modalProps.isLoading` |
| `skillSelectorError` | `skillSelector.modalProps.error` |
| `loadSkillSelectorSkills` (in onRetry) | `skillSelector.modalProps.onRetry` |
| `handleCloseSkillSelector` (in onClose) | `skillSelector.modalProps.onClose` |
| `handleSelectSkill` (in onSelect) | `skillSelector.modalProps.onSelect` |

(k) Replace the JSX block (currently lines 3419–3428):

```tsx
<SkillSelectorModal
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  {...skillSelector.modalProps}
/>
```

- [ ] **Step 4: Run gates**

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
```

Expected: all clean; test count unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "$(cat <<'EOF'
refactor(mobile): extract useSkillSelectorController from detail.tsx

Move the skill-selector state, request-ID dedupe, source-key tracking,
and the source-key-change reset effect into a hook in shell-modals.tsx.
The coordinator passes a closeOtherModals callback so the existing
"close everything else before opening" ordering is preserved.

Part of detail.tsx PR 1 (modal controllers). No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `useFeatureRequestController` + wire into `detail.tsx`

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

Current `detail.tsx` blocks: lines 737–746 (state), 791–832 (refs + reset helpers + `closeFeatureRequest`), 2287–2300 (`resolveCurrentGitHubRepository`), 2302–2336 (`handleOpenFeatureRequest`), 2042–2128 (`handleFeatureRequestSubmit`), 3474–3483 (JSX).

The Hook owns: open/submitting/target/resolving/error state, two request IDs (resolve + submit), the in-flight + stale flags, reset/close helpers, open + submit handlers. It uses the new `buildFeatureRequestSubmittedAlert`. It does NOT own `resolveCurrentGitHubRepository` itself — that depends on `runHostBrowserCommand` + `resolveHostBrowserPanePath` which both still live in detail.tsx (they move in Task 7). Pass `resolveCurrentGitHubRepository` in as a dep.

- [ ] **Step 1: Append to `shell-modals.tsx`**

Add the imports near the top (merge with the existing import block):

```ts
import { Alert } from 'react-native';
import {
  buildCreateGitHubIssueCommand,
  buildFeatureRequestSubmittedAlert,
} from './repo-feature-request';
```

Add the hook:

```tsx
export type FeatureRequestModalProps = {
  open: boolean;
  isSubmitting: boolean;
  targetRepository: string | null;
  isResolvingTarget: boolean;
  error: string | undefined;
  onClose: () => boolean;
  onSubmit: (description: string) => Promise<void>;
};

export type FeatureRequestControllerHandle = {
  modalProps: FeatureRequestModalProps;
  open: () => void;
  close: () => boolean;
  markSourceStale: () => void;
};

export type FeatureRequestControllerDeps<TConnection> = {
  connection: TConnection | null;
  resolveCurrentGitHubRepository: () => Promise<string>;
  executeSideChannelCommand: (
    connection: TConnection,
    command: string,
    timeoutMs: number,
  ) => Promise<{
    success: boolean;
    output: string;
    error?: string;
    issueUrl?: string;
  }>;
  getErrorMessage: (error: unknown) => string;
  logger: {
    info: (message: string, payload?: unknown) => void;
    error: (message: string, payload?: unknown) => void;
  };
  closeOtherModals: () => void;
};

export function useFeatureRequestController<TConnection>(
  deps: FeatureRequestControllerDeps<TConnection>,
): FeatureRequestControllerHandle {
  const {
    connection,
    resolveCurrentGitHubRepository,
    executeSideChannelCommand,
    getErrorMessage,
    logger,
    closeOtherModals,
  } = deps;

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [targetRepository, setTargetRepository] = useState<string | null>(null);
  const [isResolvingTarget, setIsResolvingTarget] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const resolveRequestId = useRequestId();
  const submitRequestId = useRequestId();
  const submitInFlightRef = useRef(false);
  const sourceStaleRef = useRef(false);

  const reset = useCallback(() => {
    setOpen(false);
    setIsSubmitting(false);
    setIsResolvingTarget(false);
    setTargetRepository(null);
    setError(undefined);
  }, []);

  const cancelRequests = useCallback(() => {
    resolveRequestId.invalidate();
    submitRequestId.invalidate();
  }, [resolveRequestId, submitRequestId]);

  const close = useCallback((): boolean => {
    if (submitInFlightRef.current || isSubmitting) {
      return false;
    }
    cancelRequests();
    sourceStaleRef.current = false;
    reset();
    return true;
  }, [cancelRequests, isSubmitting, reset]);

  const openController = useCallback(() => {
    if (isSubmitting) return;
    const id = resolveRequestId.next();
    submitRequestId.invalidate();
    closeOtherModals();
    reset();
    setOpen(true);

    void (async () => {
      setIsResolvingTarget(true);
      try {
        const repository = await resolveCurrentGitHubRepository();
        if (!resolveRequestId.isCurrent(id)) return;
        setTargetRepository(repository);
        setError(undefined);
      } catch (err) {
        if (!resolveRequestId.isCurrent(id)) return;
        setTargetRepository(null);
        setError(getErrorMessage(err));
      } finally {
        if (resolveRequestId.isCurrent(id)) {
          setIsResolvingTarget(false);
        }
      }
    })();
  }, [
    closeOtherModals,
    getErrorMessage,
    isSubmitting,
    reset,
    resolveCurrentGitHubRepository,
    resolveRequestId,
    submitRequestId,
  ]);

  const submit = useCallback(
    async (description: string) => {
      if (submitInFlightRef.current) return;
      const id = submitRequestId.next();
      if (!connection) {
        setError('No SSH connection available');
        return;
      }
      if (!targetRepository) {
        setError('Could not resolve GitHub repository for current window.');
        return;
      }

      submitInFlightRef.current = true;
      sourceStaleRef.current = false;
      setIsSubmitting(true);
      setError(undefined);

      const command = buildCreateGitHubIssueCommand({
        description,
        repository: targetRepository,
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
      targetRepository,
    ],
  );

  const markSourceStale = useCallback(() => {
    if (submitInFlightRef.current) {
      sourceStaleRef.current = true;
    } else {
      close();
    }
  }, [close]);

  // Unmount: invalidate everything so any in-flight side-channel call's
  // late completion becomes a no-op.
  useEffect(() => {
    return () => {
      cancelRequests();
      submitInFlightRef.current = false;
      sourceStaleRef.current = false;
    };
  }, [cancelRequests]);

  return {
    modalProps: {
      open,
      isSubmitting,
      targetRepository,
      isResolvingTarget,
      error,
      onClose: close,
      onSubmit: submit,
    },
    open: openController,
    close,
    markSourceStale,
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: clean.

- [ ] **Step 3: Wire into `detail.tsx`**

(a) Extend the import:

```ts
import {
  useFeatureRequestController,
  useShellSimpleModals,
  useSkillSelectorController,
} from '@/lib/shell-modals';
```

(b) Remove the state declarations (currently lines 737–746): `featureRequestOpen`, `featureRequestSubmitting`, `featureRequestTargetRepository`, `featureRequestResolvingTarget`, `featureRequestError`.

(c) Remove the refs and helpers (currently lines 791–832): `featureRequestResolveRequestIdRef`, `featureRequestSubmitRequestIdRef`, `featureRequestSubmitInFlightRef`, `featureRequestSourceStaleRef`, `cancelFeatureRequestRequests`, `resetFeatureRequestState`, `closeFeatureRequest`.

(d) Remove the unused `Alert` from the imports of `handleFeatureRequestSubmit` is now moved out — but `Alert` is still used elsewhere in detail.tsx (e.g. `showHostBrowserError` line 2131). Keep the `Alert` import.

(e) Remove `handleFeatureRequestSubmit` (lines 2042–2128).

(f) Remove `handleOpenFeatureRequest` (lines 2302–2336).

(g) Keep `resolveCurrentGitHubRepository` (lines 2287–2300) for now — it's needed both by the feature-request controller and by `handleOpenGitHubTarget`, both of which currently live in `detail.tsx`. It moves out fully in Task 7.

(h) In the unmount cleanup `useEffect` (now around line 2459 after Task 5's edits), remove feature-request lines:

```ts
cancelFeatureRequestRequests();
featureRequestSubmitInFlightRef.current = false;
featureRequestSourceStaleRef.current = false;
```

(i) In the `useLayoutEffect` for source-key changes (was removed in Task 5; check that any feature-request handling moved over). The original effect (lines 2437–2457) had:

```ts
if (featureRequestSubmitInFlightRef.current) {
  featureRequestSourceStaleRef.current = true;
} else {
  closeFeatureRequest();
}
```

This logic must be preserved by calling `featureRequest.markSourceStale()` from an effect in `detail.tsx`. After Task 5 there's no longer a source-key effect in detail.tsx, so add one back:

```ts
const lastSkillSelectorSourceKeyRef = useRef(skillSelectorSourceKey);
useLayoutEffect(() => {
  if (lastSkillSelectorSourceKeyRef.current === skillSelectorSourceKey) return;
  lastSkillSelectorSourceKeyRef.current = skillSelectorSourceKey;
  resetHostUrlModal();
  hostDiffityRequestIdRef.current += 1;
  browserGitHubTargetRequestIdRef.current += 1;
  featureRequest.markSourceStale();
  // skill selector handles its own source-key reset internally.
}, [
  featureRequest,
  resetHostUrlModal,
  skillSelectorSourceKey,
]);
```

(The host-URL and GitHub-target refs still live in detail.tsx until Task 7.)

(j) Insert the controller after the `skillSelector` declaration from Task 5:

```ts
const featureRequest = useFeatureRequestController({
  connection,
  resolveCurrentGitHubRepository,
  executeSideChannelCommand,
  getErrorMessage,
  logger,
  closeOtherModals: useCallback(() => {
    invalidateHostUrlReads();
    skillSelector.close();
    setBrowserActionsOpen(false);
    configureModal.onClose();
  }, [
    configureModal,
    invalidateHostUrlReads,
    skillSelector,
  ]),
});
```

(k) Update the `useSkillSelectorController` `closeOtherModals` callback (added in Task 5) — replace `closeFeatureRequest()` with `featureRequest.close()`:

```ts
closeOtherModals: useCallback(() => {
  commandPresetsModal.onClose();
  setBrowserActionsOpen(false);
  commanderModal.onClose();
  configureModal.onClose();
  if (!featureRequest.close()) return false;
  resetHostUrlModal();
  handleCloseTextEntry();
  return true;
}, [
  commandPresetsModal,
  commanderModal,
  configureModal,
  featureRequest,
  handleCloseTextEntry,
  resetHostUrlModal,
]),
```

Note: This introduces a forward reference from `skillSelector`'s deps to `featureRequest`, which is declared later. React handles this fine because the callback runs at event time, but the `useCallback` itself must declare `featureRequest` after it's defined. Re-order so `featureRequest` is declared first, then `skillSelector` (its `closeOtherModals` can reference `featureRequest`). Update the `featureRequest.closeOtherModals` to call `skillSelector.close()` — but that creates a cycle. Resolve by:

- Declare `featureRequest` first with a placeholder `closeOtherModals` that DOESN'T close skill selector (we'll add it back via a layout effect or by re-binding deps below).
- Declare `skillSelector` with `closeOtherModals` calling `featureRequest.close()`.
- After both declarations, the `actionContext` and JSX wire them up.

Simpler resolution: use refs for the cross-references. Add:

```ts
const skillSelectorCloseRef = useRef<() => void>(() => {});
const featureRequestCloseRef = useRef<() => boolean>(() => true);

const featureRequest = useFeatureRequestController({
  connection,
  resolveCurrentGitHubRepository,
  executeSideChannelCommand,
  getErrorMessage,
  logger,
  closeOtherModals: useCallback(() => {
    invalidateHostUrlReads();
    skillSelectorCloseRef.current();
    setBrowserActionsOpen(false);
    configureModal.onClose();
  }, [configureModal, invalidateHostUrlReads]),
});

const skillSelector = useSkillSelectorController({
  // ... other deps ...
  closeOtherModals: useCallback(() => {
    commandPresetsModal.onClose();
    setBrowserActionsOpen(false);
    commanderModal.onClose();
    configureModal.onClose();
    if (!featureRequestCloseRef.current()) return false;
    resetHostUrlModal();
    handleCloseTextEntry();
    return true;
  }, [
    commandPresetsModal,
    commanderModal,
    configureModal,
    handleCloseTextEntry,
    resetHostUrlModal,
  ]),
});

skillSelectorCloseRef.current = skillSelector.close;
featureRequestCloseRef.current = featureRequest.close;
```

The two ref-assignment lines run on every render, which is fine — they just keep the refs pointing to the current callback identity.

(l) Update `actionContext` (still around line 2766): replace `openRepoFeatureRequest: handleOpenFeatureRequest` with `openRepoFeatureRequest: featureRequest.open`. Update the deps array.

(m) Replace remaining `Configure` modal handler:

```tsx
onRequestFeature={featureRequest.open}
```

(n) Replace the `FeatureRequestModal` JSX:

```tsx
<FeatureRequestModal
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  {...featureRequest.modalProps}
/>
```

- [ ] **Step 4: Run gates**

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
```

Expected: clean. Test count unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "$(cat <<'EOF'
refactor(mobile): extract useFeatureRequestController from detail.tsx

Move the feature-request flow (open + resolve repository + submit via
side-channel) into a hook in shell-modals.tsx. Uses the new
buildFeatureRequestSubmittedAlert helper for the success-alert copy.
Cross-hook coordination with skill selector goes through ref-bound
close callbacks to avoid declaration cycles.

Part of detail.tsx PR 1 (modal controllers). No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `useBrowserActionsController` + wire into `detail.tsx`

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

Current `detail.tsx` blocks: lines 710 (`browserActionsOpen` state), 747–753 (`hostUrlModalState` + submitting/error), 788–812 (host-URL refs + helpers), 2130–2152 (`showHostBrowserError`, `runHostBrowserCommand`), 2263–2300 (`resolveHostBrowserPanePath`, `resolveCurrentGitHubRepository`), 2474–2482 (`openAndroidUrl`), 2484–2504 (`handleOpenBrowserActions`, `handleCloseBrowserActions`), 2506–2538 (GitHub targets), 2540–2571 (`handleOpenHostDiffity`), 2573–2665 (`handleOpenHostUrlSlot`, `handleEditHostUrlSlot`), 2667–2720 (host URL submit/close), 2722–2737 (`handleCycleWorkmuxStatus`), 3388–3397, 3441–3455 (JSX).

This is the biggest extraction. The hook owns everything browser-related plus the host URL modal. It depends on: `connection`, `tmuxEnabled`, `tmuxTarget`, plus the same shared helpers.

- [ ] **Step 1: Append to `shell-modals.tsx`**

Add the imports (merge with existing):

```ts
import { Linking } from 'react-native';
import {
  buildDiffityShareCommand,
  buildHostBrowserPanePathCommand,
  buildHostBrowserStatusCycleCommand,
  buildTmuxWindowConfigGetCommand,
  buildTmuxWindowConfigSetCommand,
  extractLastHttpsUrl,
  getHostBrowserUrlSlotLabel,
  parseHostBrowserUrlInput,
  type HostBrowserUrlSlot,
} from './host-browser-actions';
import {
  buildResolveGitHubRepositoryCommand,
  buildGitHubRepositoryTargetUrl,
  parseGitHubRepositoryResolutionOutput,
  type GitHubRepositoryTarget,
} from './repo-feature-request';
```

Add types and the hook:

```tsx
export type HostUrlModalMode = 'edit' | 'open-missing';

export type HostUrlModalStateValue = {
  mode: HostUrlModalMode;
  slot: HostBrowserUrlSlot;
  panePath: string;
  initialValue: string;
};

export type BrowserActionsModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenDiff: () => void;
  onOpenGitHubIssues: () => void;
  onOpenGitHubPulls: () => void;
  onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
  onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
};

export type HostUrlModalProps = {
  open: boolean;
  slot: HostBrowserUrlSlot | null;
  slotLabel: string;
  initialValue: string;
  mode: HostUrlModalMode;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
};

export type BrowserActionsControllerHandle = {
  browserActionsProps: BrowserActionsModalProps;
  hostUrlProps: HostUrlModalProps;
  open: () => void;
  close: () => void;
  /** Imperative side-channel helpers exposed for hooks that don't own them. */
  resolveHostBrowserPanePath: () => Promise<string>;
  resolveCurrentGitHubRepository: () => Promise<string>;
  runHostBrowserCommand: (command: string, timeoutMs?: number) => Promise<string>;
  invalidateHostUrlReads: () => void;
  cycleWorkmuxStatus: () => void;
};

export type BrowserActionsControllerDeps<TConnection> = {
  connection: TConnection | null;
  tmuxEnabled: boolean;
  tmuxTarget: string;
  executeSideChannelCommand: (
    connection: TConnection,
    command: string,
    timeoutMs: number,
  ) => Promise<{ success: boolean; output: string; error?: string }>;
  getErrorMessage: (error: unknown) => string;
  closeOtherModals: () => boolean;
};

export function useBrowserActionsController<TConnection>(
  deps: BrowserActionsControllerDeps<TConnection>,
): BrowserActionsControllerHandle {
  const {
    connection,
    tmuxEnabled,
    tmuxTarget,
    executeSideChannelCommand,
    getErrorMessage,
    closeOtherModals,
  } = deps;

  const [open, setOpen] = useState(false);
  const [hostUrlModalState, setHostUrlModalState] =
    useState<HostUrlModalStateValue | null>(null);
  const [hostUrlModalSubmitting, setHostUrlModalSubmitting] = useState(false);
  const [hostUrlModalError, setHostUrlModalError] = useState<string | null>(null);

  const hostUrlReadRequestId = useRequestId();
  const hostUrlSubmitRequestId = useRequestId();
  const hostUrlSubmitInFlightRef = useRef(false);
  const browserGitHubTargetRequestId = useRequestId();
  const hostDiffityRequestId = useRequestId();
  const hostDiffityInFlightRef = useRef(false);

  const showError = useCallback((title: string, message: string) => {
    Alert.alert(title, message);
  }, []);

  const runHostBrowserCommand = useCallback(
    async (command: string, timeoutMs = 30_000) => {
      if (!connection) {
        throw new Error('No SSH connection available.');
      }
      const result = await executeSideChannelCommand(
        connection,
        command,
        timeoutMs,
      );
      if (!result.success) {
        throw new Error(
          result.error || result.output || 'Remote command failed.',
        );
      }
      return result.output.trim();
    },
    [connection, executeSideChannelCommand],
  );

  const resolveHostBrowserPanePath = useCallback(async () => {
    if (!tmuxEnabled) {
      throw new Error(
        'Host browser actions require a tmux-enabled connection.',
      );
    }
    const sessionName = tmuxTarget.trim() || 'main';
    const output = await runHostBrowserCommand(
      buildHostBrowserPanePathCommand(sessionName),
      10_000,
    );
    const panePath = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!panePath) {
      throw new Error(
        `Could not resolve pane path for tmux session ${sessionName}.`,
      );
    }
    return panePath;
  }, [runHostBrowserCommand, tmuxEnabled, tmuxTarget]);

  const resolveCurrentGitHubRepository = useCallback(async () => {
    const panePath = await resolveHostBrowserPanePath();
    const output = await runHostBrowserCommand(
      buildResolveGitHubRepositoryCommand(panePath),
      10_000,
    );
    const repository = parseGitHubRepositoryResolutionOutput(output);
    if (!repository) {
      throw new Error(
        'Could not resolve GitHub repository for current window.',
      );
    }
    return repository;
  }, [resolveHostBrowserPanePath, runHostBrowserCommand]);

  const openAndroidUrl = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      throw new Error(
        `Android could not open ${url}: ${getErrorMessage(error)}`,
      );
    }
  }, [getErrorMessage]);

  const invalidateHostUrlReads = useCallback(() => {
    hostUrlReadRequestId.invalidate();
  }, [hostUrlReadRequestId]);

  const resetHostUrlModal = useCallback(() => {
    hostUrlReadRequestId.invalidate();
    hostUrlSubmitRequestId.invalidate();
    hostUrlSubmitInFlightRef.current = false;
    setHostUrlModalState(null);
    setHostUrlModalSubmitting(false);
    setHostUrlModalError(null);
  }, [hostUrlReadRequestId, hostUrlSubmitRequestId]);

  const openController = useCallback(() => {
    invalidateHostUrlReads();
    if (!closeOtherModals()) return;
    resetHostUrlModal();
    setOpen(true);
  }, [closeOtherModals, invalidateHostUrlReads, resetHostUrlModal]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const handleOpenGitHubTarget = useCallback(
    (target: GitHubRepositoryTarget) => {
      const id = browserGitHubTargetRequestId.next();
      const title =
        target === 'issues'
          ? 'GitHub Issues failed'
          : 'GitHub Pull Requests failed';
      void (async () => {
        try {
          const repository = await resolveCurrentGitHubRepository();
          if (!browserGitHubTargetRequestId.isCurrent(id)) return;
          const url = buildGitHubRepositoryTargetUrl(repository, target);
          await openAndroidUrl(url);
        } catch (err) {
          if (!browserGitHubTargetRequestId.isCurrent(id)) return;
          showError(title, getErrorMessage(err));
        }
      })();
    },
    [
      browserGitHubTargetRequestId,
      getErrorMessage,
      openAndroidUrl,
      resolveCurrentGitHubRepository,
      showError,
    ],
  );

  const handleOpenGitHubIssuesTarget = useCallback(
    () => handleOpenGitHubTarget('issues'),
    [handleOpenGitHubTarget],
  );
  const handleOpenGitHubPullsTarget = useCallback(
    () => handleOpenGitHubTarget('pulls'),
    [handleOpenGitHubTarget],
  );

  const handleOpenHostDiffity = useCallback(() => {
    if (hostDiffityInFlightRef.current) return;
    const id = hostDiffityRequestId.next();
    hostDiffityInFlightRef.current = true;
    void (async () => {
      try {
        const panePath = await resolveHostBrowserPanePath();
        const output = await runHostBrowserCommand(
          buildDiffityShareCommand(panePath),
          60_000,
        );
        const url = extractLastHttpsUrl(output);
        if (!url) {
          throw new Error(
            output || 'mdev diffity share did not return an HTTPS URL.',
          );
        }
        if (!hostDiffityRequestId.isCurrent(id)) return;
        await openAndroidUrl(url);
      } catch (err) {
        if (!hostDiffityRequestId.isCurrent(id)) return;
        showError('Diffity failed', getErrorMessage(err));
      } finally {
        hostDiffityInFlightRef.current = false;
      }
    })();
  }, [
    getErrorMessage,
    hostDiffityRequestId,
    openAndroidUrl,
    resolveHostBrowserPanePath,
    runHostBrowserCommand,
    showError,
  ]);

  const handleOpenHostUrlSlot = useCallback(
    (slot: HostBrowserUrlSlot) => {
      setOpen(false);
      const id = hostUrlReadRequestId.next();
      void (async () => {
        try {
          const panePath = await resolveHostBrowserPanePath();
          if (!hostUrlReadRequestId.isCurrent(id)) return;
          const value = await runHostBrowserCommand(
            buildTmuxWindowConfigGetCommand(slot, panePath),
            10_000,
          );
          if (!hostUrlReadRequestId.isCurrent(id)) return;
          const savedUrl = value.trim();
          if (savedUrl) {
            const parsed = parseHostBrowserUrlInput(savedUrl);
            if (parsed.type === 'invalid') {
              setHostUrlModalState({
                mode: 'edit',
                slot,
                panePath,
                initialValue: savedUrl,
              });
              setHostUrlModalError(parsed.message);
              return;
            }
            if (parsed.type === 'empty') return;
            await openAndroidUrl(parsed.url);
            return;
          }
          setHostUrlModalError(null);
          setHostUrlModalState({
            mode: 'open-missing',
            slot,
            panePath,
            initialValue: '',
          });
        } catch (err) {
          if (!hostUrlReadRequestId.isCurrent(id)) return;
          showError(
            `${getHostBrowserUrlSlotLabel(slot)} failed`,
            getErrorMessage(err),
          );
        }
      })();
    },
    [
      getErrorMessage,
      hostUrlReadRequestId,
      openAndroidUrl,
      resolveHostBrowserPanePath,
      runHostBrowserCommand,
      showError,
    ],
  );

  const handleEditHostUrlSlot = useCallback(
    (slot: HostBrowserUrlSlot) => {
      setOpen(false);
      const id = hostUrlReadRequestId.next();
      void (async () => {
        try {
          const panePath = await resolveHostBrowserPanePath();
          if (!hostUrlReadRequestId.isCurrent(id)) return;
          const value = await runHostBrowserCommand(
            buildTmuxWindowConfigGetCommand(slot, panePath),
            10_000,
          );
          if (!hostUrlReadRequestId.isCurrent(id)) return;
          setHostUrlModalError(null);
          setHostUrlModalState({
            mode: 'edit',
            slot,
            panePath,
            initialValue: value.trim(),
          });
        } catch (err) {
          if (!hostUrlReadRequestId.isCurrent(id)) return;
          showError(
            `Edit ${getHostBrowserUrlSlotLabel(slot)} failed`,
            getErrorMessage(err),
          );
        }
      })();
    },
    [
      getErrorMessage,
      hostUrlReadRequestId,
      resolveHostBrowserPanePath,
      runHostBrowserCommand,
      showError,
    ],
  );

  const handleCloseHostUrlModal = useCallback(() => {
    if (hostUrlSubmitInFlightRef.current || hostUrlModalSubmitting) return;
    resetHostUrlModal();
  }, [hostUrlModalSubmitting, resetHostUrlModal]);

  const handleSubmitHostUrlModal = useCallback(
    (value: string) => {
      const state = hostUrlModalState;
      if (!state) return;
      const parsed = parseHostBrowserUrlInput(value);
      if (parsed.type === 'empty') {
        setHostUrlModalState(null);
        setHostUrlModalError(null);
        return;
      }
      if (parsed.type === 'invalid') {
        setHostUrlModalError(parsed.message);
        return;
      }
      if (hostUrlSubmitInFlightRef.current) return;
      const id = hostUrlSubmitRequestId.next();
      hostUrlSubmitInFlightRef.current = true;
      void (async () => {
        setHostUrlModalSubmitting(true);
        setHostUrlModalError(null);
        try {
          await runHostBrowserCommand(
            buildTmuxWindowConfigSetCommand(
              state.slot,
              state.panePath,
              parsed.url,
            ),
            10_000,
          );
          if (!hostUrlSubmitRequestId.isCurrent(id)) return;
          if (state.mode === 'open-missing') {
            await openAndroidUrl(parsed.url);
            if (!hostUrlSubmitRequestId.isCurrent(id)) return;
          }
          setHostUrlModalState(null);
        } catch (err) {
          if (!hostUrlSubmitRequestId.isCurrent(id)) return;
          setHostUrlModalError(getErrorMessage(err));
        } finally {
          if (hostUrlSubmitRequestId.isCurrent(id)) {
            hostUrlSubmitInFlightRef.current = false;
            setHostUrlModalSubmitting(false);
          }
        }
      })();
    },
    [
      getErrorMessage,
      hostUrlModalState,
      hostUrlSubmitRequestId,
      openAndroidUrl,
      runHostBrowserCommand,
    ],
  );

  const cycleWorkmuxStatus = useCallback(() => {
    void (async () => {
      try {
        if (!tmuxEnabled) {
          throw new Error('Status cycle requires a tmux-enabled connection.');
        }
        const sessionName = tmuxTarget.trim() || 'main';
        await runHostBrowserCommand(
          buildHostBrowserStatusCycleCommand(sessionName),
          10_000,
        );
      } catch (err) {
        showError('Status cycle failed', getErrorMessage(err));
      }
    })();
  }, [
    getErrorMessage,
    runHostBrowserCommand,
    showError,
    tmuxEnabled,
    tmuxTarget,
  ]);

  // Unmount cleanup.
  useEffect(() => {
    return () => {
      hostUrlReadRequestId.invalidate();
      hostUrlSubmitRequestId.invalidate();
      hostUrlSubmitInFlightRef.current = false;
      browserGitHubTargetRequestId.invalidate();
      hostDiffityRequestId.invalidate();
      hostDiffityInFlightRef.current = false;
    };
  }, [
    browserGitHubTargetRequestId,
    hostDiffityRequestId,
    hostUrlReadRequestId,
    hostUrlSubmitRequestId,
  ]);

  return {
    browserActionsProps: {
      open,
      onClose: close,
      onOpenDiff: handleOpenHostDiffity,
      onOpenGitHubIssues: handleOpenGitHubIssuesTarget,
      onOpenGitHubPulls: handleOpenGitHubPullsTarget,
      onOpenUrlSlot: handleOpenHostUrlSlot,
      onEditUrlSlot: handleEditHostUrlSlot,
    },
    hostUrlProps: {
      open: hostUrlModalState != null,
      slot: hostUrlModalState?.slot ?? null,
      slotLabel: hostUrlModalState
        ? getHostBrowserUrlSlotLabel(hostUrlModalState.slot)
        : 'URL',
      initialValue: hostUrlModalState?.initialValue ?? '',
      mode: hostUrlModalState?.mode ?? 'edit',
      isSubmitting: hostUrlModalSubmitting,
      error: hostUrlModalError,
      onClose: handleCloseHostUrlModal,
      onSubmit: handleSubmitHostUrlModal,
    },
    open: openController,
    close,
    resolveHostBrowserPanePath,
    resolveCurrentGitHubRepository,
    runHostBrowserCommand,
    invalidateHostUrlReads,
    cycleWorkmuxStatus,
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: clean.

- [ ] **Step 3: Wire into `detail.tsx`**

(a) Extend imports:

```ts
import {
  useBrowserActionsController,
  useFeatureRequestController,
  useShellSimpleModals,
  useSkillSelectorController,
} from '@/lib/shell-modals';
```

(b) Remove state:
- `browserActionsOpen` (line 710)
- `hostUrlModalState`, `hostUrlModalSubmitting`, `hostUrlModalError` (lines 747–752)

(c) Remove refs and helpers:
- `hostUrlReadRequestIdRef`, `hostUrlSubmitRequestIdRef`, `hostUrlSubmitInFlightRef` (lines 788–790)
- `browserGitHubTargetRequestIdRef`, `hostDiffityRequestIdRef`, `hostDiffityInFlightRef` (lines 795–797)
- `invalidateHostUrlReads`, `resetHostUrlModal` (lines 798–808)
- `showHostBrowserError`, `runHostBrowserCommand` (lines 2130–2152)
- `resolveHostBrowserPanePath`, `resolveCurrentGitHubRepository` (lines 2263–2300)
- `openAndroidUrl` (lines 2474–2482)
- `handleOpenBrowserActions`, `handleCloseBrowserActions` (lines 2484–2504)
- `handleOpenGitHubTarget`, `handleOpenGitHubIssuesTarget`, `handleOpenGitHubPullsTarget` (lines 2506–2538)
- `handleOpenHostDiffity` (lines 2540–2571)
- `handleOpenHostUrlSlot`, `handleEditHostUrlSlot` (lines 2573–2665)
- `handleCloseHostUrlModal`, `handleSubmitHostUrlModal` (lines 2667–2720)
- `handleCycleWorkmuxStatus` (lines 2722–2737)

(d) Remove the `HostUrlModalState` type alias (lines 346–351). It now lives inside `shell-modals.tsx`.

(e) Remove unused imports: `HostUrlModalMode` (alias of `HostUrlModal` import), `parseHostBrowserUrlInput`, `extractLastHttpsUrl`, `buildDiffityShareCommand`, `buildHostBrowserPanePathCommand`, `buildHostBrowserStatusCycleCommand`, `buildTmuxWindowConfigGetCommand`, `buildTmuxWindowConfigSetCommand`, `buildSkillDiscoveryCommand`, `parseSkillDiscoveryOutput`, `DiscoveredSkill`, `parseGitHubRepositoryResolutionOutput`, `buildGitHubRepositoryTargetUrl`, `buildResolveGitHubRepositoryCommand`, `buildCreateGitHubIssueCommand`, `GitHubRepositoryTarget`, `executeSideChannelCommand`. Keep `HostBrowserUrlSlot` and `getHostBrowserUrlSlotLabel` ONLY IF they're still used elsewhere (likely not — verify with grep).

Verify after editing:

```bash
grep -n "HostBrowserUrlSlot\|getHostBrowserUrlSlotLabel\|parseHostBrowserUrlInput\|extractLastHttpsUrl\|buildDiffityShareCommand\|buildHostBrowserPanePathCommand\|buildHostBrowserStatusCycleCommand\|buildTmuxWindowConfigGetCommand\|buildTmuxWindowConfigSetCommand\|buildSkillDiscoveryCommand\|parseSkillDiscoveryOutput\|DiscoveredSkill\|parseGitHubRepositoryResolutionOutput\|buildGitHubRepositoryTargetUrl\|buildResolveGitHubRepositoryCommand\|buildCreateGitHubIssueCommand\|executeSideChannelCommand" apps/mobile/src/app/shell/detail.tsx
```

Remove every import not appearing in a non-import line. (The agent-notification route handler effect calls `runHostBrowserCommand` — pass `browserActions.runHostBrowserCommand` to it via the existing effect deps.)

(f) Update the source-key effect (added in Task 6's step i): remove `hostDiffityRequestIdRef.current += 1;` and `browserGitHubTargetRequestIdRef.current += 1;` — those refs are gone now. The hook handles its own source-key invalidation via `invalidateHostUrlReads` plus the request-id refs being internal. To preserve the original behavior, expose `invalidateAll` on the controller and call it from the effect:

Add to `BrowserActionsControllerHandle`:

```ts
invalidateAll: () => void;
```

And implement inside the hook (just before `return`):

```ts
const invalidateAll = useCallback(() => {
  hostUrlReadRequestId.invalidate();
  hostUrlSubmitRequestId.invalidate();
  browserGitHubTargetRequestId.invalidate();
  hostDiffityRequestId.invalidate();
}, [
  browserGitHubTargetRequestId,
  hostDiffityRequestId,
  hostUrlReadRequestId,
  hostUrlSubmitRequestId,
]);
// ...add `invalidateAll` to the returned object.
```

Update the effect in `detail.tsx`:

```ts
useLayoutEffect(() => {
  if (lastSkillSelectorSourceKeyRef.current === skillSelectorSourceKey) return;
  lastSkillSelectorSourceKeyRef.current = skillSelectorSourceKey;
  browserActions.invalidateAll();
  // The host-URL modal should reset when the source changes; the controller
  // exposes that via `close()` plus invalidateAll().
  browserActions.close();
  featureRequest.markSourceStale();
}, [
  browserActions,
  featureRequest,
  skillSelectorSourceKey,
]);
```

(g) Declare the controller after `skillSelector` (and before `featureRequest`, OR re-order so the ref-bridge pattern from Task 6 handles cycles). Since `featureRequest` depends on `resolveCurrentGitHubRepository`, declare `browserActions` first, then `featureRequest`:

```ts
const browserActionsCloseRef = useRef<() => void>(() => {});

const browserActions = useBrowserActionsController({
  connection,
  tmuxEnabled,
  tmuxTarget,
  executeSideChannelCommand,
  getErrorMessage,
  closeOtherModals: useCallback(() => {
    invalidate /* see below */;
    commandPresetsModal.onClose();
    commanderModal.onClose();
    skillSelectorCloseRef.current();
    handleCloseTextEntry();
    configureModal.onClose();
    if (!featureRequestCloseRef.current()) return false;
    return true;
  }, [
    commandPresetsModal,
    commanderModal,
    configureModal,
    handleCloseTextEntry,
  ]),
});

browserActionsCloseRef.current = browserActions.close;
```

Note the `invalidate` line: it should be `browserActions.invalidateHostUrlReads();` — but that creates a self-reference. Since `closeOtherModals` runs at event time (not declaration time), this works only if accessed lazily. Easiest fix: drop that line from `closeOtherModals` — `invalidateHostUrlReads` is called from `openController` inside the hook anyway, so the external coordinator doesn't need to invoke it.

After removal:

```ts
closeOtherModals: useCallback(() => {
  commandPresetsModal.onClose();
  commanderModal.onClose();
  skillSelectorCloseRef.current();
  handleCloseTextEntry();
  configureModal.onClose();
  if (!featureRequestCloseRef.current()) return false;
  return true;
}, [
  commandPresetsModal,
  commanderModal,
  configureModal,
  handleCloseTextEntry,
]),
```

(h) Re-bind dependencies that were previously inline:

```ts
const featureRequest = useFeatureRequestController({
  connection,
  resolveCurrentGitHubRepository: browserActions.resolveCurrentGitHubRepository,
  executeSideChannelCommand,
  getErrorMessage,
  logger,
  closeOtherModals: useCallback(() => {
    browserActions.invalidateHostUrlReads();
    skillSelectorCloseRef.current();
    browserActions.close();
    configureModal.onClose();
  }, [browserActions, configureModal]),
});

featureRequestCloseRef.current = featureRequest.close;

const skillSelector = useSkillSelectorController({
  connection,
  tmuxEnabled,
  runHostBrowserCommand: browserActions.runHostBrowserCommand,
  resolveHostBrowserPanePath: browserActions.resolveHostBrowserPanePath,
  sendTextRaw,
  sourceKey: skillSelectorSourceKey,
  getErrorMessage,
  closeOtherModals: useCallback(() => {
    commandPresetsModal.onClose();
    browserActions.close();
    commanderModal.onClose();
    configureModal.onClose();
    if (!featureRequest.close()) return false;
    handleCloseTextEntry();
    return true;
  }, [
    browserActions,
    commandPresetsModal,
    commanderModal,
    configureModal,
    featureRequest,
    handleCloseTextEntry,
  ]),
});

skillSelectorCloseRef.current = skillSelector.close;
```

(i) Update `actionContext` (still around line 2750–2774):

```ts
const actionContext = useMemo<ActionContext>(
  () => ({
    availableKeyboardIds,
    selectKeyboard: selectKeyboardIfExists,
    resolveKeyboardActionTarget: (actionId) =>
      getKeyboardActionTarget(shellConfig, actionId),
    rotateKeyboard,
    openConfigurator: openConfigDialog,
    sendBytes: sendBytesRaw,
    pasteClipboard: handlePasteClipboard,
    copySelection: handleCopySelection,
    toggleCommandPresets: () => {
      browserActions.invalidateHostUrlReads();
      commanderModal.onClose();
      browserActions.close();
      skillSelector.close();
      handleCloseTextEntry();
      if (commandPresetsModal.open) {
        commandPresetsModal.onClose();
      } else {
        commandPresetsModal.onOpen();
      }
    },
    openCommander: () => {
      browserActions.invalidateHostUrlReads();
      commandPresetsModal.onClose();
      browserActions.close();
      skillSelector.close();
      handleCloseTextEntry();
      commanderModal.onOpen();
    },
    openSkillSelector: skillSelector.open,
    openRepoFeatureRequest: featureRequest.open,
    openWisprTextEditor: handleOpenWisprTextEditor,
    openBrowserActions: browserActions.open,
    openHostDiffity: browserActions.browserActionsProps.onOpenDiff,
    openHostUrlSlot: browserActions.browserActionsProps.onOpenUrlSlot,
    editHostUrlSlot: browserActions.browserActionsProps.onEditUrlSlot,
    cycleWorkmuxStatus: browserActions.cycleWorkmuxStatus,
  }),
  [
    availableKeyboardIds,
    browserActions,
    commandPresetsModal,
    commanderModal,
    featureRequest.open,
    handleCloseTextEntry,
    handleCopySelection,
    handleOpenWisprTextEditor,
    handlePasteClipboard,
    openConfigDialog,
    rotateKeyboard,
    selectKeyboardIfExists,
    sendBytesRaw,
    shellConfig,
    skillSelector.close,
    skillSelector.open,
  ],
);
```

(j) Update the agent-notification route handler effect (around line 2154): replace `runCommand: runHostBrowserCommand` with `runCommand: browserActions.runHostBrowserCommand`. Update the deps array.

(k) Replace the BrowserActions and HostUrl JSX:

```tsx
<BrowserActionsModal
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  {...browserActions.browserActionsProps}
/>
{/* ... */}
<HostUrlModal
  bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
  open={browserActions.hostUrlProps.open}
  slotLabel={browserActions.hostUrlProps.slotLabel}
  initialValue={browserActions.hostUrlProps.initialValue}
  mode={browserActions.hostUrlProps.mode}
  isSubmitting={browserActions.hostUrlProps.isSubmitting}
  error={browserActions.hostUrlProps.error}
  onClose={browserActions.hostUrlProps.onClose}
  onSubmit={browserActions.hostUrlProps.onSubmit}
/>
```

- [ ] **Step 4: Run gates**

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
```

Expected: clean. Test count unchanged from baseline.

If lint flags unused imports, clean them.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "$(cat <<'EOF'
refactor(mobile): extract useBrowserActionsController from detail.tsx

Move BrowserActions, HostURL modal, host-diffity, GitHub-targets, and
workmux-status-cycle handlers — plus their shared side-channel helpers
(runHostBrowserCommand, resolveHostBrowserPanePath, resolveCurrentGitHubRepository,
openAndroidUrl) — into a single hook. The agent-notification route
handler still in detail.tsx now calls through the hook's exposed
runHostBrowserCommand.

Part of detail.tsx PR 1 (modal controllers). No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification and open PR

**Files:** none modified.

- [ ] **Step 1: Confirm `detail.tsx` shrank as expected**

```bash
wc -l apps/mobile/src/app/shell/detail.tsx
```

Expected: ~3,242 lines (≈400 LOC less than the baseline recorded in Task 1). If the delta is much smaller (~100), audit which extracted block was accidentally left behind.

- [ ] **Step 2: Run the full check suite**

```bash
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile test:integration
```

Expected: all green. Test count matches Task 1 baseline + 4 (the new `buildFeatureRequestSubmittedAlert` cases).

- [ ] **Step 3: Smoke test on Android device (manual)**

Goldenpath: connect to a tmux-enabled host, then exercise the extracted surfaces:
1. Open Configure → close → Open feature request → cancel.
2. Open feature request → submit one (verify alert title/body shape).
3. Open Browser Actions → tap a configured URL slot → page opens.
4. Open Browser Actions → edit a URL slot → save → reopen → opens.
5. Tap GitHub Issues from Browser Actions → opens correct repo.
6. Open Skill Selector → tap a skill → command lands in terminal.
7. Switch to a second tmux window → reopen Skill Selector — verifies source-key reset.
8. Open Command Presets → tap a preset → runs.
9. Open Commander → type → execute.

Record any visible regression and stop. If clean, continue.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin detail-tsx-pr1-modal-controllers
gh pr create --base main --title "refactor(mobile): extract modal controllers from detail.tsx (PR 1 of 4)" --body "$(cat <<'EOF'
## Summary

PR 1 of the `detail.tsx` decomposition (issue #71). Extracts the four modal-controller surfaces into a single new file:

- `useShellSimpleModals` — open/close for CommandPresets, Commander, TextEntry, Configure
- `useSkillSelectorController` — skill discovery + source-key reset
- `useFeatureRequestController` — repository resolution + side-channel submit
- `useBrowserActionsController` — BrowserActions modal + HostURL modal + GitHub targets + diffity + workmux status

Adds two small helpers:

- `lib/request-id.ts::useRequestId()` — folds the recurring `++ref / id === ref` dedupe pattern (used in five places previously)
- `repo-feature-request.ts::buildFeatureRequestSubmittedAlert` — pure helper extracted from the inline alert builder, with node:test coverage

## Why

`detail.tsx` had grown to ~3,642 LOC and owned nine distinct feature concerns. This PR extracts modal controllers (the lowest-risk slice) to establish the extraction pattern. PRs 2–4 will follow with Wispr session, keyboard dispatch, and terminal session — see `docs/superpowers/specs/2026-05-30-detail-tsx-decomposition-design.md`.

## Aggressive redesigns called out

- `handleFeatureRequestSubmit` (85 LOC) — pure parsing extracted to a tested helper; orchestration stays in the hook.
- Request-ID dedupe pattern — consolidated into `useRequestId()`.
- `featureRequestSourceStaleRef` — kept (it's a real signal: in-flight submit cannot be cancelled, but the source can become stale mid-submit).

## Behavior change

None. All flows continue to call the same SSH side-channel commands and render the same modal trees. The hook wiring preserves the existing "close everything else first" ordering by passing peer-close callbacks via deps.

## Size delta

- `detail.tsx`: ~3,642 → ~3,242 LOC (−400)
- `lib/shell-modals.tsx`: new, ~500 LOC
- `lib/request-id.ts`: new, ~25 LOC
- `repo-feature-request.ts`: +14 LOC (one helper)
- `repo-feature-request.test.ts`: +35 LOC (four new tests)

## Test plan

- [ ] `pnpm --filter @fressh/mobile typecheck` clean
- [ ] `pnpm --filter @fressh/mobile lint:check` clean
- [ ] `pnpm --filter @fressh/mobile test:integration` — all tests pass; new `buildFeatureRequestSubmittedAlert` cases pass
- [ ] Android smoke test: Configure, FeatureRequest (submit), BrowserActions, HostURL (open + edit), GitHub Issues/Pulls, Skill Selector (with source-key reset), Command Presets, Commander

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review checklist (run inline before handing off)

1. **Spec coverage** — every section of the spec's "PR 1" gets a task:
   - `useFeatureRequestController` state/refs/callbacks — Task 6 ✔
   - `useSkillSelectorController` state/refs/callbacks — Task 5 ✔
   - `useBrowserActionsController` state/refs/callbacks — Task 7 ✔
   - `useShellSimpleModals` four states — Task 4 ✔
   - Hook surfaces (`modalProps`, `open()`, etc.) — Tasks 4–7 ✔
   - Aggressive: pure-parse extracted to `repo-feature-request.ts` — Task 2 ✔
   - Aggressive: `useRequestId()` helper — Task 3 ✔
   - Aggressive: drop `<modal>SourceStaleRef` where possible — partially. `featureRequestSourceStaleRef` is retained because in-flight submit and stale-source are distinct signals (the submit can't be cancelled by ID bump alone). Noted in PR description.
   - Tests for new helper — Task 2 ✔
   - Risk: `closeFeatureRequest` returns `boolean` — preserved (`FeatureRequestControllerHandle.close: () => boolean`) ✔
   - Risk: "close everything else first" preserved — yes, via `closeOtherModals` callback returning boolean ✔
   - Size estimate — Task 8 step 1 verifies ~400 LOC delta ✔

2. **Placeholder scan** — no "TBD", "TODO", or vague instructions. Each transformation table in Tasks 4–7 lists every replacement explicitly.

3. **Type consistency** —
   - `useShellSimpleModals` returns `ShellSimpleModalsHandle` with `{ open, onOpen, onClose }` per modal; consumer destructures consistently.
   - `useSkillSelectorController` returns `{ modalProps, open, close }`; consumer uses `skillSelector.open`, `skillSelector.close`, `skillSelector.modalProps`.
   - `useFeatureRequestController` returns `{ modalProps, open, close, markSourceStale }`; consumer uses all four.
   - `useBrowserActionsController` returns `{ browserActionsProps, hostUrlProps, open, close, resolveHostBrowserPanePath, resolveCurrentGitHubRepository, runHostBrowserCommand, invalidateHostUrlReads, cycleWorkmuxStatus, invalidateAll }`; consumer uses all of them.
   - The cross-hook ref-bridge (`skillSelectorCloseRef`, `featureRequestCloseRef`, `browserActionsCloseRef`) breaks the declaration cycle without changing types.

4. **Cycle audit** —
   - `browserActions.closeOtherModals` calls `featureRequestCloseRef.current()` and `skillSelectorCloseRef.current()` — both refs are assigned AFTER hook declarations, so any closeOtherModals invocation at event time is safe.
   - `featureRequest.closeOtherModals` calls `browserActions.invalidateHostUrlReads()` and `browserActions.close()` directly because `browserActions` is declared first.
   - `skillSelector.closeOtherModals` calls `browserActions.close()`, `featureRequest.close()` directly because both are declared before `skillSelector`.

---

## Execution handoff

Once the plan is approved and tasks are ready to run, two execution options are available:

1. **Subagent-Driven (recommended)** — fresh subagent per task, code review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

If subagent-driven: REQUIRED SUB-SKILL `superpowers:subagent-driven-development`.
If inline: REQUIRED SUB-SKILL `superpowers:executing-plans`.
