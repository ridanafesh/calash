import { io, type Socket } from 'socket.io-client';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@calash/shared';

import { socketUrl } from './server-urls';

const WS_URL = socketUrl();

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(WS_URL, {
      auth: { token },
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  const s = getSocket(token);
  if (!s.connected) {
    s.auth = { token };
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
