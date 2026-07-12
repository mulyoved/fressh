---
title: Define the Shell Runtime Ownership Model
status: closed
order: 50
labels:
  - wayfinder:prototype
parent: ../map.md
blocked_by: []
assignee:
---

## Question

What concrete ownership model makes route parsing, shell-session lifetime,
terminal transport, Workmux, scrollback, keyboard authority, diagnostics, and
Wispr automation explicit while leaving `ShellDetail` as a small composition and
rendering boundary?

## Resolution

The approved answer is the
[Shell Runtime Ownership Design](../../../superpowers/specs/2026-07-12-shell-runtime-ownership-design.md).

The design uses layered lifetime owners. A pure route parser produces either a
typed request or a recoverable error screen. A session controller owns the
screen lease, tmux target, Workmux channel, diagnostic context, and
reconnect-aware navigation, while the connection store remains the sole owner of
live SSH resources.

Terminal, scrollback, keyboard, and Wispr remain separate controllers with typed
ports and generation-bound calls. Scrollback is the only user-input gate, and
the session owner disposes Workmux only after registered cleanup runs through a
restricted retiring port. Wispr lives for the full screen session so its timers,
native calls, and pending cleanup have one owner.

`ShellDetail` is limited to parsing, controller construction, narrow port
wiring, view selection, and rendering. The design prohibits workflow refs,
direct native or transport calls, cleanup protocols, and inline diagnostic
construction in the screen, with source and lifecycle tests enforcing the
boundary.
