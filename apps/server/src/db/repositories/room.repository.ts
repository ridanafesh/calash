import type { Pool } from 'pg';

// ─── Row types ────────────────────────────────────────────────────────────────

export interface GameRoomRow {
  id: string;
  host_user_id: string;
  status: 'lobby' | 'in_progress' | 'finished' | 'abandoned';
  max_players: number;
  settings_json: Record<string, unknown>;
  winner_user_id: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface GameRoomPlayerRow {
  id: string;
  room_id: string;
  user_id: string;
  seat_index: number;
  joined_at: Date;
  left_at: Date | null;
  final_score: number | null;
}

export interface RoomWithPlayers extends GameRoomRow {
  players: GameRoomPlayerRow[];
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class RoomRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string): Promise<GameRoomRow | null> {
    const { rows } = await this.db.query<GameRoomRow>(
      'SELECT * FROM game_rooms WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findWithPlayers(id: string): Promise<RoomWithPlayers | null> {
    const room = await this.findById(id);
    if (!room) return null;

    const { rows: players } = await this.db.query<GameRoomPlayerRow>(
      `SELECT * FROM game_room_players WHERE room_id = $1 ORDER BY seat_index`,
      [id],
    );

    return { ...room, players };
  }

  async findOpenRooms(): Promise<GameRoomRow[]> {
    const { rows } = await this.db.query<GameRoomRow>(
      `SELECT r.*
       FROM game_rooms r
       WHERE r.status = 'lobby'
         AND (SELECT COUNT(*) FROM game_room_players WHERE room_id = r.id) < r.max_players
       ORDER BY r.created_at DESC
       LIMIT 50`,
    );
    return rows;
  }

  async findActiveRoomForUser(userId: string): Promise<GameRoomRow | null> {
    const { rows } = await this.db.query<GameRoomRow>(
      `SELECT r.*
       FROM game_rooms r
       JOIN game_room_players grp ON grp.room_id = r.id
       WHERE grp.user_id = $1
         AND r.status IN ('lobby', 'in_progress')
         AND grp.left_at IS NULL
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async create(data: {
    hostUserId: string;
    maxPlayers: number;
    settings?: Record<string, unknown>;
  }): Promise<RoomWithPlayers> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: roomRows } = await client.query<GameRoomRow>(
        `INSERT INTO game_rooms (host_user_id, max_players, settings_json)
         VALUES ($1, $2, $3) RETURNING *`,
        [data.hostUserId, data.maxPlayers, JSON.stringify(data.settings ?? {})],
      );
      const room = roomRows[0];

      // Host automatically joins at seat 0
      const { rows: playerRows } = await client.query<GameRoomPlayerRow>(
        `INSERT INTO game_room_players (room_id, user_id, seat_index)
         VALUES ($1, $2, 0) RETURNING *`,
        [room.id, data.hostUserId],
      );

      await client.query('COMMIT');
      return { ...room, players: playerRows };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async addPlayer(roomId: string, userId: string): Promise<GameRoomPlayerRow> {
    // Assign the next available seat index
    const { rows } = await this.db.query<GameRoomPlayerRow>(
      `INSERT INTO game_room_players (room_id, user_id, seat_index)
       SELECT $1, $2,
         COALESCE(
           (SELECT MAX(seat_index) + 1 FROM game_room_players WHERE room_id = $1),
           0
         )
       WHERE NOT EXISTS (
         SELECT 1 FROM game_room_players WHERE room_id = $1 AND user_id = $2
       )
       RETURNING *`,
      [roomId, userId],
    );
    if (!rows[0]) {
      throw new Error(`User ${userId} is already in room ${roomId}`);
    }
    return rows[0];
  }

  async removePlayer(roomId: string, userId: string): Promise<void> {
    await this.db.query(
      `UPDATE game_room_players SET left_at = NOW()
       WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId],
    );
  }

  async updateStatus(
    roomId: string,
    status: GameRoomRow['status'],
    extra?: { winnerId?: string; startedAt?: boolean; finishedAt?: boolean },
  ): Promise<GameRoomRow | null> {
    const fields = ['status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [roomId, status];
    let idx = 3;

    if (extra?.startedAt) { fields.push(`started_at = NOW()`); }
    if (extra?.finishedAt) { fields.push(`finished_at = NOW()`); }
    if (extra?.winnerId)   { fields.push(`winner_user_id = $${idx++}`); values.push(extra.winnerId); }

    const { rows } = await this.db.query<GameRoomRow>(
      `UPDATE game_rooms SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async setFinalScores(
    roomId: string,
    scores: Array<{ userId: string; finalScore: number }>,
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      for (const { userId, finalScore } of scores) {
        await client.query(
          `UPDATE game_room_players SET final_score = $1
           WHERE room_id = $2 AND user_id = $3`,
          [finalScore, roomId, userId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async playerCount(roomId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) FROM game_room_players WHERE room_id = $1 AND left_at IS NULL`,
      [roomId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
