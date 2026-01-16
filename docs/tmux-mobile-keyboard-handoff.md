# Mobile Tmux Keyboard — Designer Handoff Spec

## 1) Context & Goal
You are designing a **mobile-first keyboard/control surface** to operate a complex tmux workflow used for streaming, development, and AI assistance (Claude Code + Codex). The keyboard must allow **fast, reliable control of many tmux windows and panes** from a phone, without relying on the OS keyboard.

Primary goal: **one‑tap access to window/pane switching, core terminal keys, and command macros** for a complex, long‑running session.

Secondary goals:
- Support scroll/copy mode, repeatable paging, and selection tools.
- Provide safe access to “advanced” actions (session switch, window move, broadcast).

Last verified: **Dec 30, 2025**

---

## 2) Sources of Truth (Authoritative)
Tmux + environment:
- `/home/muly/cube9/dev-docs/dev-env/tmux.conf` (authoritative keybindings)
- `/home/muly/cube9/dev-docs/dev-env/tmux-short-keys.md` (reference)
- `/home/muly/tmux-bootstrap.sh` (actual live tmux bootstrap)
- `/home/muly/cube9/dev-docs/dev-env/generate-tmux.mjs` (how windows are generated)
- `/home/muly/bin/tmux-broadcast-window.sh`
- `/home/muly/cube9/dev-docs/dev-env/tmux-broadcast-bash.sh`

React control UI:
- `/home/muly/react-ttyd/example/nextjs/app/page.tsx` (mobile control surface)
- `/home/muly/react-ttyd/example/nextjs/app/example/page.tsx` (feature‑rich demo)
- `/home/muly/react-ttyd/example/nextjs/app/api/tmux-status/route.ts` (tmux status mapping)
- `/home/muly/react-ttyd/example/nextjs/app/configure.ts` (command presets)
- `/home/muly/react-ttyd/docs/V0-PROMPT.md` (original UI spec)

Clarifications (confirmed):
- **Pane mapping in** `/home/muly/react-ttyd/example/nextjs/app/api/tmux-status/route.ts` **is correct.**
- **Use dev‑env tmux.conf** as authoritative keybinding source.
- Legacy notes are ignored.

---

## 3) System Overview (What You’re Controlling)

### Sessions
- **main**: all dev windows
- **background**: PM2 + misc services

### Windows
- Windows are named `F0`…`F9` and mapped to Function keys.
- Windows represent separate environments/directories.

### Pane Layout (per window)
Each window uses a fixed 4‑pane layout:

```
┌─────────────┬─────────────┐
│   Claude    │    Codex    │  (pane 0, pane 3)
├─────────────┼─────────────┤
│   lazygit   │    bash     │  (pane 1, pane 2)
└─────────────┴─────────────┘
```

**Confirmed live mapping:**
- Pane 0 → Claude
- Pane 1 → lazygit
- Pane 2 → bash
- Pane 3 → Codex (shows as `node`)

---

## 4) Tmux Keybindings (Authoritative)

### Window Navigation
- `F1–F9` → windows 1–9
- `F10` → window 0
- `Ctrl+← / Ctrl+→` → prev/next **active** window (skips `~` windows)
- `Alt+← / Alt+→` → same as Ctrl+←/→
- `Alt+s` → toggle window inactive (`~` prefix)
- `Alt+y` → switch session (main ↔ background)
- `Alt+z` → move window between sessions

### Pane Navigation
**Direct jump (always zooms pane):**
- `Alt+c` → Claude (pane 0)
- `Alt+g` → lazygit (pane 1)
- `Alt+b` → bash (pane 2)
- `Alt+x` → Codex (pane 3)

**Cycle panes:**
- `Ctrl+↓ / Alt+↓` → forward (0→1→2→3→0)
- `Ctrl+↑ / Alt+↑` → backward (0→3→2→1→0)

### Other
- `PageUp` → copy/scroll mode
- Copy mode: `y`, `Enter`, or mouse drag (xclip)

---

## 5) Window Skip Feature
- `Alt+s` toggles window inactive by prefixing `~` to its name.
- `Ctrl/Alt+←/→` skip inactive windows.
- `F1–F10` always jump directly (active or inactive).

---

## 6) Broadcast / Automation
- **All panes in current window:**
  - `~/bin/tmux-broadcast-window.sh "command"`
- **Bash pane (pane 2) across all windows:**
  - `/home/muly/cube9/dev-docs/dev-env/tmux-broadcast-bash.sh "command"`

---

## 7) Remote Access Stack (Mobile Path)
- **ttyd** attaches to tmux `main` (port 7682).
- **react-ttyd** runs a Next.js UI (port 3002).
- **Tailscale proxies:**
  - `https://…:4003` → ttyd
  - `https://…:4002` → react-ttyd

**All key actions are sent as raw terminal sequences over ttyd.**

---

## 8) Current React Control Surface (Baseline)

### Main mobile UI
File: `/home/muly/react-ttyd/example/nextjs/app/page.tsx`

**Normal mode buttons (stripe):**
- Scroll Navigation Bar (PageUp + scroll mode)
- Next Active Window (Ctrl+Right)
- Cycle Pane (Ctrl+Down)
- Command Presets Panel
- Enter
- Esc
- Keys (toggle scroll menu without PageUp)
- Utilities Panel

**Utilities panel:**
- Next Window (All) → `Ctrl+B n`
- Toggle Window Inactive → `Alt+s`
- Close

**Scroll menu:**
- Esc, Ctrl+C, Tab, Enter
- Left, Right
- Home, End
- Page Up / Page Down (repeatable)
- Line Up / Line Down (repeatable)
- Paste dialog (legacy)
- Copy selection
- `fix`, `skip` macros
- Close Menu

**Status overlay:**
- Shows current `window + pane` via `/api/tmux-status` every 2 seconds.

### Command Presets (macros)
File: `/home/muly/react-ttyd/example/nextjs/app/configure.ts`
- `/review` (includes arrow + enter navigation)
- `/pr`
- `/clear`
- `/new`
- `/work-step-by-step`
- `/compact`
- `fix`
- `skip`
- `/git:cc-fix-pr`
- `/work-on-issue`

---

## 9) Control Sequences Used (must be supported)

**Tmux/navigation sequences:**
- Ctrl+Right → `\x1b[1;5C`
- Ctrl+Down → `\x1b[1;5B`
- Alt+s → `\x1bs`
- Ctrl+B n → `\x02n`

**Terminal keys:**
- Esc → `\x1b`
- Enter → `\r`
- Tab → `\t`
- Ctrl+C → `\x03`
- Arrow keys → `\x1b[A/B/C/D`
- Home/End → `\x1b[H`, `\x1b[F`
- Page Up/Down → `\x1b[5~`, `\x1b[6~`

---

## 10) What Needs to Be Designed (New Keyboard)

### A) Core keyboard layout (always visible)
- Window select (F1–F10) + prev/next active + next all
- Pane direct select (Claude / Git / Bash / Codex)
- Core keys: Enter, Esc, Ctrl+C, Tab
- Arrows (↑ ↓ ← →)
- Scroll controls (PageUp/Down) + copy mode entry

### B) Modes / panels
- Primary mode for high‑frequency actions
- Tmux mode for session/window controls
- Keys mode for extended terminal shortcuts
- Macros mode (command presets)

### C) Visual state & feedback
- Active window/pane highlight
- Inactive window marker (`~`)
- Connection status
- Scroll mode / repeat state

### D) Macro UX
- One‑tap command presets
- Support sequences with delays (menu navigation)

### E) Safety
- Advanced actions (session switch, move window, broadcast) should be visible but guarded

---

## 11) Deliverables Requested
- Primary keyboard layout (mobile portrait)
- Mode/panel behavior
- State system (active pane/window, scroll mode, repeat)
- Macro/preset UX
- Touch sizing guidance (46–52px height recommended)

---

## 12) Keyboard Heatmap (Priority Ranking)

**Tier 0 — Always visible**
- F1–F10 (windows)
- Pane direct select (Claude/Codex/Git/Bash)
- Enter / Esc / Ctrl+C / Tab
- Arrow keys

**Tier 1 — Always visible or one‑tap away**
- Next/Prev Active Window
- Cycle Pane (forward/back)
- Page Up / Page Down
- Home / End
- Scroll mode toggle

**Tier 2 — Fast‑access panel**
- Toggle inactive (Alt+s)
- Next window (all) (Ctrl+B n)
- Session switch (Alt+y)
- Move window (Alt+z)
- Copy / Paste

**Tier 3 — Presets / automation**
- `/review`, `/compact`, `/work-step-by-step`, `fix`, `skip`, etc.
- Broadcast actions (all panes / bash pane across windows)

---

## 13) Wireframe Button Cluster Plan (Sketchable)

**Cluster A — Status (top)**
- `F3 · Codex` (window + pane)
- Connection indicator

**Cluster B — Primary actions (always visible)**
- Window prev/next
- Pane direct select (Claude / Git / Bash / Codex)
- Enter / Esc / Ctrl+C / Tab
- Arrow cluster

**Cluster C — Scroll / navigation**
- Page Up / Page Down (repeat)
- Home / End
- Scroll mode exit

**Cluster D — tmux panel**
- F1–F10 grid
- Next‑All (Ctrl+B n)
- Toggle inactive (Alt+s)
- Session switch (Alt+y)
- Move window (Alt+z)

**Cluster E — Macros panel**
- `/review`, `/compact`, `/work-step-by-step`, `fix`, `skip`, etc.

**Cluster F — Utility**
- Copy selection
- Paste dialog
- Broadcast (all panes / bash pane)

---

## 14) Interaction Map (Modes + Behavior)

**Primary Mode (default)**
- Shows: window nav, pane select, Enter/Esc/Ctrl+C/Tab, arrows, PageUp/Down
- One‑tap actions only

**Scroll Mode**
- Shows: PageUp/Down, LineUp/Down, Home/End, Back
- Exit via Esc/Back

**tmux Mode**
- Shows: F1–F10 grid, Next‑All, Toggle inactive, Session switch, Move window

**Macros Mode**
- Shows: command preset buttons with labels
- Supports delayed sequences

**Global**
- If disconnected: show reconnect action only
- Hold‑repeat enabled for PageUp/Down + LineUp/Down
- Active pane/window visually highlighted

---

## 15) Notes for Implementation (Non‑Design)
- Key actions are sent as raw terminal sequences over ttyd.
- Some tmux actions are safer as explicit buttons (session switch / move window).
- The right‑stripe UI is already proven; new keyboard can retain this approach or expand if needed.

---

## 16) Summary (Design Drivers)
- **Speed:** One‑tap window and pane switches are the most critical feature.
- **Reliability:** Use established tmux sequences (F‑keys + Alt/Ctrl combos).
- **Clarity:** Always show active window/pane and connection state.
- **Safety:** Advanced actions should be accessible but not accidental.
- **Efficiency:** Presets and repeatable scroll controls reduce typing on mobile.

