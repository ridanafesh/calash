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

  /**
   * Lobby-visible rooms: BOTH 'lobby' and 'in_progress' rooms whose
   * seat layout has at least one path a fresh joiner could take —
   * either an empty seat or a replaceable host-created bot.
   *
   * Why this includes in-progress rooms: starting a game must not
   * make the room disappear from the list. As long as someone could
   * still take a seat (empty seat or bot replacement), the lobby
   * shows it. Locked rooms are still listed; the lock is enforced
   * at JOIN time, not at LIST time.
   *
   * The "joinable" predicate inside SQL:
   *   - empty seat: COUNT(active rows) < max_players
   *   - replaceable bot: at least one row whose user is a bot AND
   *     the row is not marked is_human_substitute (substitutes are
   *     reserved for the original human's reclaim flow).
   *
   * Finished / abandoned rooms are excluded. left_at IS NOT NULL rows
   * are excluded from the seat count so a leaver's vacated seat
   * counts as empty again.
   */
  async findVisibleRooms(): Promise<GameRoomRow[]> {
    const { rows } = await this.db.query<GameRoomRow>(
      `SELECT r.*
       FROM game_rooms r
       WHERE r.status IN ('lobby', 'in_progress')
         -- "No humans, no room" — defensive: the leave/disconnect
         -- handlers tear down empty rooms, but if any slip through
         -- (server crash mid-leave, etc.) we still hide them from
         -- the lobby. A row counts as a human when the user is not
         -- a bot. Substituted-bot rows are bot rows here.
         AND EXISTS (
           SELECT 1
           FROM game_room_players grp
           JOIN users u ON u.id = grp.user_id
           WHERE grp.room_id = r.id
             AND grp.left_at IS NULL
             AND u.is_bot = false
         )
         AND (
           -- empty seat available
           (SELECT COUNT(*) FROM game_room_players grp
              WHERE grp.room_id = r.id AND grp.left_at IS NULL) < r.max_players
           OR
           -- replaceable host-created bot present
           EXISTS (
             SELECT 1
             FROM game_room_players grp
             JOIN users u ON u.id = grp.user_id
             WHERE grp.room_id = r.id
               AND grp.left_at IS NULL
               AND u.is_bot = true
               AND grp.is_human_substitute = false
           )
         )
       ORDER BY r.created_at DESC
       LIMIT 50`,
    );
    return rows;
  }

  /** @deprecated Use findVisibleRooms — name kept for callers that
   *  truly want lobby-only rooms (none currently). */
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

  /**
   * Rooms where this user has a substituted seat waiting for them — the
   * user explicitly left mid-game, the seat was bot-flipped, but the
   * row is still open (left_at IS NULL) and is_human_substitute is true.
   * The lobby uses this to show "your in-progress games" as a rejoinable
   * list, separate from the public open-rooms feed.
   */
  async findRejoinableRoomsForUser(userId: string): Promise<GameRoomRow[]> {
    const { rows } = await this.db.query<GameRoomRow>(
      `SELECT r.*
       FROM game_rooms r
       JOIN game_room_players grp ON grp.room_id = r.id
       WHERE grp.user_id = $1
         AND r.status = 'in_progress'
         AND grp.left_at IS NULL
         AND grp.is_human_substitute = true
       ORDER BY r.created_at DESC`,
      [userId],
    );
    return rows;
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

  /**
   * Add a player to a room, OR reactivate an existing player record
   * (a player who previously left this room and is now rejoining).
   *
   * Returns:
   *   { row, kind: 'new'         } — fresh insert; assigned a new seat.
   *   { row, kind: 'reactivated' } — prior left_at row reset to NULL.
   *   { row, kind: 'existing'    } — already an active player; idempotent
   *                                  reconnect, no DB mutation needed.
   *
   * Never throws on "already in room" — that case is normal during a
   * refresh / reconnect / second tab and is handled by the caller as
   * a reconnect, not a 500. Only throws on real DB errors.
   */
  async addPlayer(
    roomId: string,
    userId: string,
  ): Promise<{ row: GameRoomPlayerRow; kind: 'new' | 'reactivated' | 'existing' }> {
    // 1. Existing active row → reconnect.
    const { rows: existing } = await this.db.query<GameRoomPlayerRow>(
      `SELECT * FROM game_room_players
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [roomId, userId],
    );
    if (existing[0]) {
      return { row: existing[0], kind: 'existing' };
    }

    // 2. Prior row with left_at set → reactivate that same seat.
    //    Reusing the seat keeps the player's history intact and avoids
    //    seat-index gaps. We pick the most-recently-left row in case
    //    the player joined-left-joined-left more than once.
    const { rows: prior } = await this.db.query<GameRoomPlayerRow>(
      `UPDATE game_room_players
       SET left_at = NULL
       WHERE id = (
         SELECT id FROM game_room_players
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NOT NULL
         ORDER BY left_at DESC
         LIMIT 1
       )
       RETURNING *`,
      [roomId, userId],
    );
    if (prior[0]) {
      return { row: prior[0], kind: 'reactivated' };
    }

    // 3. Truly new player → insert with the next seat index. Compute the
    //    next seat off ALL rows for this room (including left_at-set
    //    ones) so a returning player who somehow got missed by step 2
    //    doesn't collide on the unique (room_id, seat_index) constraint.
    const { rows: inserted } = await this.db.query<GameRoomPlayerRow>(
      `INSERT INTO game_room_players (room_id, user_id, seat_index)
       VALUES (
         $1,
         $2,
         COALESCE(
           (SELECT MAX(seat_index) + 1 FROM game_room_players WHERE room_id = $1),
           0
         )
       )
       RETURNING *`,
      [roomId, userId],
    );
    return { row: inserted[0], kind: 'new' };
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
