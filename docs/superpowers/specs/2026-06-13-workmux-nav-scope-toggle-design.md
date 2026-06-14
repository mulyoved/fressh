# Workmux Window Nav Scope Toggle Design

## Context

Issue #105 asks to collapse the four Workmux window-navigation buttons on the
mobile keyboard into a single sticky toggle that controls whether navigation
moves through "active" or "all" windows, with an on-button indicator of the
current mode.

Today the advanced keyboard and the tmux keyboard each expose four separate nav
buttons — `Previous All`, `Previous`, `Next`, `Next All` — wired to four action
IDs (`WORKMUX_NAV_PREV_ALL`, `WORKMUX_NAV_PREV`, `WORKMUX_NAV_NEXT`,
`WORKMUX_NAV_NEXT_ALL`) in `apps/mobile/src/lib/keyboard-actions.ts`. Each maps
to a `mdev tmux app nav <next|prev|next-all|prev-all>` command. `next`/`prev`
walk "active" windows; `next-all`/`prev-all` walk every window. The advanced
keyboard also carries a duplicate `Prev all`/`Next all` pair on a second row.

Crucial constraint: the navigation *filtering* (which windows a step visits)
runs server-side in `mdev`, which lives in the separate `mulyoved/skills`
repository, not in Fressh. The mobile app only builds and sends nav commands; it
does not own window-state truth.

During design the scope grew from a two-way active/all toggle into a three-step
nested model based on the window-status vocabulary mdev already tracks.

## Window-state model

mdev annotates each tmux window with a status (`@workmux_status`):

- ✅ done/ready — finished, wants attention. Treated here as "active".
- 💬 waiting — needs input; also raises an Android notification.
- 🤖 working — an agent is running. Treated here as "busy".
- 🕒 parked / 💤 inactive — manually hidden via the status-cycle action.
- (empty) normal; plus internal "role" windows that never appear in the bar.

A window is "hidden" when it is not shown in the status bar (parked/inactive, or
otherwise omitted).

## Goal

Replace the four nav buttons on the advanced and tmux keyboards with three:
`Prev`, `Next`, and a sticky **scope toggle**. The toggle cycles a navigation
*scope level*; `Prev`/`Next` walk only the windows in the current scope. The
chosen scope persists across sessions.

### Scope levels (nested — each a superset of the previous)

| Level | Button label | Scope value | Windows included                        |
| ----- | ------------ | ----------- | --------------------------------------- |
| 1     | `Active`     | `active`    | ✅ ready (and 💬 waiting)                |
| 2     | `+Busy`      | `visible`   | active + 🤖 busy = every visible window |
| 3     | `All`        | `all`       | everything, including hidden windows    |

💬 waiting is folded into Level 1 (it wants attention). `all` is expected to
match mdev's existing `*-all` behavior; `visible` (active + busy, excluding
hidden) is the new middle tier mdev must add.

## Non-goals

- Implementing the mdev `--scope` filter itself. That is a separate task in
  `mulyoved/skills` and a hard dependency of this work (see Sequencing).
- Changing window status semantics, the status bar, or the status-cycle action.
- Touching the `phone_base` keyboard layout or its long-press nav menus.
- Pane/role focus movement (`WORKMUX_FOCUS_NEXT`/`WORKMUX_FOCUS_PREV`); that is
  separate from window nav and unchanged.

## UX

### Layout

On `advanced_keyboard` and `tmux_keyboard`, the nav cluster becomes three keys:
`‹ Prev`, `Next ›`, and the scope toggle. The advanced keyboard's duplicate
`Prev all`/`Next all` pair (its third row) is removed.

### Indicator (segmented pill)

The toggle renders as a 3-segment pill — `Active | +Busy | All` — with the
current level filled, reusing the keyboard's existing primary-highlight
treatment used for active modifier keys. It spans ~2 grid columns to fit three
short labels. The pill always shows all three stops so the ladder is visible;
the filled segment is the current scope.

### Interaction

- Tapping the pill advances the scope: Active → +Busy → All → Active. This is a
  **local** state change only — no command is sent to the remote.
- Tapping `Prev`/`Next` sends a scope-aware nav command for the current scope.
- The scope is **global** (one value app-wide) and **sticky** (persisted). The
  default is `active` (Level 1), matching today's plain `next` narrowness.

## Architecture (Approach A — mdev owns filtering)

The window-state truth and the nav filtering stay in mdev. The app holds the
sticky scope locally and includes it on every nav command. mdev resolves the
scope against window status.

### mdev command contract (dependency)

Extend the existing nav verb with a scope argument:

```
mdev tmux app nav <next|prev> --scope <active|visible|all> --session <name>
```

- `active` — visit only ✅ (and 💬) windows.
- `visible` — visit ✅ + 🤖 windows (exclude hidden). New behavior.
- `all` — visit every window; equivalent to today's `next-all`/`prev-all`.

The `select <index>` verb is unchanged. mdev should accept `--scope` on
`next`/`prev`; absent the flag it keeps current behavior.

### Sequencing

Ship the mdev `--scope` support first (the same author owns `mulyoved/skills`).
The mobile app only emits `--scope` once mdev understands it, so there is no
version-skew window where the app sends a flag mdev rejects. (If parallel work
were needed, the alternative is a capability check before emitting `--scope`;
not planned.)

## Mobile implementation

Touch-points (all under `apps/mobile`):

1. **Sticky scope store** — a small MMKV-backed value in
   `src/lib/preferences.tsx` (or a dedicated module), typed
   `'active' | 'visible' | 'all'`, default `'active'`, with a `cycle()` that
   advances to the next level. If exposed as a hook that returns a handle/object,
   wrap the returned handle in `useMemo` so consumer `useEffect` cleanups do not
   churn (existing project caveat for custom hooks in `src/lib/`).

2. **`src/lib/workmux-app-commands.ts`** — `buildWorkmuxAppNavArgv` and
   `buildWorkmuxAppNavCommand` gain an optional `scope` that appends
   `--scope <value>` for `next`/`prev`. `WorkmuxNavAction` is unchanged
   (`next`/`prev`/`next-all`/`prev-all`/`select`).

3. **`src/lib/keyboard-actions.ts`**
   - `WORKMUX_NAV_NEXT` / `WORKMUX_NAV_PREV` become scope-aware: their command
     carries the current sticky scope. Keyboards without a toggle (e.g.
     `phone_base`) therefore navigate at the global scope — `active` by default,
     matching today's effective behavior.
   - Add `WORKMUX_CYCLE_NAV_SCOPE` for the toggle: cycles the sticky scope
     locally and sends nothing remote.
   - Keep `WORKMUX_NAV_NEXT_ALL` / `WORKMUX_NAV_PREV_ALL` as back-compat
     shortcuts that always navigate `scope=all`. They stay available for
     `phone_base` and any runtime config that references them.
   - Thread the scope into the `WorkmuxKeyboardCommand` `nav` variant.

4. **`src/lib/workmux-bridge-operations.ts` / `workmux-control-channel.ts`** —
   thread the optional scope param through the nav path so the bridge and
   control-channel transports carry it.

5. **`src/app/shell/components/TerminalKeyboard.tsx`** — render the scope
   toggle: an action-driven key that reads the sticky scope and draws the
   3-segment pill, special-cased like the existing modifier-active highlight. Tap
   dispatches `WORKMUX_CYCLE_NAV_SCOPE`.

6. **`config/shell-config.json`** — redesign the nav clusters in
   `advanced_keyboard` and `tmux_keyboard`: `Prev`, `Next`, scope toggle
   (spanning ~2 columns). Remove the advanced keyboard's row-3 duplicate
   `Prev all`/`Next all`. Leave `phone_base` as-is.

### Stateful-button note

Keyboard slots are currently static. The toggle is the first key that both
renders dynamic state (the current scope) and mutates local state on press. The
existing modifier-key highlight in `TerminalKeyboard.tsx` is the precedent for a
slot whose appearance depends on runtime state; the scope toggle follows that
pattern, reading the sticky scope to choose the filled segment.

## Edge cases

- **Current window outside the active scope** (e.g. you are on a hidden window
  but scope is `active`): mdev decides the target; the app only sends the verb.
- **Empty scope** (no windows match, e.g. no ✅ windows): mdev no-ops and the app
  surfaces mdev's message through the existing nav failure path.
- **Wrap-around**: unchanged; mdev owns ordering and wrap.
- **Version skew**: avoided by shipping mdev first.

## Testing

- `test/integration/workmux-app-commands.test.ts` — argv/command includes
  `--scope` for `next`/`prev`, omits it for `select`, and the `all` back-compat
  path is exercised.
- `test/integration/keyboard-actions.test.ts` — `WORKMUX_CYCLE_NAV_SCOPE`
  advances the sticky scope and sends nothing remote; `WORKMUX_NAV_NEXT`/`_PREV`
  inject the current scope; `_ALL` still maps to `scope=all`.
- `test/integration/keyboard-config.test.ts` — the advanced and tmux nav
  clusters are the new three keys; no `*_ALL` slots remain on those keyboards;
  `phone_base` is unchanged.
- `test/integration/workmux-control-channel.test.ts` and
  `workmux-bridge-operations.test.ts` — scope threads through the transports.
- Toggle rendering — a component test that the pill reflects the sticky scope and
  cycles on press.

## Resolved decisions

- Interaction: three buttons (Prev, Next, sticky scope toggle).
- Indicator: 3-segment pill, current segment filled.
- Scope model: nested Active ⊂ +Busy (`visible`) ⊂ All; 💬 waiting folded into
  Active.
- Filtering lives in mdev via `--scope`; the app holds the sticky scope locally.
- Persistence: global, MMKV-backed, default `active`.
- Keyboards: advanced + tmux redesigned; `phone_base` untouched; `_ALL` action
  IDs kept as back-compat.
- Sequencing: mdev `--scope` ships first.
