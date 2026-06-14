# Work Key Walk Advanced Stripe Design

## Context

The mobile terminal keyboard has a top-row `Work` key that runs Workmux window
navigation. The key already has a selected walk mode, stored as the Workmux nav
scope:

- `active` (`Active`)
- `visible` (`+Busy`)
- `all` (`All`)

The Work key also already shows a compact scope badge so the user can see the
selected mode on the key. Long-pressing Work currently opens static options:
`Prev`, `Next`, then the three direct mode setters.

## Goal

Reorganize the Work key long-press stripe so it is useful for walking in the
opposite direction and for temporarily widening the walk mode without first
changing the selected Work mode.

## Non-Goals

- Do not change the selected Work mode when the user taps a temporary widened
  previous/next option.
- Do not change Workmux scope semantics or server-side filtering.
- Do not change long-press placement, gesture timing, or floating-stripe
  behavior.
- Do not redesign other keyboard long-press menus.

## UX

The Work long-press stripe shows six options:

1. Previous in the current selected mode.
2. Previous in the mode one level above the current selected mode.
3. Next in the mode one level above the current selected mode.
4. Set mode to `Active`.
5. Set mode to `+Busy`.
6. Set mode to `All`.

The widened mode ladder is capped at `All`:

```text
Active -> +Busy
+Busy  -> All
All    -> All
```

Examples:

```text
Current mode: Active
Prev Active | Prev +Busy | Next +Busy | Active | +Busy | All

Current mode: +Busy
Prev +Busy | Prev All | Next All | Active | +Busy | All

Current mode: All
Prev All | Prev All | Next All | Active | +Busy | All
```

The widened previous/next entries reuse the same Work scope badge/icon treatment
already used on the Work key. The visual language must stay consistent with the
existing mode indicator rather than introducing a second marker style.

## Architecture

Use a dynamic Work-key long-press menu.

`TerminalKeyboard` already receives the current Workmux nav scope and renders
the Work key's scope badge. When the Work key long-press stripe opens, the
keyboard should detect the actual Work slot (`WORKMUX_NAV_NEXT` with the Work
scope setter options) and derive the options from the current scope instead of
rendering the static configured options directly.

The dynamic options are:

```text
prev(currentScope)
prev(widen(currentScope))
next(widen(currentScope))
setScope(active)
setScope(visible)
setScope(all)
```

Non-Work long-press menus continue using their configured options unchanged.

## Command Behavior

The existing `WORKMUX_NAV_PREV` and `WORKMUX_NAV_NEXT` actions use the current
global Workmux nav scope. The widened previous/next options need a one-shot
scope override so they can run at the widened scope without changing the stored
selected mode.

The implementation should keep command execution on the existing Workmux
keyboard command path. Derived scoped navigation options carry one-shot metadata
for `{ action: 'prev' | 'next', scope }`; the keyboard action runner converts
that metadata into the same Workmux keyboard command shape used by normal
navigation, with the metadata scope as an override. Normal failure handling
stays the same as existing Workmux keyboard navigation.

The three mode selector options keep using the existing direct scope setter
actions:

- `WORKMUX_NAV_SCOPE_ACTIVE`
- `WORKMUX_NAV_SCOPE_VISIBLE`
- `WORKMUX_NAV_SCOPE_ALL`

## Edge Cases

- If the current scope is `all`, widened previous and widened next also use
  `all`.
- If the current scope cannot be determined, fall back to the configured
  long-press options rather than showing broken derived options.
- If a scoped one-shot nav command fails, surface the failure through the
  existing Workmux keyboard command failure path.
- If another key has Workmux nav actions in its long-press menu, do not assume it
  should receive the dynamic Work menu unless it is the actual Work key slot.

## Testing

Add focused tests for the scope-to-options helper:

- `active` produces previous active, previous visible, next visible, then the
  three mode setters.
- `visible` produces previous visible, previous all, next all, then the three
  mode setters.
- `all` produces previous all, previous all, next all, then the three mode
  setters.

Add component or integration coverage that:

- the Work key opens the dynamic options for each current scope;
- widened navigation sends the widened scope without changing the stored mode;
- the scope badge/icon treatment is present on scoped navigation options;
- non-Work long-press menus remain unchanged.
