# Teardrop Handle Drawing Code (Current)

This document captures the **exact code** currently used to draw the teardrop
selection handles in the WebView (xterm.js) overlay.

## Geometry + Offsets (constants)

```ts
// Teardrop handle geometry; tip offsets align the glyph tip to the anchor point.
const selectionHandleSizePx = 48;
const selectionHandleGlyphWidthPx = 18;
const selectionHandleGlyphHeightPx = 28;
const selectionHandleGlyphLeftPx =
	(selectionHandleSizePx - selectionHandleGlyphWidthPx) / 2;
const selectionHandleGlyphTopPx = 0;
const selectionHandleTipXStartPx = 14;
const selectionHandleTipXEndPx = 4;
const selectionHandleTipOffsetXStartPx =
	selectionHandleGlyphLeftPx + selectionHandleTipXStartPx;
const selectionHandleTipOffsetXEndPx =
	selectionHandleGlyphLeftPx + selectionHandleTipXEndPx;
const selectionHandleTipOffsetYStartPx =
	selectionHandleGlyphTopPx + selectionHandleGlyphHeightPx;
const selectionHandleTipOffsetYEndPx = selectionHandleGlyphTopPx;
```

## CSS (glyph + color)

```css
.fressh-selection-handle {
	position: absolute;
	width: 48px;
	height: 48px;
	background: transparent;
	touch-action: none;
	z-index: 30;
	pointer-events: auto;
}

.fressh-selection-handle-glyph {
	position: absolute;
	left: 15px;
	top: 0px;
	width: 18px;
	height: 28px;
}

.fressh-selection-handle-glyph path {
	/* Temporary debug color to confirm updated teardrop rendering. */
	fill: #1a73e8;
	pointer-events: none;
}
```

## SVG Path + Orientation Logic

```ts
const ensureHandleGlyph = (
	handle: HTMLDivElement,
	kind: 'start' | 'end',
) => {
	if (handle.dataset.glyph === kind) return;
	handle.textContent = '';
	handle.dataset.glyph = kind;
	const glyph = document.createElement('div');
	glyph.className = 'fressh-selection-handle-glyph';
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', String(selectionHandleGlyphWidthPx));
	svg.setAttribute('height', String(selectionHandleGlyphHeightPx));
	svg.setAttribute('viewBox', '0 0 18 28');
	const path = document.createElementNS(
		'http://www.w3.org/2000/svg',
		'path',
	);
	path.setAttribute(
		'd',
		'M14 0 C8 0 0 6 0 14 C0 22 6 28 9 28 C13 28 18 23 18 18 C18 10 17 3 14 0 Z',
	);
	if (kind === 'start') {
		const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		g.setAttribute(
			'transform',
			`translate(0, ${selectionHandleGlyphHeightPx}) scale(1, -1)`,
		);
		g.appendChild(path);
		svg.appendChild(g);
	} else if (kind === 'end') {
		const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		g.setAttribute(
			'transform',
			`translate(${selectionHandleGlyphWidthPx}, 0) scale(-1, 1)`,
		);
		g.appendChild(path);
		svg.appendChild(g);
	} else {
		svg.appendChild(path);
	}
	glyph.appendChild(svg);
	handle.appendChild(glyph);
};
```
