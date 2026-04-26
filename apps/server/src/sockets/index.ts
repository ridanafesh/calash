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
  handleRoomAddBot,
  handleRoomRemoveBot,
  handleDisconnect,
  restorePlayerToRoom,
} from './handlers/room.js';
import { handleGameAction } from './handlers/game.js';
import { handleReaction } from './handlers/reaction.js';

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
      console.warn(`[socket] handshake rejected: no token (origin=${socket.handshake.headers.origin ?? 'n/a'})`);
      next(new Error('Authentication required'));
      return;
    }
    try {
      const payload = jwt.verify(token, config.jwt.secret) as { userId: string };

      // Verify the user still exists AND is not a bot — bots have no JWTs.
      const { rows } = await pool.query<{ display_name: string | null; username: string; is_bot: boolean }>(
        `SELECT u.is_bot, pp.display_name, pp.username
         FROM users u
         LEFT JOIN player_profiles pp ON pp.user_id = u.id
         WHERE u.id = $1`,
        [payload.userId],
      );
      if (rows.length === 0) {
        console.warn(`[socket] handshake rejected: user ${payload.userId} no longer exists`);
        next(new Error('Invalid token'));
        return;
      }
      if (rows[0].is_bot) {
        console.warn(`[socket] handshake rejected: ${payload.userId} is a bot`);
        next(new Error('Invalid token'));
        return;
      }

      socket.data.playerId = payload.userId;
      socket.data.displayName = rows[0].display_name ?? rows[0].username ?? payload.userId;

      next();
    } catch (err) {
      console.warn(`[socket] handshake rejected: ${(err as Error).message}`);
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

    socket.on('room:add-bot', (opts) => {
      handleRoomAddBot(socket, io, opts).catch((err) => {
        console.error('[socket] room:add-bot error:', err);
        socket.emit('room:error', { code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      });
    });

    socket.on('room:remove-bot', (botUserId) => {
      handleRoomRemoveBot(socket, io, botUserId).catch((err) => {
        console.error('[socket] room:remove-bot error:', err);
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

    // ── Emoji reactions ──────────────────────────────────────────────────────
    // Synchronous handler — reactions are pure in-memory broadcast with
    // no persistence, no game-state mutation. Server enforces the
    // emoji allowlist and a per-player cooldown.
    socket.on('room:reaction', (emoji) => {
      try {
        handleReaction(socket, io, emoji);
      } catch (err) {
        console.error('[socket] room:reaction error:', err);
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[socket] Player disconnected: ${playerId} (${reason})`);
      handleDisconnect(socket, io);
    });
  });

  return io;
}
