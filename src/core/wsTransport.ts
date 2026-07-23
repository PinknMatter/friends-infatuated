// Composite Transport that mirrors the BroadcastChannel leg onto the OSC
// bridge's WebSocket (scripts/osc-bridge.mjs, ws://localhost:8765).
// Hard constraint: at the venue the bridge may simply not be running — the
// wrapper must be COMPLETELY silent about it (no throws, no console spam)
// and keep reconnecting forever so starting the bridge mid-show just works.

import type { Transport, TransportMessage } from './transport';

const RECONNECT_MS = 2000;

export function attachOscBridge(base: Transport, url = 'ws://localhost:8765'): Transport {
  const listeners: ((msg: TransportMessage) => void)[] = [];
  let ws: WebSocket | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const wsSend = (msg: TransportMessage): void => {
    // audio-file carries an ArrayBuffer — JSON.stringify would mangle it to {}.
    // It only ever travels control→render over BroadcastChannel anyway.
    if (msg.type === 'audio-file') return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* socket died mid-send — reconnect loop handles it */
      }
    }
  };

  const scheduleReconnect = (): void => {
    if (closed || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, RECONNECT_MS);
  };

  const connect = (): void => {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      ws = null;
      scheduleReconnect();
      return;
    }
    ws.onmessage = (ev) => {
      let msg: TransportMessage;
      try {
        msg = JSON.parse(ev.data as string) as TransportMessage;
      } catch {
        return; // garbage on the wire — ignore
      }
      if (!msg || typeof msg.type !== 'string') return;
      for (const cb of listeners) cb(msg);
      // Relay to the base leg so the control panel's mirrored store stays
      // truthful when OSC changes params. Never echoed back to the WS.
      base.send(msg);
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows; swallowing keeps the console clean when bridge is down */
    };
  };

  // Base-leg messages (control panel) → listeners + WS mirror. Never echoed
  // back onto the base leg.
  base.onMessage((msg) => {
    for (const cb of listeners) cb(msg);
    wsSend(msg);
  });

  connect();

  return {
    send(msg: TransportMessage): void {
      base.send(msg);
      wsSend(msg);
    },
    onMessage(cb: (msg: TransportMessage) => void): void {
      listeners.push(cb);
    },
    close(): void {
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      try {
        ws?.close();
      } catch {
        /* already dead */
      }
      ws = null;
      base.close();
    },
  };
}
