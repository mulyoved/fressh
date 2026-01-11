# Tmux Touch Scroll Copy-Mode Implementation Plan

**Overall Progress:** `80%`

## Tasks:

- [x] 🟩 **Step 1: Bridge contract + public surface**
  - [x] 🟩 Add inbound/outbound message types (instanceId, input.kind, tmuxEnterCopyMode request/ack, scrollbackModeChanged.phase)
  - [x] 🟩 Expose touchScrollConfig + exitScrollback + onScrollbackModeChange in XtermJsWebView

- [x] 🟩 **Step 2: WebView runtime controller**
  - [x] 🟩 Implement TouchScrollController (pointer events, copyModeState gate, pendingPointerUp, long-press cancel hook)
  - [x] 🟩 Emit scroll inputs as kind:'scroll', request tmuxEnterCopyMode, and publish scrollbackModeChanged phase
  - [x] 🟩 Enforce cancelKey-invalid behavior + touch-action / preventDefault rules

- [x] 🟩 **Step 3: RN integration + ordered writer**
  - [x] 🟩 Add per-connection ordered writer queue (batched segments + optional delay; no interleaving)
  - [x] 🟩 Handle tmuxEnterCopyMode by enqueuing prefix→delay→'[' batch and sending ack
  - [x] 🟩 Implement sendInputEnsuringLive (gated on active:true any phase, large-payload heuristic, cancelKey rules, instanceId filtering)

- [x] 🟩 **Step 4: App wiring + UI**
  - [x] 🟩 Enable feature for Android tablets (min dimension >= 600) with default tmux keys (prefix Ctrl-B, copyModeKey '[', cancelKey 'q', exitKey 'q', enterDelayMs 10)
  - [x] 🟩 Add RN scrollback pill overlay + Jump-to-live action; reset state on WebView init/reload

- [ ] 🟥 **Step 5: Manual validation**
  - [ ] 🟥 Drag scroll, fast flick during entry, paste while entering, large paste heuristic, invalid cancelKey blocking
  - [ ] 🟥 Verify long-press selection coexists and WebView reloads don't leak stale events
