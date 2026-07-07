# Inline Tailscale Connect UI Design

## Problem

The Tailscale recovery controls currently render from `AutoConnectManager` at
the app root. The visual component is named `TailscaleRecoveryBanner`, uses
absolute positioning, and has a high z-index. That makes it feel like a
separate popover layered over the app instead of part of the Connect interface.

The intended behavior is narrower: Tailscale attention should appear only in
the Connect tab, where the user already manages SSH connection state.

## Goals

- Render Tailscale recovery UI as part of the Connect tab.
- Remove the app-wide overlay behavior for Tailscale attention.
- Keep the existing Tailscale recovery state and actions: `Open Tailscale`,
  `Retry`, and `Reset`.
- Preserve automatic recovery and reconnect policy in `AutoConnectManager`.
- Make the UI read as an inline connection status panel, not a separate screen
  or floating banner.

## Non-Goals

- Changing Tailscale native recovery behavior.
- Changing SSH connect, reconnect, saved connection, or foreground service
  policy.
- Showing Tailscale recovery UI on Shell, Settings, or other tabs.
- Building a new Tailscale setup or onboarding flow.

## Design

Move Tailscale recovery presentation out of the root overlay and into the
Connect screen.

`AutoConnectManager` remains responsible for automatic connect/reconnect and
Tailscale recovery actions, but it should stop rendering
`TailscaleRecoveryBanner` directly. Instead, it should expose the current
Tailscale recovery UI state and action handlers through a small shared store or
hook.

The Connect tab reads that state and renders a new inline component above the
SSH form card:

- hidden state renders nothing;
- `needsAttention` renders a compact panel with title, message, and actions;
- `recovering` renders the same panel with disabled actions and the current
  recovery message.

Rename `getTailscaleRecoveryBannerPresentation` to a neutral presentation
helper only if that can be done without broad churn; otherwise keep the helper
name and reuse its existing behavior. The visual implementation must not use
absolute positioning, safe-area top padding, or app-level z-index. It must use
normal Connect tab layout spacing inside the existing `ScrollView`.

## Component Boundary

Use two pieces:

- `tailscale-recovery-ui-store`: owns only display state and callbacks for
  `open`, `retry`, and `reset`.
- `TailscaleRecoveryPanel`: presentational Connect-tab component that renders
  the current state inline.

`AutoConnectManager` writes to the store when automatic recovery needs user
attention and registers the action handlers it already owns. The Connect tab
subscribes to the store and passes the state/actions into the panel.

This keeps recovery policy with auto-connect while letting the Connect screen
own the UI placement.

## Data Flow

1. `AutoConnectManager` detects that automatic Tailscale recovery needs user
   attention.
2. It updates shared Tailscale recovery UI state to `needsAttention` or
   `recovering`.
3. The Connect tab observes the state and renders `TailscaleRecoveryPanel`
   inline above the SSH connection form.
4. Pressing `Open Tailscale`, `Retry`, or `Reset` invokes the action handlers
   registered by `AutoConnectManager`.
5. When recovery clears, the shared state returns to hidden and the Connect tab
   removes the panel from layout.

## Error Handling

If action handlers are not registered while a visible state exists, the panel
must render with disabled actions. It must not crash the Connect screen.

Recovering state should keep the existing disabled-action behavior. Existing
recovery messages remain the source of truth so no new error classification is
introduced.

## Testing

Add or update unit tests for the presentation helper so hidden, attention, and
recovering states still map to the expected labels and disabled states.

Add focused tests for the UI store:

- hidden is the default state;
- attention and recovering updates are observable;
- clearing state hides the panel;
- missing handlers are handled without throwing.

Add a Connect screen integration test or the nearest available component-level
test that verifies the panel is rendered by the Connect screen when the store
reports `needsAttention`.

Manual Android preview verification:

1. Trigger a Tailscale attention state.
2. Confirm the controls appear inside the Connect tab above the SSH form.
3. Confirm Shell, Settings, and other tabs do not show the Tailscale panel.
4. Confirm `Open Tailscale`, `Retry`, and `Reset` still invoke the same
   recovery actions.

## Acceptance Criteria

- Tailscale recovery UI no longer renders as an app-wide absolute overlay.
- The recovery UI appears only inside the Connect tab.
- The inline panel uses normal Connect screen layout and does not cover other
  content.
- Existing recovery actions and disabled/recovering states continue to work.
- Tests cover the presentation state and the shared UI handoff between
  `AutoConnectManager` and the Connect tab.
