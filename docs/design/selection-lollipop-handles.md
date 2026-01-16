# Selection Lollipop Handles (WebView)

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Replace Termux paths with a single lollipop glyph**
  - [x] 🟩 Define a symmetric lollipop SVG path (circle + stem), allow small tweaks
  - [x] 🟩 Set viewBox to 48×48 and keep 48×48 hitbox with current scale multiplier
  - [x] 🟩 Keep debug blue fill `#1A73E8`

- [x] 🟩 **Step 2: Unify anchor placement**
  - [x] 🟩 Use a single anchor point `(24,24)` for both handles
  - [x] 🟩 Start = selection top‑left, End = selection bottom‑right
  - [x] 🟩 Remove left/right swapping and delta compensation logic

- [x] 🟩 **Step 3: Keep debug visuals**
  - [x] 🟩 Retain red hitbox + green bounds for tuning
  - [x] 🟩 No edge flipping logic (explicitly disabled)
