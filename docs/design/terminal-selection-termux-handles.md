# Terminal Selection Termux Handles (WebView)

**Overall Progress:** `91%`

## Tasks:

- [x] 🟩 **Step 1: Replace teardrop glyph with Termux handle paths**
  - [x] 🟩 Update glyph geometry to 48×24 inside 48×48 hitbox (vertically centered)
  - [x] 🟩 Use Termux left/right SVG paths with no transforms
  - [x] 🟩 Set fill color to debug blue `#1A73E8`

- [x] 🟩 **Step 2: Align handles to selection edges**
  - [x] 🟩 Start handle aligns to left edge of start cell
  - [x] 🟩 End handle aligns to right edge of end cell (`endX + cellWidth`)
  - [x] 🟩 Keep current anchor logic (start at line top, end at line bottom)

- [ ] 🟨 **Step 3: Clamp behavior + debug outline**
  - [x] 🟩 When clamped at either side, swap drawable and shift glyph to keep flat edge aligned
  - [x] 🟩 Add dashed hitbox outline for debug (`1px dashed #ff3b30`)
  - [ ] 🟥 Remove debug outline after approval

- [x] 🟩 **Step 4: Rebuild WebView bundle**
  - [x] 🟩 Build dist-internal HTML
  - [x] 🟩 Build main bundle
