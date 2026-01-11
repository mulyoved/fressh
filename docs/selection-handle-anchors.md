# Selection Handle Anchors & Flip Behavior (Dev Notes)

This document captures the **anchor model**, **flip rules**, and the reasons we
had trouble getting consistent behavior. It is meant to onboard a new developer
quickly so they can continue the work.

## Goal

We want selection handles that:
1) **Anchor to the selection corner** (screen space) without jumping.
2) **Flip** when the handle’s **actual shape** hits the screen edge.
3) Allow the **red hitbox** to go off‑screen (no layout resize).
4) Keep the **green “shape bounds” box** aligned to the shape, and use it for
   flip decisions.

## Visual Debug Aids

- **Red dashed box** = full handle hitbox (48×48 * scale).
- **Green box** = actual **shape bounds** (SVG path bounds).

Flip should trigger when the **green box** hits the edge — not the red hitbox.

## Anchor Model

We anchor in **screen space** to the selection corners, but the **glyph’s anchor
point** is a specific corner of the green box:

### Start handle
- **Screen anchor:** **top‑left corner** of selection
  - `anchorX = left edge of start cell`
  - `anchorY = top edge of start row`
- **Glyph anchor:** **bottom‑right corner** of the green box

### End handle
- **Screen anchor:** **bottom‑right corner** of selection
  - `anchorX = right edge of end cell`
  - `anchorY = bottom edge of end row`
- **Glyph anchor:** **top‑left corner** of the green box

This asymmetry is intentional (requested) and is the core source of confusion.

## Expected Flip Behavior

When a flip occurs:
1) **The anchor point must stay fixed in screen space**.
2) Only the *shape* should swap sides around that anchor.

### Start handle flip (hits left edge)

Anchor is the **right edge** of the green box:

Before:
```
|  [##########*]
   * = right edge anchor
```
After flip:
```
|    [*##########]
```
The `*` stays in the same screen position.

### End handle flip (hits right edge)

Anchor is the **left edge** of the green box:

Before:
```
[*##########]  |
* = left edge anchor
```
After flip:
```
[##########*]  |
```
The `*` stays in the same screen position.

## Why This Is Tricky

1) **SVG paths are asymmetric**  
   The Termux left/right shapes are not perfect mirrors. Simply swapping paths
   causes the anchor to shift. We must compensate by **measuring the path bounds**
   (green box) and shifting the glyph by the delta between old vs new anchors.

2) **Hitbox vs glyph mismatch**  
   The hitbox (red) is 48×48, but the glyph is 48×24. If you clamp by the hitbox,
   flips trigger too early. We must clamp by the **green box** (actual glyph
   bounds).

3) **Anchor is different per handle**  
   Start uses bottom‑right of green box, end uses top‑left. This means the math
   must be explicit per handle.

4) **Handle overflow should not resize page**  
   Allow the red hitbox to go off‑screen without causing layout/scroll changes.
   We set `overflow: hidden` on `html/body/root` to prevent page resize.

## Current Flip Logic Summary

- Use `getBBox()` on the SVG path to compute **exact green bounds**.
- Flip trigger: when green bounds touch screen edge.
- Flip action: swap the drawable (left ↔ right) **and shift** by delta between
  old vs new anchor positions so the anchor does **not move**.

## Reading List (Relevant Code)

### WebView HTML/selection logic
- `packages/react-native-xtermjs-webview/src-internal/main.tsx`
  - `ensureSelectionModeStyle` (red/green debug boxes)
  - `ensureHandleGlyph` (SVG paths)
  - `getHandleGlyphBounds` / `getGlyphBoundsForKind` (green bounds)
  - `renderSelectionHandles` (anchor placement + flip)
  - `clampHandlePosition` (flip trigger, now based on green bounds)
  - `setHandleGlyphLeft` / `setHandleGlyphTop` (glyph shifting)

### WebView wrapper (dev server)
- `packages/react-native-xtermjs-webview/src/index.tsx`
  - `devServerUrl` override for loading internal HTML via Vite

### Terminal screen integration
- `apps/mobile/src/app/shell/detail.tsx`
  - Config menu link
  - Xterm options + selection color

### Debug / config constants
- `apps/mobile/src/lib/keyboard-actions.ts`
  - `HANDLE_DEV_SERVER_URL`

## Suggested Workflow for Tuning

1) Run dev server:
   ```
   pnpm --filter @fressh/react-native-xtermjs-webview dev -- --host 0.0.0.0 --port 5173
   ```
2) Open:
   - Tablet browser: `http://100.122.2.100:5173/`
   - Or in-app link (Config → Handle dev server)
3) Adjust `main.tsx`, refresh page (no rebuilds needed for internal HTML).
4) Once approved, rebuild:
   ```
   pnpm --filter @fressh/react-native-xtermjs-webview build:internal
   pnpm --filter @fressh/react-native-xtermjs-webview build:main
   ```

## Open Questions / Follow-ups

- Should vertical flips (top/bottom edges) use the same anchor logic as
  horizontal flips?
- Should the green bounds be expanded by a small margin for flip hysteresis?
