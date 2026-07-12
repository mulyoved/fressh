# Xterm Selection Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,514-line selection-handle module with focused,
test-first units that use public xterm APIs wherever possible and one guarded
xterm 5.5.0 adapter for exact render geometry.

**Architecture:** One capability adapter owns all xterm selection access and the
only approved private cast. Pure range and geometry modules feed a typed
interaction model; focused mode, drag, and long-press runtimes coordinate one
DOM view and one React Native bridge formatter. `selection-controller.ts`
composes those units and exposes only four lifecycle commands to `main.tsx`.

**Tech Stack:** TypeScript 5.9, xterm.js 5.5.0, `@xterm/addon-fit` 0.10.0,
Playwright 1.61.1 with Chromium, Node `tsx --test`, Vite 6, pnpm/Turbo,
Prettier, ESLint.

## Prerequisite

Read the approved
`docs/wayfinder/source-quality-recovery/research/2026-07-12-xterm-selection-boundary.md`
before implementation. This plan implements that boundary without changing the
React Native bridge schema or user-visible selection behavior.

## Global Constraints

- Start every production change with one failing behavior or architecture test
  and observe the expected failure before editing production code.
- Pin `@xterm/xterm` to exactly `5.5.0` and `@xterm/addon-fit` to exactly
  `0.10.0`. A lockfile resolution alone is not a sufficient pin.
- Preserve the 500 ms long press, 8 px movement slop, 300 ms hide guard, 36 px
  minimum handle gap, current lollipop geometry, word expansion, wide-cell
  normalization, backdrop dismissal, pointer capture, touch fallback, viewport
  restoration, and selection-owned scrollback messages.
- Preserve the existing bridge messages and fields: `selection`,
  `selectionChanged`, `selectionModeChanged`, and `scrollbackBatch` with
  `source: 'selection-handle'`.
- Public xterm APIs own selection state, buffer access, events, options, and
  viewport restoration. Do not call private selection, mouse, or buffer
  services.
- Only
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-capabilities.ts`
  may cast `Terminal` to a private shape. Its private shape is limited to
  `_core.screenElement` and `_core._renderService.dimensions.css.cell`.
- When private geometry is missing or invalid, selection handles stay disabled
  for that terminal instance while terminal input/output remains usable.
- Do not add an xterm addon, proposed decoration, event bus, generic state
  machine library, compatibility facade, or multi-version private fallback.
- Keep every new production file below 350 nonblank lines and
  `selection-controller.ts` below 250 nonblank lines.
- Keep pure geometry and range tests free of DOM, timers, xterm, and bridge
  mocks. Use the real Chromium test only for the pinned xterm contract.
- Generated `dist-internal/index.html` is rebuilt by the package command and is
  never edited by hand.
- Use the local Android preview lane for the final manual check. Never clear
  `com.finalapp.vibe2` data or run `test:e2e:clear-state`.
- Run `$thermo-nuclear-code-quality-review` after automated verification and
  resolve every blocker before merge.

---

## Final File Shape

### Production selection units

- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts`
  for shared domain types and focused ports.
- Create
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-capabilities.ts`
  for public xterm operations and guarded 5.5.0 geometry.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-range-policy.ts`
  for range conversion, ordering, word expansion, and wide cells.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-geometry.ts` for
  pixel/cell mapping, handle anchors, glyph bounds, and minimum gap.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-interaction-model.ts`
  for the typed interaction state.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-bridge.ts` for
  selection-owned bridge messages and deduplication.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-dom-view.ts` for
  styles, overlay, handles, SVG, placement, and DOM cleanup.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-mode-runtime.ts`
  for enter, exit, input-option restoration, hide guard, and overlay dismissal.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-drag-runtime.ts`
  for start/end handle gestures and viewport lock.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-long-press-runtime.ts`
  for timer, slop, initial word selection, and continuous drag.
- Create
  `packages/react-native-xtermjs-webview/src-internal/selection-controller.ts`
  for composition, subscriptions, rendering, and disposal.
- Delete
  `packages/react-native-xtermjs-webview/src-internal/selection-handles.ts`.

### Tests and browser fixture

- Create focused `selection-*.test.ts` files beside the production units.
- Create
  `packages/react-native-xtermjs-webview/src-internal/test-support/fake-dom.ts`.
- Rename
  `packages/react-native-xtermjs-webview/src-internal/interaction-state.test.ts`
  to
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.test.ts`
  after moving its selection cases to their owners.
- Create
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-contract.html`.
- Create
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-contract.ts`.
- Create
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-capabilities.spec.ts`.
- Create `packages/react-native-xtermjs-webview/test/playwright.config.ts`.

---

### Task 1: Exact Dependencies and Browser Contract Harness

**Files:**

- Modify: `packages/react-native-xtermjs-webview/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/react-native-xtermjs-webview/.gitignore`
- Modify: `packages/react-native-xtermjs-webview/tsconfig.json`
- Create: `packages/react-native-xtermjs-webview/test/tsconfig.json`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-architecture.test.ts`
- Create: `packages/react-native-xtermjs-webview/test/playwright.config.ts`
- Create:
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-contract.html`
- Create:
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-contract.ts`

**Interfaces:**

- Produces `test:unit`, `test:browser`, and combined `test` package scripts.
- Produces a Chromium page that opens a real xterm 5.5.0 terminal for later
  adapter tests.

- [ ] **Step 1: Write the failing dependency architecture test**

Create `xterm-selection-architecture.test.ts` with a test that reads
`package.json` and asserts:

```ts
assert.equal(pkg.devDependencies['@xterm/xterm'], '5.5.0');
assert.equal(pkg.devDependencies['@xterm/addon-fit'], '0.10.0');
assert.equal(pkg.devDependencies['@playwright/test'], '1.61.1');
assert.equal(pkg.scripts['test:unit'], 'tsx --test src-internal/*.test.ts');
assert.equal(
	pkg.scripts['test:browser'],
	'playwright test -c test/playwright.config.ts',
);
assert.equal(pkg.scripts.test, 'pnpm run test:unit && pnpm run test:browser');
assert.equal(pkg.scripts.typecheck, 'tsc -b --pretty false');
```

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/xterm-selection-architecture.test.ts
```

Expected: FAIL because the versions use carets and the two scripts and
Playwright dependency do not exist.

- [ ] **Step 3: Pin dependencies and add scripts**

Run:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview add -D -E @playwright/test@1.61.1 @xterm/addon-fit@0.10.0 @xterm/xterm@5.5.0
pnpm --filter @fressh/react-native-xtermjs-webview exec playwright install chromium
```

Set the three test scripts and strengthened typecheck script to the exact
strings asserted above. Add `test-results/`, `playwright-report/`, and
`blob-report/` to the package `.gitignore`.

- [ ] **Step 4: Add the real-browser fixture**

Configure Playwright with Chromium only, `workers: 1`, no retries, and this Vite
server:

```ts
webServer: {
	command:
		'pnpm exec vite --config vite.config.internal.ts --host 127.0.0.1 --port 4178 --strictPort',
	url: 'http://127.0.0.1:4178/test/browser/xterm-selection-contract.html',
	reuseExistingServer: false,
},
use: { baseURL: 'http://127.0.0.1:4178' },
```

The fixture imports `Terminal`, opens an 80-by-24 terminal in a fixed-size
element, and exposes only `term`, `write(data)`, and `dispose()` on
`window.__FRESSH_XTERM_SELECTION_CONTRACT__`.

Add `test/tsconfig.json` with `target: "ES2022"`, `lib: ["ES2022", "DOM"]`,
`types: ["node", "@playwright/test"]`, strict bundler module resolution,
`noEmit: true`, and includes for `playwright.config.ts` and `browser/**/*.ts`.
Reference it from the package root `tsconfig.json` so ESLint project service and
TypeScript both own every new test file.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/xterm-selection-architecture.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/package.json packages/react-native-xtermjs-webview/.gitignore packages/react-native-xtermjs-webview/tsconfig.json packages/react-native-xtermjs-webview/test packages/react-native-xtermjs-webview/src-internal/xterm-selection-architecture.test.ts pnpm-lock.yaml
git commit -m "Add pinned xterm browser contract harness"
```

Expected: architecture test and typecheck PASS.

### Task 2: Xterm Selection Capability Adapter

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-capabilities.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-capabilities.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-capabilities.spec.ts`
- Modify:
  `packages/react-native-xtermjs-webview/test/browser/xterm-selection-contract.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/interaction-state.test.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-architecture.test.ts`

**Interfaces:**

- Produces `SelectionPoint`, `SelectionRange`, `SelectionCell`,
  `SelectionInputOptions`, `XtermSelectionSnapshot`, and
  `XtermSelectionCapabilities`.
- Produces
  `createXtermSelectionCapabilities(term: Terminal): XtermSelectionCapabilities | null`.

Use these exact domain types:

```ts
export type SelectionPoint = Readonly<{
	column: number;
	bufferRow: number;
}>;
export type SelectionRange = Readonly<{
	start: SelectionPoint;
	endExclusive: SelectionPoint;
}>;
export type SelectionCell = Readonly<{ text: string; width: number }>;
export type SelectionInputOptions = Readonly<{
	disableStdin: boolean;
	screenReaderMode: boolean;
}>;
```

Use this exact capability contract:

```ts
export type ScreenRect = Readonly<{
	left: number;
	top: number;
	right: number;
	bottom: number;
}>;
export type CellMetrics = Readonly<{ width: number; height: number }>;
export type XtermSelectionSnapshot = Readonly<{
	cols: number;
	rows: number;
	viewportRow: number;
	bufferType: 'normal' | 'alternate';
	selection: SelectionRange | null;
	screenRect: ScreenRect;
	cell: CellMetrics;
}>;
export type DisposablePort = Readonly<{ dispose: () => void }>;
export type XtermSelectionCapabilities = Readonly<{
	overlayRoot: HTMLElement;
	gestureRoot: HTMLElement;
	readSnapshot: () => XtermSelectionSnapshot | null;
	readCell: (point: SelectionPoint) => SelectionCell | null;
	readWordSeparator: () => string;
	readText: () => string;
	select: (range: SelectionRange) => void;
	clear: () => void;
	captureInputOptions: () => SelectionInputOptions;
	applyInputOptions: (options: SelectionInputOptions) => void;
	restoreViewport: (bufferRow: number) => void;
	subscribe: (listener: () => void) => DisposablePort;
}>;
```

- [ ] **Step 1: Write failing adapter tests**

The Node test uses typed fakes to prove malformed private geometry returns
`null` and that subscriptions dispose all four public xterm listeners. The
browser spec proves:

```ts
expect(await contract.selectAndRead(2, 3, 4)).toEqual({
	start: { column: 2, bufferRow: 3 },
	endExclusive: { column: 6, bufferRow: 3 },
});
expect(await contract.selectWhileMouseTracking()).toEqual({
	hasSelection: true,
	selectionEvents: 1,
});
expect(await contract.readGeometry()).toMatchObject({
	cols: 80,
	rows: 24,
	bufferType: 'normal',
});
```

Add a second browser case that writes `CSI ? 1049 h`, waits for parsing, and
asserts `bufferType: 'alternate'` and readable cells.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/xterm-selection-capabilities.test.ts && pnpm run test:browser
```

Expected: FAIL because the contracts and adapter do not exist.

- [ ] **Step 3: Implement the guarded adapter**

Use public `Terminal` APIs for every operation. The sole private cast is:

```ts
type Xterm55PrivateGeometry = {
	_core?: {
		screenElement?: HTMLElement;
		_renderService?: {
			dimensions?: {
				css?: { cell?: { width?: number; height?: number } };
			};
		};
	};
};
```

Reject missing roots, screen elements, or non-finite/non-positive cell sizes.
Normalize `getSelectionPosition()` into zero-based `SelectionRange`. Convert a
range back to `select(column, row, length)` using:

```ts
const length =
	(range.endExclusive.bufferRow - range.start.bufferRow) * term.cols +
	range.endExclusive.column -
	range.start.column;
```

`subscribe()` combines `onSelectionChange`, `onRender`, `onResize`, and
`onScroll`. `restoreViewport(row)` calls `term.scrollToLine(row)`.

- [ ] **Step 4: Remove the adjacent private telemetry read**

Replace `touch-scroll-controller.ts` access to
`privateTerm._core?._bufferService?.buffer` with `term.buffer.active.viewportY`,
`term.buffer.active.baseY`, and the public buffer type. Update its terminal port
type accordingly. Update the existing touch-scroll test terminal factory to
provide the same public buffer shape.

- [ ] **Step 5: Expand the architecture guard**

Scan every production file in `src-internal`. Fail if any file except
`xterm-selection-capabilities.ts` contains `_core`, `_selectionService`,
`_mouseService`, `_bufferService`, `_renderService`, `_model`, or
`_fireEventIfSelectionChanged`. Within the adapter, assert `_core`,
`screenElement`, and `_renderService` are the only private identifiers.

- [ ] **Step 6: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/xterm-selection-capabilities.test.ts src-internal/xterm-selection-architecture.test.ts src-internal/interaction-state.test.ts && pnpm run test:browser && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal packages/react-native-xtermjs-webview/test/browser
git commit -m "Add guarded xterm selection capabilities"
```

Expected: Node tests, Chromium contract tests, and typecheck PASS.

### Task 3: Pure Range and Word Policy

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-range-policy.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-range-policy.test.ts`

**Interfaces:**

- Produces `compareSelectionPoints`, `toInclusiveEnd`, `toEndExclusive`,
  `clampSelectionPoint`, `normalizeWideCellPoint`, `expandSelectionWord`, and
  `selectionRangeLength`.
- Consumes only `SelectionPoint`, `SelectionRange`, `SelectionCell`, column and
  row bounds, word separators, and a synchronous cell reader.

- [ ] **Step 1: Write failing table tests**

Cover same-row and wrapped ranges, end column equal to `cols`, reversed points,
viewport row clamping, a width-0 trailing CJK cell, emoji text, separators,
whitespace, empty cells, and a word touching each terminal edge. Example:

```ts
assert.deepEqual(
	expandSelectionWord(
		{ column: 4, bufferRow: 7 },
		{ cols: 10, separators: ' ', readCell },
	),
	{
		start: { column: 2, bufferRow: 7 },
		endExclusive: { column: 6, bufferRow: 7 },
	},
);
```

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-range-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement pure range functions**

Port the current `stepBufferPos`, `toInclusiveEnd`, cell normalization, and word
expansion algorithms. Use the provided reader; do not import xterm, DOM, bridge,
or controller modules. Always return a zero-based, end-exclusive range.

- [ ] **Step 4: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-range-policy.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-range-policy.ts packages/react-native-xtermjs-webview/src-internal/selection-range-policy.test.ts
git commit -m "Extract pure xterm selection range policy"
```

### Task 4: Pure Pixel and Handle Geometry

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-geometry.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-geometry.test.ts`

**Interfaces:**

- Produces `clientPointToBufferPoint`, `clampClientPointToScreen`,
  `measureSelectionGap`, `enforceSelectionGap`, `resolveHandleGlyphGeometry`,
  and `resolveSelectionHandlePlacements`.
- Produces typed `ClientPoint`, `HandleKind`, and `HandlePlacement` additions in
  `selection-contracts.ts`; consumes the existing `ScreenRect` and `CellMetrics`
  types.

- [ ] **Step 1: Write failing geometry tables**

Use exact current constants: 48-by-52 view box, `minY = -4`, circle center
`(24, 9)`, radius `10.5`, junction `(24, 17)`, stem width `2`, stem from 15 to
36, and minimum handle gap 36 px. Cover half-cell selection bias, every screen
edge, scrollback viewport offset, same-cell gap expansion, wrapped rows,
start/end visibility, and fixed screen anchors.

```ts
assert.deepEqual(
	clientPointToBufferPoint(
		{ x: 25, y: 41 },
		{
			screen: { left: 0, top: 0, right: 800, bottom: 480 },
			cell: { width: 10, height: 20 },
			cols: 80,
			rows: 24,
			viewportRow: 100,
		},
	),
	{ column: 3, bufferRow: 102 },
);
```

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-geometry.test.ts
```

Expected: FAIL because the geometry module does not exist.

- [ ] **Step 3: Implement the pure geometry**

Reproduce xterm 5.5.0's half-cell bias with `Math.ceil`, then convert to
zero-based coordinates and add `viewportRow`. Move all lollipop bounds, offsets,
anchor placement, visibility, and 36 px gap calculations here. Return data only;
do not create or measure DOM nodes.

- [ ] **Step 4: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-geometry.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts packages/react-native-xtermjs-webview/src-internal/selection-geometry.ts packages/react-native-xtermjs-webview/src-internal/selection-geometry.test.ts
git commit -m "Extract pure selection handle geometry"
```

### Task 5: Typed Interaction Model

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-interaction-model.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-interaction-model.test.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts`

**Interfaces:**

- Produces a discriminated `SelectionInteractionState` with phases `inactive`,
  `active`, `long-press-pending`, `long-press-dragging`, `handle-dragging`, and
  `dismiss-pending`.
- Produces `createSelectionInteractionModel()` with `snapshot`, `enter`, `exit`,
  `beginLongPress`, `fireLongPress`, `beginHandleDrag`, `beginDismiss`, `move`,
  `finish`, `cancel`, and `subscribe`.
- The returned public type is named `SelectionInteractionModel`.

- [ ] **Step 1: Write failing state-sequence tests**

Assert exact sequences for long-press timeout, movement beyond 8 px before the
timeout, long-press drag, start/end handle drag, overlay tap, pointer ID
mismatch, cancel, forced exit, and disposal. Assert impossible events return the
same snapshot and no boolean combination can represent two owners.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-interaction-model.test.ts
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the pure model**

Use one union snapshot, not parallel flags. Every accepted transition replaces
the complete snapshot and synchronously publishes it. `dispose()` clears
subscribers and permanently rejects later transitions. The model owns identity
and phase only; it does not call timers, DOM, xterm, or the bridge.

- [ ] **Step 4: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-interaction-model.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts packages/react-native-xtermjs-webview/src-internal/selection-interaction-model.ts packages/react-native-xtermjs-webview/src-internal/selection-interaction-model.test.ts
git commit -m "Model selection gesture ownership explicitly"
```

### Task 6: Selection-Owned Bridge Messages

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-bridge.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-bridge.test.ts`

**Interfaces:**

- Produces `createSelectionBridge({ instanceId, sendToRn, now })`.
- Returned commands are `selectionChanged(text)`, `modeChanged(enabled)`,
  `requestAutoScroll(direction, pageStep)`, and `debug(message)`.
- The returned public type is named `SelectionBridge`.

- [ ] **Step 1: Write failing exact-message tests**

Assert text deduplication, mode messages, sequence increments, timestamp
injection, and this exact auto-scroll message:

```ts
{
	type: 'scrollbackBatch',
	direction: 'down',
	pages: 0,
	lines: 1,
	pageStep: 23,
	instanceId: 'instance-1',
	seq: 1,
	ts: 1000,
	source: 'selection-handle',
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-bridge.test.ts
```

Expected: FAIL because the bridge formatter does not exist.

- [ ] **Step 3: Implement the formatter**

Import the existing `BridgeInboundDraftMessage` without changing its schema. The
formatter owns last emitted text and the selection scroll sequence. It does not
own selection state or call xterm.

- [ ] **Step 4: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-bridge.test.ts src-internal/bridge-contract.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-bridge.ts packages/react-native-xtermjs-webview/src-internal/selection-bridge.test.ts
git commit -m "Isolate selection bridge messages"
```

### Task 7: Selection DOM View

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-dom-view.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-dom-view.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/test-support/fake-dom.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/interaction-state.test.ts`

**Interfaces:**

- Produces `createSelectionDomView({ document, overlayRoot })`.
- Returned view exposes `overlay`, `startHandle`, `endHandle`, `setModeVisible`,
  `renderHandles`, `hideHandles`, and `dispose`.
- Consumes only `HandlePlacement` data and never reads xterm state.
- The returned public type is named `SelectionDomView`.

- [ ] **Step 1: Extract the fake DOM and write failing view tests**

Move the reusable fake element/document/event implementation out of
`interaction-state.test.ts` and update that test to import it. Test one style
element, transparent overlay, pointer-event toggling, exact start/end SVG
transforms, clip bounds, placement, hidden offscreen handles, idempotent render,
and complete disposal.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-dom-view.test.ts
```

Expected: FAIL because the DOM view does not exist.

- [ ] **Step 3: Move DOM ownership into the view**

Move the existing CSS, overlay, handle, SVG, glyph, clip, and placement code.
The view receives placements already calculated by `selection-geometry.ts`. It
may set DOM styles and data attributes, but it may not calculate buffer ranges,
manage timers, attach gesture listeners, send messages, or import xterm.

- [ ] **Step 4: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-dom-view.test.ts src-internal/selection-geometry.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-dom-view.ts packages/react-native-xtermjs-webview/src-internal/selection-dom-view.test.ts packages/react-native-xtermjs-webview/src-internal/test-support/fake-dom.ts
git commit -m "Extract selection DOM view"
```

### Task 8: Selection Mode Runtime

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-mode-runtime.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-mode-runtime.test.ts`

**Interfaces:**

- Produces
  `createSelectionModeRuntime({ capabilities, model, view, bridge, now, hideGuardMs: 300 })`.
- Returned commands are `setMode(enabled, opts?)`, `isEnabled`, and `dispose`.
- The returned public type is named `SelectionModeRuntime`.

- [ ] **Step 1: Write failing mode lifecycle tests**

Cover normal enter, duplicate enter, guarded exit at 299 ms, accepted exit at
300 ms, forced React Native exit, original `disableStdin` and `screenReaderMode`
restoration, mouse-tracking mode, clear selection, empty selection emission,
overlay tap/cancel, repeated dispose, and capability failure.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-mode-runtime.test.ts
```

Expected: FAIL because the mode runtime does not exist.

- [ ] **Step 3: Implement mode ownership**

Capture input options once. On enter, apply
`{ disableStdin: true, screenReaderMode: true }`, enter the model, show the
view, and emit the mode message. On exit, restore the exact captured options,
clear through the capability port, hide the view, exit the model, and emit
mode/text messages. The transparent overlay owns dismissal; do not call private
selection service methods or toggle xterm private CSS classes.

- [ ] **Step 4: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-mode-runtime.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-mode-runtime.ts packages/react-native-xtermjs-webview/src-internal/selection-mode-runtime.test.ts
git commit -m "Own selection mode lifecycle"
```

### Task 9: Handle Drag and Long-Press Runtimes

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-drag-runtime.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-drag-runtime.test.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-long-press-runtime.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-long-press-runtime.test.ts`

**Interfaces:**

- Drag runtime consumes capability snapshots, current ranges, pure range and
  geometry functions, model, view handles, and bridge commands.
- Long-press runtime consumes the same ports plus injected `setTimer` and
  `clearTimer`; it exposes `cancel` and `dispose`.
- Produces these exact factories:

```ts
export function createSelectionDragRuntime(
	options: Readonly<{
		capabilities: XtermSelectionCapabilities;
		model: SelectionInteractionModel;
		view: SelectionDomView;
		bridge: SelectionBridge;
	}>,
): DisposablePort;

export function createSelectionLongPressRuntime(
	options: Readonly<{
		capabilities: XtermSelectionCapabilities;
		model: SelectionInteractionModel;
		mode: SelectionModeRuntime;
		bridge: SelectionBridge;
		setTimer: (callback: () => void, delayMs: number) => number;
		clearTimer: (timerId: number) => void;
	}>,
): Readonly<{ cancel: () => void; dispose: () => void }>;
```

- [ ] **Step 1: Write failing drag tests**

Move and strengthen current tests for no-jump drag offset, 8 px slop, start and
end handles, pointer ID ownership, wide-cell normalization, range order, 36 px
gap, pointer capture/release, viewport restore, top/bottom auto-scroll, one
selection emission on finish, cancel, and unavailable geometry.

- [ ] **Step 2: Run and verify drag RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-drag-runtime.test.ts
```

Expected: FAIL because the drag runtime does not exist.

- [ ] **Step 3: Implement handle drag lifecycle**

Attach one listener set per handle. On pointer down, store kind, ID, client
origin, anchor offset, selection, and viewport row through the typed model. On
move after slop, clamp the client point, calculate the new buffer point, apply
wide-cell/range/gap policy, select through capabilities, restore the viewport,
and request auto-scroll when outside the screen. Finish or cancel releases
capture and clears ownership.

- [ ] **Step 4: Write failing long-press tests**

Cover 499/500 ms timing, movement before timeout, word expansion, whitespace,
PointerEvent and Android touch fallback, continuous selection after the timer,
top/bottom auto-scroll, viewport restore, pointer up, pointer cancel,
`cancelLongPress`, and repeated disposal.

- [ ] **Step 5: Run and verify long-press RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-long-press-runtime.test.ts
```

Expected: FAIL because the long-press runtime does not exist.

- [ ] **Step 6: Implement long-press lifecycle**

Use one injected timer and the typed model. At 500 ms, map the saved point,
expand through `selection-range-policy.ts`, force mode entry, select the word,
and begin continuous drag. Native pointer and touch listeners normalize into the
same internal event commands. Disposal cancels the timer and every listener.

- [ ] **Step 7: Run GREEN checks and commit**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-drag-runtime.test.ts src-internal/selection-long-press-runtime.test.ts && pnpm run typecheck
git add packages/react-native-xtermjs-webview/src-internal/selection-drag-runtime.ts packages/react-native-xtermjs-webview/src-internal/selection-drag-runtime.test.ts packages/react-native-xtermjs-webview/src-internal/selection-long-press-runtime.ts packages/react-native-xtermjs-webview/src-internal/selection-long-press-runtime.test.ts
git commit -m "Split selection gesture runtimes"
```

### Task 10: Selection Controller Composition

**Files:**

- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-controller.ts`
- Create:
  `packages/react-native-xtermjs-webview/src-internal/selection-controller.test.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts`

**Interfaces:**

- Produces
  `createSelectionController({ term, instanceId, sendToRn }): SelectionController`.
- `SelectionController` exposes exactly `setMode`, `isModeEnabled`,
  `cancelLongPress`, and `dispose`.

- [ ] **Step 1: Write failing composition tests**

Assert exact public keys, one construction of each private unit, capability
failure leaves a usable disabled controller, public xterm subscriptions trigger
view rendering, visible/offscreen placements, current text emission, and
reverse-order disposal. Do not read controller source for local variable names.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/selection-controller.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Compose the focused units**

Create capabilities first. If unavailable, return four safe commands with
`isModeEnabled() === false`. Otherwise create bridge, model, view, mode, drag,
and long-press units. Subscribe once to capability changes; each notification
reads a fresh snapshot and range, resolves placements, renders handles when
active, and hides them otherwise. Dispose subscriptions and runtimes in reverse
construction order.

- [ ] **Step 4: Run size and GREEN checks**

```bash
cd packages/react-native-xtermjs-webview && test "$(awk 'NF {n++} END {print n}' src-internal/selection-controller.ts)" -lt 250 && pnpm exec tsx --test src-internal/selection-controller.test.ts src-internal/selection-*.test.ts && pnpm run typecheck
```

Expected: size gate, selection suites, and typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react-native-xtermjs-webview/src-internal/selection-contracts.ts packages/react-native-xtermjs-webview/src-internal/selection-controller.ts packages/react-native-xtermjs-webview/src-internal/selection-controller.test.ts
git commit -m "Compose focused selection controller"
```

### Task 11: Main, Touch-Scroll, and Bridge Integration

**Files:**

- Modify: `packages/react-native-xtermjs-webview/src-internal/main.tsx`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/webview-message-handler.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/bridge-contract.test.ts`
- Rename:
  `packages/react-native-xtermjs-webview/src-internal/interaction-state.test.ts`
  to
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.test.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.test.ts`
- Delete:
  `packages/react-native-xtermjs-webview/src-internal/selection-handles.ts`
- Modify:
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-architecture.test.ts`

**Interfaces:**

- `main.tsx` owns one `SelectionController` for the WebView document lifetime.
- `webview-message-handler.ts` depends only on
  `Pick<SelectionController, 'setMode'>`.
- The public React Native bridge remains unchanged.

- [ ] **Step 1: Update integration tests and verify RED**

Change the outbound handler test to expect
`selectionController.setMode(enabled, { force: true })`. Move every selection
case from `interaction-state.test.ts` to the focused owner tests created above;
retain and rename all touch-scroll cases. Add assertions that selection takeover
cancels pending entry, preserves active scrollback, and drops queued scroll
during a mid-drag takeover.

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/bridge-contract.test.ts src-internal/touch-scroll-controller.test.ts src-internal/xterm-selection-architecture.test.ts
```

Expected: FAIL on the old `applySelectionMode` API, old import, and old file.

- [ ] **Step 2: Replace the old controller in `main.tsx`**

Import `createSelectionController`, create it after `term.open()` and fit, pass
its `isModeEnabled` and `cancelLongPress` commands to touch scroll, and pass its
`setMode` command to the outbound handler. Remove manual install/render calls
and the selection-specific resize callback. Register `selection.dispose()` on
`pagehide` with `{ once: true }`.

- [ ] **Step 3: Update the outbound handler**

Replace its local `SelectionHandles` type with:

```ts
type SelectionControllerPort = Pick<SelectionController, 'setMode'>;
```

Keep `getSelection` response behavior unchanged. Route `setSelectionMode` to
`setMode(msg.enabled, { force: true })`.

- [ ] **Step 4: Delete the giant file and old private fixtures**

Delete `selection-handles.ts`. Remove fake `_core` selection models from the
renamed touch-scroll test. Keep the new capability fake only in the focused
adapter tests. Do not leave an alias, facade, barrel export, or compatibility
wrapper.

- [ ] **Step 5: Run all package behavior checks**

```bash
cd packages/react-native-xtermjs-webview && pnpm run test:unit && pnpm run test:browser && pnpm run typecheck
```

Expected: every unit, bridge, touch-scroll, and Chromium contract test PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react-native-xtermjs-webview/src-internal
git commit -m "Replace giant xterm selection controller"
```

### Task 12: Architecture Gate, Build, and Maintainability Review

**Files:**

- Modify:
  `packages/react-native-xtermjs-webview/src-internal/xterm-selection-architecture.test.ts`
- Modify: `packages/react-native-xtermjs-webview/README.md`
- Generate: `packages/react-native-xtermjs-webview/dist-internal/index.html`
- Verify: every file changed in Tasks 1-11.

- [ ] **Step 1: Complete the failing final architecture gate**

Assert the exact 11 production selection files listed under Final File Shape,
the absence of `selection-handles.ts`, no private identifiers outside the one
adapter, no selection implementation in `main.tsx`, exact controller keys, exact
dependency pins, and size limits. Also assert selection behavior tests no longer
construct fake `_core` objects.

- [ ] **Step 2: Run and verify RED**

```bash
cd packages/react-native-xtermjs-webview && pnpm exec tsx --test src-internal/xterm-selection-architecture.test.ts
```

Expected: FAIL on any remaining legacy path, oversized unit, private access, or
missing inventory entry; otherwise deliberately make one inventory entry wrong,
observe the expected failure, restore it, and rerun.

- [ ] **Step 3: Document the supported boundary**

Update the README development section with exact xterm/addon versions, the
Chromium install command, `pnpm run test:browser`, the fail-closed geometry
behavior, and the rule that an xterm upgrade requires the browser contract
suite. Do not expose private details as part of the published React Native API.

- [ ] **Step 4: Run full package verification**

```bash
cd packages/react-native-xtermjs-webview && pnpm run fmt:check && pnpm run lint:check && pnpm run typecheck && pnpm run test && pnpm run build
```

Expected: formatting, lint, typecheck, all unit/browser tests, and both builds
exit 0 without warnings or unhandled rejections. The build regenerates
`dist-internal/index.html`.

- [ ] **Step 5: Run repository gates**

```bash
pnpm exec turbo lint:check
pnpm syncpack:check
git diff --check
```

Expected: Turbo, syncpack, jscpd, and whitespace checks exit 0.

- [ ] **Step 6: Run the thermo-nuclear review**

Invoke `$thermo-nuclear-code-quality-review` on the complete diff. It must find
no replacement giant file, pass-through adapter, hidden private xterm access,
boolean interaction state, mixed DOM/geometry policy, duplicated gesture
lifecycle, bridge message construction outside `selection-bridge.ts`, or fake
contract test. Fix every blocker with a new RED-GREEN cycle, then rerun Steps
4-5.

- [ ] **Step 7: Build and manually check Android preview**

```bash
cd apps/mobile && ANDROID_HOME=/home/muly/Android/Sdk ANDROID_SDK_ROOT=/home/muly/Android/Sdk EAS_SKIP_AUTO_FINGERPRINT=1 pnpm exec eas build --local --profile preview --platform android
```

Without clearing app data, verify long-press word selection, both handles,
wide/emoji cells, minimum gap, top/bottom auto-scroll, scrollback viewport
restoration, overlay dismissal, Copy/Paste, typing exit, tmux mouse mode,
full-screen alternate-buffer programs, reconnect, rotation/resize, and repeated
screen entry/exit.

- [ ] **Step 8: Record evidence and commit review fixes**

Record unit/browser test counts, final file inventory and nonblank line counts,
the exact xterm versions, private-boundary scan, build output, preview artifact,
manual observations, and thermo-nuclear result in the pull request. If review
fixes or generated output changed files:

```bash
git add packages/react-native-xtermjs-webview pnpm-lock.yaml
git commit -m "Harden xterm selection architecture"
```
