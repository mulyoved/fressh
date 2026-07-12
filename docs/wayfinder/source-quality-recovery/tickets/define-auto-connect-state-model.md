---
title: Define the Auto-Connect Runtime State Model
status: closed
order: 110
labels:
  - wayfinder:prototype
parent: ../map.md
blocked_by: []
assignee:
---

## Question

What explicit state and event model should own initial connection, reconnect,
foreground-service coverage, app lifecycle, launch URLs, Tailscale recovery,
diagnostics, cancellation, and navigation intents outside React?

## Resolution

The approved answer is the
[Auto-Connect Runtime State Model Design](../../../superpowers/specs/2026-07-12-auto-connect-runtime-state-model-design.md).

A pure reducer owns one explicit automatic connection cycle. A small effect
runner performs attempts, cancellation, timing, foreground-service requests,
Tailscale actions, diagnostics, and versioned navigation intents through typed
ports. React only reports platform observations, renders published state, and
acknowledges navigation.

Reconnect and user recovery actions replace lower-priority work without overlap.
Missing foreground-service coverage is recorded but does not cancel work; the
runtime reconciles on resume. No eligible target is a normal skip, while every
real initial or reconnect failure publishes a host-page intent.
