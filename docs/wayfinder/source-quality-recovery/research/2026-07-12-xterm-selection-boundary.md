# Supported Xterm Selection Boundary

## Answer

Fressh should support one exact xterm version, `@xterm/xterm` 5.5.0, and put all
xterm access behind one `XtermSelectionCapabilities` adapter.

The adapter should use public xterm APIs for selection state, buffer data,
events, options, and scrolling. It should use version-pinned internals only to
read the exact screen element and rendered cell dimensions. No other file may
read `_core` or any xterm private service.

This removes the current direct dependence on xterm's private selection model,
selection service, mouse service, buffer service, render service, and private
event methods. The only private data that remains is render geometry that xterm
5.5.0 does not expose publicly.

## Version Contract

The lockfile currently resolves:

- `@xterm/xterm` 5.5.0
- `@xterm/addon-fit` 0.10.0

The package manifest still uses caret ranges. The implementation plan should
change both direct specifications to exact versions. A refreshed lockfile must
not silently change the xterm version while Fressh uses a private geometry
capability.

An xterm upgrade is a deliberate migration. It must pass the adapter's real
browser contract tests before the version changes.

Sources:

- [xterm.js 5.5.0 release](https://github.com/xtermjs/xterm.js/releases/tag/5.5.0)
- [xterm.js 5.5.0 public declarations](https://github.com/xtermjs/xterm.js/blob/5.5.0/typings/xterm.d.ts)
- [Fressh's current package manifest](../../../../packages/react-native-xtermjs-webview/package.json)
- [Fressh's current lockfile](../../../../pnpm-lock.yaml)

## What the Public API Supports

| Fressh need                             | Public xterm 5.5.0 API                                                | Decision                                                   |
| --------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Know whether text is selected           | `hasSelection()`                                                      | Use it.                                                    |
| Read selected text                      | `getSelection()`                                                      | Use it.                                                    |
| Read selection endpoints                | `getSelectionPosition()`                                              | Use it through the adapter's version-tested normalization. |
| Set a range                             | `select(column, row, length)`                                         | Use it. Do not write the private model.                    |
| Clear a range                           | `clearSelection()`                                                    | Use it.                                                    |
| Observe selection changes               | `onSelectionChange`                                                   | Use it. Do not call private event methods.                 |
| Observe redraw, resize, and scroll      | `onRender`, `onResize`, `onScroll`                                    | Use them to request handle rendering.                      |
| Read terminal size                      | `cols`, `rows`                                                        | Use them.                                                  |
| Read the active buffer and viewport row | `buffer.active`, `viewportY`, `type`                                  | Use them.                                                  |
| Read lines and wide-cell data           | `getLine()`, `getNullCell()`, `getCell()`, `getWidth()`, `getChars()` | Use them for word expansion and wide-cell normalization.   |
| Read the terminal root                  | `element`                                                             | Use it as the Fressh overlay host.                         |
| Read mouse mode                         | `modes.mouseTrackingMode`                                             | Use it for mode policy only.                               |
| Disable typing during selection         | `options.disableStdin`                                                | Use it and restore the previous value.                     |
| Control accessibility mode              | `options.screenReaderMode`                                            | Use it only if the final behavior still requires it.       |
| Restore the viewport                    | `buffer.active.viewportY` plus `scrollToLine()`                       | Use these instead of writing `.xterm-viewport.scrollTop`.  |

The public buffer model is enough for word selection. It exposes the viewport
row, each buffer line, and each cell's text and width. The current private
`_bufferService` and `_workCell` accesses have public replacements.

The public `select()` method still updates and redraws a selection when xterm's
native mouse-selection listener is disabled by terminal mouse tracking. In
5.5.0, the native service's enabled flag guards mouse handling, not the public
`setSelection()` path. Fressh's own gesture layer can therefore use public
selection methods without calling private `enable()` or `disable()` methods.

Relevant upstream implementations:

- [Public Terminal wrapper](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/public/Terminal.ts)
- [Terminal selection methods](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/Terminal.ts#L943-L979)
- [Selection service](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/services/SelectionService.ts)
- [Public buffer interfaces](https://xtermjs.org/docs/api/terminal/interfaces/ibuffer/)
- [Public buffer-cell interface](https://xtermjs.org/docs/api/terminal/interfaces/ibuffercell/)

## Coordinate Warning

The 5.5.0 declarations describe `IBufferCellPosition` as one-based, but the
5.5.0 implementation returns the selection service's raw endpoint coordinates.
Those endpoints are zero-based and the end is a boundary after the selected
text.

Fressh must not spread this mismatch through its code. The adapter should
normalize the observed 5.5.0 result into one internal type:

```ts
type SelectionPoint = Readonly<{
	column: number;
	bufferRow: number;
}>;

type SelectionRange = Readonly<{
	start: SelectionPoint;
	endExclusive: SelectionPoint;
}>;
```

A browser contract test must create a real xterm 5.5.0 terminal, call
`select()`, and assert the exact result returned by `getSelectionPosition()`.
This test makes the version-specific coordinate behavior explicit.

Sources:

- [Public range declarations](https://github.com/xtermjs/xterm.js/blob/5.5.0/typings/xterm.d.ts#L1431-L1458)
- [5.5.0 `getSelectionPosition()` implementation](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/Terminal.ts#L961-L975)
- [5.5.0 selection endpoint model](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/selection/SelectionModel.ts)

## What Is Not Public

xterm 5.5.0 does not expose the exact CSS cell width and height or its internal
screen element on the public `Terminal` type. Fressh needs both to place handles
at the same pixels xterm uses for text.

Calculating cell height from the outer element is not exact in this project.
Fressh overrides `.xterm-screen` height, and fit calculations can leave spare
pixels. The adapter should therefore read the values xterm's renderer actually
uses.

For the exact supported version, the only allowed private shape is:

```ts
type Xterm55Geometry = Readonly<{
	_core?: {
		screenElement?: HTMLElement;
		_renderService?: {
			dimensions?: {
				css?: {
					cell?: { width?: number; height?: number };
				};
			};
		};
	};
}>;
```

The adapter must validate that the screen element exists and that both cell
dimensions are positive finite numbers. If validation fails, selection handles
are unavailable for that terminal instance; the terminal itself continues to
work. It must not search several old private layouts or fall back to more
private services.

The adapter returns geometry data. Pure geometry code outside the adapter maps
client pixels to zero-based viewport cells, applies xterm's half-cell selection
bias, clamps the cell, and adds `buffer.active.viewportY`.

The 5.5.0 coordinate algorithm is available in the upstream
[mouse input source](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/input/Mouse.ts).
Fressh should reproduce that small calculation as a tested pure function, not
call `_mouseService.getCoords()`.

## Why Addons and Decorations Do Not Close the Gap

An xterm addon receives the same public `Terminal` object as application code.
The addon contract has only `activate(terminal)` and `dispose()`. It does not
provide privileged selection or renderer hooks. Moving the current private
access into an addon would only rename the problem.

`registerDecoration()` can create a DOM element placed on terminal cells, but it
is a proposed API in 5.5.0. It requires a marker tied to the normal buffer, and
xterm returns no decoration for the alternate buffer. Fressh selection must work
in full-screen programs that use the alternate buffer, so decorations cannot be
the handle renderer.

Sources:

- [Addon interface](https://xtermjs.org/docs/api/terminal/interfaces/iterminaladdon/)
- [Decoration interface](https://xtermjs.org/docs/api/terminal/interfaces/idecoration/)
- [Decoration options](https://xtermjs.org/docs/api/terminal/interfaces/idecorationoptions/)
- [5.5.0 decoration renderer](https://github.com/xtermjs/xterm.js/blob/5.5.0/src/browser/decorations/BufferDecorationRenderer.ts)

## The Single Adapter

The next plan should create one file:

`packages/react-native-xtermjs-webview/src-internal/xterm-selection-capabilities.ts`

Its public surface should be no broader than:

```ts
type XtermSelectionSnapshot = Readonly<{
	cols: number;
	rows: number;
	viewportRow: number;
	bufferType: 'normal' | 'alternate';
	selection: SelectionRange | null;
	screenRect: Readonly<{
		left: number;
		top: number;
		right: number;
		bottom: number;
	}>;
	cellWidth: number;
	cellHeight: number;
}>;

type XtermSelectionCapabilities = Readonly<{
	readSnapshot: () => XtermSelectionSnapshot | null;
	readCell: (
		point: SelectionPoint,
	) => Readonly<{ text: string; width: number }> | null;
	readText: () => string;
	select: (range: SelectionRange) => void;
	clear: () => void;
	restoreViewport: (bufferRow: number) => void;
	subscribe: (listener: () => void) => { dispose: () => void };
	overlayRoot: HTMLElement;
}>;
```

The final names may change in the architecture plan, but the ownership must not:

- Only this adapter casts `Terminal` to a private shape.
- Only this adapter knows the 5.5.0 coordinate mismatch.
- Only this adapter knows the private geometry shape.
- Geometry calculations, handle layout, interaction state, DOM work, gestures,
  and React Native messages remain separate consumers.
- The adapter returns `null` when geometry is unavailable; it does not throw
  from a pointer event.

## Required Contract Tests

The implementation plan should require these tests before moving behavior:

1. A real browser test against xterm 5.5.0 proves selection coordinates are
   normalized to zero-based, end-exclusive ranges.
2. The same test enables terminal mouse tracking, calls the public `select()`,
   and proves the selection and `onSelectionChange` still work.
3. Normal and alternate buffers expose the expected `bufferType`, viewport,
   lines, and cells through the adapter.
4. Exact renderer cell dimensions and the screen element are returned after
   `open()` and fit/resize.
5. Missing or malformed private geometry returns `null` and leaves the terminal
   usable.
6. A package source-boundary test forbids `_core`, `_selectionService`,
   `_mouseService`, `_bufferService`, `_renderService`, `_model`, and
   `_fireEventIfSelectionChanged` outside the adapter. The adapter itself may
   contain only `_core`, `screenElement`, and `_renderService` from the approved
   shape. The existing touch-scroll telemetry read must move from
   `_core._bufferService` to the public `buffer.active` API in the same boundary
   slice.
7. A dependency test fails if the manifest no longer pins xterm and addon-fit
   exactly.

## Current-Code Impact

The current
[`selection-handles.ts`](../../../../packages/react-native-xtermjs-webview/src-internal/selection-handles.ts)
is 1,514 lines, with 1,452 nonblank lines and 43 references to private xterm
shapes. Its tests mostly build fake `_core` objects, so they prove the private
layout rather than the supported boundary.

The architecture plan can now replace those accesses without changing the user
behavior:

- public selection methods replace private model writes and refresh events;
- public buffer methods replace private buffer and work-cell reads;
- public events replace manual render calls caused by xterm state changes;
- public viewport APIs replace direct viewport scroll writes;
- one exact, guarded geometry read replaces the remaining private services;
- pure functions own coordinate, range, wide-cell, handle-anchor, and clamp
  calculations.

## Decision

Support xterm 5.5.0 exactly. Use public APIs for every selection operation and
buffer read. Keep one fail-closed adapter for exact render geometry, backed by a
real-browser conformance test. Do not build an addon, do not use decorations for
handles, and do not retain any direct private service or selection-model access.
