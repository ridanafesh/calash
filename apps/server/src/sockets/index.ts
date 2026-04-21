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
import { pool } from '../db/index.js';

import {
  handleRoomCreate,
  handleRoomJoin,
  handleRoomJoinByCode,
  handleRoomLeave,
  handleRoomReady,
  handleDisconnect,
  restorePlayerToRoom,
} from './handlers/room.js';
import { handleGameAction } from './handlers/game.js';

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

  // ── JWT auth middleware ────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const payload = jwt.verify(token, config.jwt.secret) as { userId: string };
      socket.data.playerId = payload.userId;

      // Resolve display name from DB.
      const { rows } = await pool.query<{ display_name: string | null; username: string }>(
        `SELECT up.display_name, u.username
         FROM users u
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE u.id = $1`,
        [payload.userId],
      );
      socket.data.displayName = rows[0]?.display_name ?? rows[0]?.username ?? payload.userId;

      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection ────────────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const { playerId } = socket.data;
    console.log(`[socket] Player connected: ${playerId} (socket: ${socket.id})`);

    // Automatically restore player to any active room (reconnect support).
    await restorePlayerToRoom(socket, io);

    // ── Room lifecycle ───────────────────────────────────────────────────────
    socket.on('room:create', (options) => {
      handleRoomCreate(socket, io, options).catch((err) => {
        console.error('[socket] room:create error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    socket.on('room:join', (roomId) => {
      handleRoomJoin(socket, io, roomId).catch((err) => {
        console.error('[socket] room:join error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    socket.on('room:join-by-code', (code) => {
      handleRoomJoinByCode(socket, io, code).catch((err) => {
        console.error('[socket] room:join-by-code error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    socket.on('room:leave', () => {
      handleRoomLeave(socket, io).catch((err) => {
        console.error('[socket] room:leave error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    socket.on('room:ready', () => {
      handleRoomReady(socket, io).catch((err) => {
        console.error('[socket] room:ready error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    // ── Game actions ─────────────────────────────────────────────────────────
    socket.on('game:action', (action) => {
      handleGameAction(socket, io, action).catch((err) => {
        console.error('[socket] game:action error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[socket] Player disconnected: ${playerId} (${reason})`);
      handleDisconnect(socket, io);
    });
  });

  return io;
}
