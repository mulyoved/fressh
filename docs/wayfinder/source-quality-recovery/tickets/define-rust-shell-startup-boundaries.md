---
title: Define the Rust Shell-Startup Module Boundaries
status: closed
order: 130
labels:
  - wayfinder:prototype
parent: ../map.md
blocked_by: []
assignee:
---

## Question

What minimal Rust module and type boundaries make PTY negotiation, Workmux
probing, shell buffering, channel-message handling, reader lifetime, and session
registration independently understandable without creating a new abstraction
stack?

## Resolution

The approved answer is the
[Rust Shell-Startup Module Boundaries Design](../../../superpowers/specs/2026-07-12-rust-shell-startup-module-boundaries-design.md).

The public `startShell()` API remains unchanged. A short startup coordinator
uses four sibling owners: `ShellBuffer`, a dedicated reader and one-shot close
notifier, and `ShellRegistry`. PTY and Workmux phase types stay private inside
startup, while one pure channel-message classifier is shared by probing and the
live reader.

The design preserves current timeouts, output buffering, Workmux disconnect
behavior, callback containment, and registration-race handling. It rejects
generic traits, builders, facades, and lifecycle supervisors, and adds exact
module, function-size, race-test, and in-process SSH test guardrails.
