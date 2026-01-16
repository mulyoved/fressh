# Mobile Terminal Scrolling Feature - Deep Research Request

## Problem Statement

I have a React Native mobile app that connects to remote SSH servers and opens Tmux sessions. The terminal is rendered using xterm.js inside a WebView. I want **native tablet finger-drag scrolling** to control the **Tmux scrollback buffer** - so users can put their finger on the screen and drag up/down to scroll through terminal history, just like scrolling through any mobile app content.

**Current behavior:** Terminal scrolling is handled entirely within xterm.js (CSS overflow), and native touch gestures are blocked (`bounces: false`, `overScrollMode: 'never'`).

**Desired behavior:** Touch-drag gestures should scroll through Tmux's scrollback history (not just xterm.js's local buffer). The goal is ~3 pages of scrollback accessible via intuitive finger-drag, similar to scrolling a web page or document.

## Architecture Overview

### Stack
- **React Native** (Expo) mobile app
- **WebView** containing **xterm.js** terminal
- **Rust SSH client** (via UniFFI bindings) connecting to remote servers
- **Tmux** sessions on the remote server

### Data Flow
```
User's Tablet
     ↓
React Native App
     ↓
WebView (xterm.js renders terminal output)
     ↓
Rust SSH Bridge (ring buffer of terminal output)
     ↓
SSH Connection → Remote Server → Tmux Session
```

### Key Components

1. **xterm.js** - Renders terminal in WebView, has its own `scrollback: 10000` buffer, handles rendering and cursor positioning

2. **Tmux** - Runs on remote server, has separate scrollback buffer, copy-mode for scrolling (`prefix + [`), responds to mouse wheel events (if mouse mode enabled)

3. **WebView Bridge** - Messages between React Native and xterm.js via postMessage/injectJavaScript

4. **Rust SSH Shell** - Ring buffer stores terminal output locally, supports `readBuffer()` for replay

## Technical Challenges

### Challenge 1: Two Separate Scroll Buffers
- **xterm.js buffer**: Local in WebView, stores what was rendered
- **Tmux buffer**: Remote on server, authoritative source of scrollback
- These are NOT synchronized - xterm.js only knows what Tmux sent to display

### Challenge 2: Tmux Scroll Requires Copy-Mode
- Normal Tmux scroll requires entering "copy-mode" (`prefix + [`)
- In copy-mode, terminal enters alternate mode where normal input is blocked
- Scroll commands are `C-u`/`C-d` (half page), `PgUp`/`PgDn`, or mouse wheel
- This changes terminal state and visual appearance

### Challenge 3: Touch Gesture Translation
- Native touch scrolling expects immediate visual feedback
- Tmux scroll requires sending commands to remote server, waiting for response
- Round-trip latency (50-200ms) would make scrolling feel sluggish/unresponsive

### Challenge 4: Viewport Sync Problem
- If we scroll xterm.js locally, it shows stale content
- If we scroll Tmux remotely, we need to sync viewport position
- No direct way to query Tmux's current scroll position

## Potential Approaches (Need Research)

### Approach A: Fake Larger Terminal Screen
Idea: Configure Tmux/xterm with many more rows than visible, show only bottom portion, let native scroll show upper content.

Questions:
- Can we set terminal to 200 rows but only render 40 visible?
- How does xterm.js handle rendering with scrollback visible?
- Would Tmux alt-screen apps (vim, htop) break this?

### Approach B: Intercept Touch → Send Tmux Commands
Idea: Capture touch velocity, translate to Tmux copy-mode scroll commands, enter/exit copy-mode automatically.

Questions:
- Can we make copy-mode entry/exit seamless and invisible?
- How to handle latency (predictive scrolling? local estimation?)
- What about apps that use mouse tracking (vim, htop)?

### Approach C: Local Buffer Expansion
Idea: Store much more terminal output locally in Rust ring buffer, scroll through local history without touching Tmux.

Questions:
- Can we replay arbitrary positions from ring buffer to xterm.js?
- How to handle terminal state (colors, cursor) at arbitrary scroll positions?
- What about applications that clear screen or use alternate buffer?

### Approach D: Hybrid - Local Cache + Tmux Sync
Idea: Cache recent output locally, allow instant local scroll for cached content, sync with Tmux when scrolling beyond cache.

Questions:
- How to determine cache validity?
- How to handle divergence between local cache and Tmux state?
- What triggers refresh/resync?

### Approach E: Mouse Wheel Event Injection
Idea: Translate touch velocity to synthetic mouse wheel events, send to Tmux.

Questions:
- Does Tmux respond to mouse wheel outside copy-mode? (yes, with mouse mode)
- Can we enable Tmux mouse mode transparently?
- How to handle apps that disable mouse mode?

## Research Questions for GPT-5 Pro

1. **Tmux Internals**: What's the best way to programmatically scroll Tmux and retrieve scrollback content? Can we use `tmux capture-pane` or similar commands?

2. **xterm.js Capabilities**: Can xterm.js be configured to show a "virtual" larger buffer that we populate incrementally? Does it have APIs for injecting historical content at specific scroll positions?

3. **Terminal Protocol**: Are there escape sequences or control codes that allow scrolling viewport without entering copy-mode? ANSI scroll regions?

4. **Mobile UX Patterns**: How do other mobile terminal apps (Termux, iSH, Prompt, Blink) handle touch scrolling with remote connections?

5. **Latency Mitigation**: What techniques exist for making remote scroll feel responsive? (Predictive rendering, optimistic UI, rubber-banding?)

6. **Implementation Recommendation**: Given the architecture, what's the most practical approach that:
   - Works with 50-200ms latency
   - Doesn't break full-screen apps (vim, htop)
   - Provides intuitive finger-drag UX
   - Keeps Tmux as source of truth

## Constraints

- Must work with existing Tmux sessions (can't require special Tmux config)
- Must not break alternate screen buffer apps
- Should handle reconnection gracefully (scroll position preserved or reset)
- Target: ~3 pages of scrollback (enough to see recent command output)
- Acceptable latency for scroll response: < 100ms perceived

## Desired Output

Please provide:
1. Analysis of each approach's feasibility
2. Recommended approach with rationale
3. High-level implementation plan
4. Key technical challenges and solutions
5. Any prior art or reference implementations to study

---

## Attached Code Files

The following files show the current terminal implementation:

### File: packages/react-native-xtermjs-webview/src/index.tsx

React Native component wrapping WebView with xterm.js. Key points:
- `bounces: false` and `overScrollMode: 'never'` disable native scroll
- `scrollback: 10000` configured for xterm.js
- Bridge sends/receives messages via postMessage

### File: packages/react-native-xtermjs-webview/src-internal/main.tsx

xterm.js initialization inside WebView. Key points:
- Terminal created with FitAddon
- Touch handling for selection mode (overlay captures touch events)
- Message handler processes write/resize/fit commands

### File: packages/react-native-xtermjs-webview/src/bridge.ts

Type definitions for WebView ↔ React Native communication:
- `write`, `writeMany` - send terminal data
- `resize`, `fit` - terminal sizing
- Selection mode messages

### File: packages/react-native-uniffi-russh/src/api.ts

SSH connection and shell management:
- `startShell({ useTmux: true, tmuxSessionName })` - creates Tmux session
- `readBuffer({ mode: 'head' })` - replay terminal output from ring buffer
- `addListener()` - stream live terminal data
