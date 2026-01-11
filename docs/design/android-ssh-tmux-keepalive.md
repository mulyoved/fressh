# Android SSH Tmux + Keepalive Plan

**Overall Progress:** `87%`

## Tasks:

- [x] 🟩 **Step 1: Update connection schema and migration behavior**
  - [x] 🟩 Add per-connection fields: `useTmux`, `tmuxSessionName`, `autoConnect` in `connectionDetailsSchema`
  - [x] 🟩 Default new connections to `useTmux: true`, `tmuxSessionName: 'main'`, `autoConnect: false`
  - [x] 🟩 Hard-delete saved password entries on load/migration
  - [x] 🟩 For legacy entries missing tmux fields, block connect and route to edit form (prompt on connect)

- [x] 🟩 **Step 2: Update connection form UI**
  - [x] 🟩 Remove password inputs and password security option
  - [x] 🟩 Add tmux toggle + required session name field (default `main`)
  - [x] 🟩 Add auto-connect toggle per connection
  - [x] 🟩 Ensure validation prevents connect when tmux enabled but name missing

- [x] 🟩 **Step 3: Rust keepalive defaults**
  - [x] 🟩 Set `keepalive_interval = 30s` and `keepalive_max = 3` in `russh::client::Config`
  - [x] 🟩 Keep values as Rust constants (no JS/UI exposure)

- [x] 🟩 **Step 4: Tmux attach execution + failure detection (Rust)**
  - [x] 🟩 Add tmux options to `StartShellOptions` (use tmux + session name)
  - [x] 🟩 After PTY request, run `exec("tmux attach -t <name>")` when enabled
  - [x] 🟩 Detect non-zero exit/close status and propagate an error for blocking UI
  - [x] 🟩 Disconnect immediately on tmux failure

- [x] 🟩 **Step 5: UniFFI + JS wrapper updates**
  - [x] 🟩 Plumb new `StartShellOptions` fields through UniFFI API
  - [x] 🟩 Update JS wrapper types and mappings in `@fressh/react-native-uniffi-russh`
  - [x] 🟩 Regenerate UniFFI bindings (no hand edits)

- [x] 🟩 **Step 6: Auto-connect filtering**
  - [x] 🟩 Only consider saved connections with `autoConnect: true`

- [x] 🟩 **Step 7: Shell detail blocking error UI**
  - [x] 🟩 Show a blocking error screen on tmux attach failure
  - [x] 🟩 Offer a single recovery path (edit connection to fix tmux settings)

- [ ] 🟥 **Step 8: Manual verification checklist**
  - [ ] 🟥 New connection defaults: tmux enabled, session name `main`
  - [ ] 🟥 Legacy connection prompts for tmux settings before connect
  - [ ] 🟥 tmux attach failure shows blocking error and disconnects
  - [ ] 🟥 Auto-connect only works for entries with `autoConnect: true`
  - [ ] 🟥 Background drops still reconnect on resume; keepalive active while foreground
