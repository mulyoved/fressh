# Terminal Listener Current-Handle Design

## Goal

Keep live shell output flowing after normal React renders recreate the xterm
imperative-handle object, without reconnecting SSH, replaying output, or
reattaching the native listener.

## Confirmed failure

The shell listener captures the xterm handle used during attachment. Its live
callback reuses the asynchronous attach-attempt freshness predicate, including
strict object identity with `xtermRef.current`.

`XtermJsWebView` publishes a newly created imperative-handle object after a
normal render. The native listener remains registered, but every later callback
fails the strict identity check before listener counters or `xterm.write`
advance. Tablet evidence shows native output continuing for more than ten
seconds while listener and renderer counters remain flat.

## Chosen design

Separate two kinds of freshness checks in the terminal lifecycle controller:

1. **Attach-attempt freshness** keeps the existing strict captured-handle
   identity check while asynchronous replay and listener registration are in
   progress. This prevents an obsolete attempt from committing ownership or
   writing replay into a replaced terminal runtime.
2. **Attached-listener freshness** checks controller disposal, generation,
   shell identity, runtime revision, and ready state, but does not compare the
   current xterm handle by object identity. After this check passes, each live
   event reads `getXterm()` and writes once to that current handle.

Runtime revision and generation remain the authority for a real WebView load,
shell replacement, detach, or disposal. A harmless replacement of the
imperative-handle object within the same runtime no longer invalidates live
delivery.

Listener counters advance immediately before the single write to the current
handle, preserving the diagnostics contract. If no current handle exists, the
event is ignored as it is today; the change adds no buffering, retry, replay,
flush, resize, reconnect, or listener reattachment.

## Alternatives rejected

### Stabilize the WebView imperative handle

The xterm package could expose one permanent proxy object. Every proxy method
would need to forward to the newest closures to avoid stale configuration and
state. That is a broader cross-package lifecycle change than the failing
listener requires.

### Reattach whenever handle identity changes

React ref changes are not observable state, so this requires extra publication
and synchronization. Reattachment also creates ownership, replay-cursor, and
output-gap risks for a change that does not represent a new terminal runtime.

## Error and lifecycle behavior

- Real load, detach, shell replacement, and disposal continue to invalidate
  callbacks through generation/runtime checks.
- A listener event uses the current handle at most once and preserves byte
  order.
- Existing write exceptions remain contained and logged without escaping into
  the native callback.
- No terminal content, keystrokes, private keys, command arguments, or raw SSH
  data are added to logs.

## Testing

Add a lifecycle regression test that:

1. attaches a listener and proves a control event reaches the original xterm;
2. replaces only the harness xterm handle object after attachment, leaving the
   shell and runtime unchanged;
3. invokes the already registered listener again;
4. proves the second event reaches the replacement handle exactly once and the
   listener counters advance.

Existing tests for a handle replacement during an unfinished attach must keep
passing, proving strict attach-attempt protection remains intact.

After unit and integration verification, build the Android preview APK locally,
install it in place over `com.finalapp.vibe2`, and repeat the controlled Work
switch. Native tail, listener bytes, RN sent bytes, WebView received bytes, and
xterm completed writes must all advance for the same connection, channel,
runtime instance, and WebView instance. Do not uninstall, clear application
data, or restart the remote tmux session.

## Scope

This fix changes only long-lived listener routing and its regression coverage.
The diagnostic counters remain in place for final tablet verification. Native
listener architecture, WebView bridge behavior, resize behavior, Work command
transport, and tmux control are out of scope.
