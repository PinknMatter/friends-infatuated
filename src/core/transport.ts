// Transport abstraction between render window and control panel.
// Stage 1: BroadcastChannel (same origin, same machine).
// Later: a WebSocket transport for the OSC bridge drops in without touching consumers.

export type TransportMessage =
  | { type: 'param-set'; path: string; value: number | boolean | string }
  | { type: 'param-trigger'; path: string }
  | { type: 'sync-request' }
  | { type: 'sync-state'; state: Record<string, number | boolean | string> }
  | { type: 'status'; payload: StatusPayload }
  | { type: 'log'; text: string }
  // Uploaded audio file (control panel → render window, structured clone).
  | { type: 'audio-file'; name: string; buffer: ArrayBuffer };

export interface StatusPayload {
  fps: number;
  phase: string;
  effects: { id: string; intensity: number }[];
  beat: boolean;
  bpm: number;
  boxCount: number;
  audioStatus: string;
  bands: { low: number; mid: number; high: number };
  energy: number;
}

export interface Transport {
  send(msg: TransportMessage): void;
  onMessage(cb: (msg: TransportMessage) => void): void;
  close(): void;
}

const CHANNEL_NAME = 'friends-infatuated';

export class BroadcastTransport implements Transport {
  private channel: BroadcastChannel;
  private listeners: ((msg: TransportMessage) => void)[] = [];

  constructor(channelName: string = CHANNEL_NAME) {
    this.channel = new BroadcastChannel(channelName);
    this.channel.onmessage = (ev) => {
      for (const cb of this.listeners) cb(ev.data as TransportMessage);
    };
  }

  send(msg: TransportMessage): void {
    this.channel.postMessage(msg);
  }

  onMessage(cb: (msg: TransportMessage) => void): void {
    this.listeners.push(cb);
  }

  close(): void {
    this.channel.close();
  }
}
