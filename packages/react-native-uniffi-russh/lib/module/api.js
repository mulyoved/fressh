"use strict";

/**
 * We cannot make the generated code match this API exactly because uniffi
 * - Doesn't support ts literals for rust enums
 * - Doesn't support passing a js object with methods and properties to or from rust.
 *
 * The second issue is much harder to get around than the first.
 * In practice it means that if you want to pass an object with callbacks and props to rust, it need to be in seperate args.
 * If you want to pass an object with callbacks and props from rust to js (like ssh handles), you need to instead only pass an object with callbacks
 * just make one of the callbacks a sync info() callback.
 *
 * Then in this api wrapper we can smooth over those rough edges.
 * See: - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
 */
import * as GeneratedRussh from "./index.js";

// #region Ideal API

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This status is only to provide updates for discrete events
 * during the connect() promise.
 *
 * It is no longer relevant after the connect() promise is resolved.
 */

// SSH protocol negotiation complete

// no replay, live only

// ─────────────────────────────────────────────────────────────────────────────
// Handles
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES = Number(GeneratedRussh.defaultRunCommandMaxOutputBytes());
export const MAX_RUN_COMMAND_MAX_OUTPUT_BYTES = Number(GeneratedRussh.maxRunCommandMaxOutputBytes());
function traceStack(label) {
  return (new Error(label).stack ?? '').split('\n').slice(1, 10);
}
function describeSignal(signal) {
  if (!signal) {
    return {
      hasSignal: false,
      aborted: false,
      reason: undefined
    };
  }
  const reason = signal.reason;
  return {
    hasSignal: true,
    aborted: signal.aborted,
    reason: reason === undefined ? undefined : reason instanceof Error ? {
      name: reason.name,
      message: reason.message
    } : String(reason)
  };
}
function isRusshApiTraceEnabled() {
  return process.env.FRESSH_RUSSH_TRACE !== undefined;
}
function traceRusshApi(message, meta) {
  if (!isRusshApiTraceEnabled()) return;
  console.info(`RusshApiTrace ${message}`, meta);
}
function maxOutputBytesToGenerated(maxOutputBytes) {
  if (maxOutputBytes === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(maxOutputBytes)) {
    throw new Error('maxOutputBytes must be a safe integer');
  }
  if (maxOutputBytes <= 0) {
    throw new Error('maxOutputBytes must be greater than 0');
  }
  if (maxOutputBytes > MAX_RUN_COMMAND_MAX_OUTPUT_BYTES) {
    throw new Error(`maxOutputBytes must be at most ${MAX_RUN_COMMAND_MAX_OUTPUT_BYTES}`);
  }
  return BigInt(maxOutputBytes);
}
// #endregion

// #region Wrapper to match the ideal API

const terminalTypeLiteralToEnum = {
  Vanilla: GeneratedRussh.TerminalType.Vanilla,
  Vt100: GeneratedRussh.TerminalType.Vt100,
  Vt102: GeneratedRussh.TerminalType.Vt102,
  Vt220: GeneratedRussh.TerminalType.Vt220,
  Ansi: GeneratedRussh.TerminalType.Ansi,
  Xterm: GeneratedRussh.TerminalType.Xterm,
  Xterm256: GeneratedRussh.TerminalType.Xterm256
};
const terminalTypeEnumToLiteral = {
  [GeneratedRussh.TerminalType.Vanilla]: 'Vanilla',
  [GeneratedRussh.TerminalType.Vt100]: 'Vt100',
  [GeneratedRussh.TerminalType.Vt102]: 'Vt102',
  [GeneratedRussh.TerminalType.Vt220]: 'Vt220',
  [GeneratedRussh.TerminalType.Ansi]: 'Ansi',
  [GeneratedRussh.TerminalType.Xterm]: 'Xterm',
  [GeneratedRussh.TerminalType.Xterm256]: 'Xterm256'
};
const sshConnProgressEnumToLiteral = {
  [GeneratedRussh.SshConnectionProgressEvent.TcpConnected]: 'tcpConnected',
  [GeneratedRussh.SshConnectionProgressEvent.SshHandshake]: 'sshHandshake'
};
const streamEnumToLiteral = {
  [GeneratedRussh.StreamKind.Stdout]: 'stdout',
  [GeneratedRussh.StreamKind.Stderr]: 'stderr'
};
function generatedConnDetailsToIdeal(details) {
  const security = details.security instanceof GeneratedRussh.Security.Password ? {
    type: 'password',
    password: details.security.inner.password
  } : {
    type: 'key',
    privateKey: details.security.inner.privateKeyContent
  };
  return {
    host: details.host,
    port: details.port,
    username: details.username,
    security
  };
}
function cursorToGenerated(cursor) {
  switch (cursor.mode) {
    case 'head':
      return new GeneratedRussh.Cursor.Head();
    case 'tailBytes':
      return new GeneratedRussh.Cursor.TailBytes({
        bytes: cursor.bytes
      });
    case 'seq':
      return new GeneratedRussh.Cursor.Seq({
        seq: cursor.seq
      });
    case 'time':
      return new GeneratedRussh.Cursor.TimeMs({
        tMs: cursor.tMs
      });
    case 'live':
      return new GeneratedRussh.Cursor.Live();
  }
}
function toTerminalChunk(ch) {
  return {
    seq: ch.seq,
    tMs: ch.tMs,
    stream: streamEnumToLiteral[ch.stream],
    bytes: ch.bytes
  };
}
function wrapShellSession(shell) {
  const info = shell.getInfo();
  const readBuffer = (cursor, maxBytes) => {
    const res = shell.readBuffer(cursorToGenerated(cursor), maxBytes);
    return {
      chunks: res.chunks.map(toTerminalChunk),
      nextSeq: res.nextSeq,
      dropped: res.dropped
    };
  };
  const addListener = (cb, opts) => {
    const listener = {
      onEvent: ev => {
        if (ev instanceof GeneratedRussh.ShellEvent.Chunk) {
          cb(toTerminalChunk(ev.inner[0]));
        } else if (ev instanceof GeneratedRussh.ShellEvent.Dropped) {
          cb({
            kind: 'dropped',
            fromSeq: ev.inner.fromSeq,
            toSeq: ev.inner.toSeq
          });
        }
      }
    };
    try {
      const id = shell.addListener(listener, {
        cursor: cursorToGenerated(opts.cursor),
        coalesceMs: opts.coalesceMs
      });
      if (id === 0n) {
        throw new Error('Failed to attach shell listener (id=0)');
      }
      return id;
    } catch (e) {
      throw new Error(`addListener failed: ${String(e?.message ?? e)}`);
    }
  };
  return {
    channelId: info.channelId,
    createdAtMs: info.createdAtMs,
    pty: terminalTypeEnumToLiteral[info.term],
    connectionId: info.connectionId,
    sendData: (data, o) => shell.sendData(data, o?.signal ? {
      signal: o.signal
    } : undefined),
    close: o => {
      traceRusshApi('shell close requested', {
        connectionId: info.connectionId,
        channelId: info.channelId,
        signal: describeSignal(o?.signal),
        stack: traceStack('RusshApiTrace shell close requested')
      });
      return shell.close(o?.signal ? {
        signal: o.signal
      } : undefined);
    },
    resizePty: (cols, rows, o) => shell.resizePty(cols, rows, o?.pixelWidth ?? undefined, o?.pixelHeight ?? undefined, o?.signal ? {
      signal: o.signal
    } : undefined),
    // setBufferPolicy,
    bufferStats: () => shell.bufferStats(),
    currentSeq: () => shell.currentSeq(),
    readBuffer,
    addListener,
    removeListener: id => shell.removeListener(id)
  };
}
function toCommandStreamEvent(event) {
  if (event instanceof GeneratedRussh.CommandStreamEvent.Stdout) {
    return {
      type: 'stdout',
      bytes: event.inner.bytes
    };
  }
  if (event instanceof GeneratedRussh.CommandStreamEvent.Stderr) {
    return {
      type: 'stderr',
      bytes: event.inner.bytes
    };
  }
  if (event instanceof GeneratedRussh.CommandStreamEvent.ExitStatus) {
    return {
      type: 'exitStatus',
      exitStatus: event.inner.exitStatus
    };
  }
  if (event instanceof GeneratedRussh.CommandStreamEvent.ExitSignal) {
    return {
      type: 'exitSignal',
      signalName: event.inner.signalName
    };
  }
  if (event instanceof GeneratedRussh.CommandStreamEvent.Closed) {
    return {
      type: 'closed'
    };
  }
  const exhaustive = event;
  throw new Error(`Unsupported command stream event: ${String(exhaustive)}`);
}
function wrapCommandStream(stream) {
  const info = stream.getInfo();
  return {
    channelId: info.channelId,
    createdAtMs: info.createdAtMs,
    connectionId: info.connectionId,
    sendData: (data, opts) => stream.sendData(data, opts?.signal ? {
      signal: opts.signal
    } : undefined),
    close: opts => stream.close(opts?.signal ? {
      signal: opts.signal
    } : undefined)
  };
}
function wrapConnection(conn) {
  const info = conn.getInfo();
  return {
    connectionId: info.connectionId,
    connectionDetails: generatedConnDetailsToIdeal(info.connectionDetails),
    createdAtMs: info.createdAtMs,
    connectedAtMs: info.connectedAtMs,
    progressTimings: {
      tcpEstablishedAtMs: info.progressTimings.tcpEstablishedAtMs,
      sshHandshakeAtMs: info.progressTimings.sshHandshakeAtMs
    },
    startShell: async ({
      onClosed,
      ...params
    }) => {
      const shell = await conn.startShell({
        term: terminalTypeLiteralToEnum[params.term],
        onClosedCallback: onClosed ? {
          onChange: channelId => onClosed(channelId)
        } : undefined,
        terminalMode: params.terminalMode,
        terminalPixelSize: params.terminalPixelSize,
        terminalSize: params.terminalSize,
        useTmux: params.useTmux,
        tmuxSessionName: params.tmuxSessionName
      }, params.abortSignal ? {
        signal: params.abortSignal
      } : undefined);
      return wrapShellSession(shell);
    },
    runCommand: async ({
      command,
      maxOutputBytes
    }, asyncOpts) => {
      const startedAtMs = Date.now();
      traceRusshApi('runCommand requested', {
        connectionId: info.connectionId,
        commandLen: command.length,
        maxOutputBytes,
        signal: describeSignal(asyncOpts?.signal)
      });
      try {
        const result = await conn.runCommand({
          command,
          maxOutputBytes: maxOutputBytesToGenerated(maxOutputBytes)
        }, asyncOpts?.signal ? {
          signal: asyncOpts.signal
        } : undefined);
        traceRusshApi('runCommand resolved', {
          connectionId: info.connectionId,
          elapsedMs: Date.now() - startedAtMs,
          stdoutBytes: result.stdout.byteLength,
          stderrBytes: result.stderr.byteLength,
          exitStatus: result.exitStatus ?? null,
          exitSignal: result.exitSignal ?? null
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitStatus: result.exitStatus ?? null,
          exitSignal: result.exitSignal ?? null
        };
      } catch (error) {
        traceRusshApi('runCommand rejected', {
          connectionId: info.connectionId,
          elapsedMs: Date.now() - startedAtMs,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    },
    startCommandStream: async ({
      command,
      onEvent,
      abortSignal
    }) => {
      const startedAtMs = Date.now();
      traceRusshApi('startCommandStream requested', {
        connectionId: info.connectionId,
        commandLen: command.length,
        signal: describeSignal(abortSignal)
      });
      try {
        const stream = await conn.startCommandStream({
          command,
          onEventCallback: {
            onEvent: event => onEvent(toCommandStreamEvent(event))
          }
        }, abortSignal ? {
          signal: abortSignal
        } : undefined);
        const wrapped = wrapCommandStream(stream);
        traceRusshApi('startCommandStream resolved', {
          connectionId: info.connectionId,
          channelId: wrapped.channelId,
          elapsedMs: Date.now() - startedAtMs
        });
        return wrapped;
      } catch (error) {
        traceRusshApi('startCommandStream rejected', {
          connectionId: info.connectionId,
          elapsedMs: Date.now() - startedAtMs,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    },
    disconnect: opts => {
      traceRusshApi('connection disconnect requested', {
        connectionId: info.connectionId,
        signal: describeSignal(opts?.signal),
        stack: traceStack('RusshApiTrace connection disconnect requested')
      });
      return conn.disconnect(opts?.signal ? {
        signal: opts.signal
      } : undefined);
    }
  };
}
async function connect({
  onServerKey,
  onConnectionProgress,
  onDisconnected,
  ...options
}) {
  const security = options.security.type === 'password' ? new GeneratedRussh.Security.Password({
    password: options.security.password
  }) : new GeneratedRussh.Security.Key({
    privateKeyContent: options.security.privateKey
  });
  const sshConnection = await GeneratedRussh.connect({
    connectionDetails: {
      host: options.host,
      port: options.port,
      username: options.username,
      security
    },
    onConnectionProgressCallback: onConnectionProgress ? {
      onChange: statusEnum => onConnectionProgress(sshConnProgressEnumToLiteral[statusEnum])
    } : undefined,
    onDisconnectedCallback: onDisconnected ? {
      onChange: connectionId => onDisconnected(connectionId)
    } : undefined,
    onServerKeyCallback: {
      onChange: serverKeyInfo => onServerKey(serverKeyInfo, options.abortSignal)
    }
  }, options.abortSignal ? {
    signal: options.abortSignal
  } : undefined);
  return wrapConnection(sshConnection);
}
async function generateKeyPair(type) {
  const map = {
    rsa: GeneratedRussh.KeyType.Rsa,
    ecdsa: GeneratedRussh.KeyType.Ecdsa,
    ed25519: GeneratedRussh.KeyType.Ed25519
  };
  return GeneratedRussh.generateKeyPair(map[type]);
}
function validatePrivateKey(key) {
  try {
    GeneratedRussh.validatePrivateKey(key);
    return {
      valid: true
    };
  } catch (e) {
    return {
      valid: false,
      error: e
    };
  }
}
function extractPublicKey(privateKey) {
  try {
    const publicKey = GeneratedRussh.extractPublicKey(privateKey);
    return {
      publicKey
    };
  } catch (e) {
    return {
      error: e
    };
  }
}

// #endregion

export { SshError, SshError_Tags } from "./generated/uniffi_russh.js";
export const RnRussh = {
  uniffiInitAsync: GeneratedRussh.uniffiInitAsync,
  connect,
  generateKeyPair,
  validatePrivateKey,
  extractPublicKey
};
//# sourceMappingURL=api.js.map