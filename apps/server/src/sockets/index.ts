import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@calash/shared';
import { config } from '../config/index.js';

export function createSocketServer(httpServer: HttpServer): Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: { origin: config.cors.origin, credentials: true },
    },
  );

  // JWT auth middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const payload = jwt.verify(token, config.jwt.secret) as { playerId: string };
      socket.data.playerId = payload.playerId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.data.playerId}`);

    socket.on('room:create', ({ maxPlayers }) => {
      // TODO: implement room creation
      console.log(`Player ${socket.data.playerId} wants to create room with ${maxPlayers} players`);
    });

    socket.on('room:join', (roomId) => {
      // TODO: implement room joining
      console.log(`Player ${socket.data.playerId} wants to join room ${roomId}`);
    });

    socket.on('room:leave', () => {
      // TODO: implement room leaving
    });

    socket.on('room:ready', () => {
      // TODO: implement ready signal
    });

    socket.on('game:action', (action) => {
      // TODO: validate and process game action via game-core
      console.log(`Game action from ${socket.data.playerId}:`, action);
    });

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.data.playerId}`);
    });
  });

  return io;
}
