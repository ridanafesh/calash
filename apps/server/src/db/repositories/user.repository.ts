import type { Pool } from 'pg';

// ─── Row types (mirror the DB columns) ───────────────────────────────────────

export interface UserRow {
  id: string;
  email: string | null; // null for guest accounts
  created_at: Date;
  updated_at: Date;
}

export interface AuthAccountRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string | null;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PlayerProfileRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithProfile extends UserRow {
  profile: PlayerProfileRow | null;
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class UserRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      'SELECT * FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  async findWithProfile(userId: string): Promise<UserWithProfile | null> {
    const { rows } = await this.db.query<UserRow & { profile: PlayerProfileRow | null }>(
      `SELECT
         u.*,
         row_to_json(pp.*) AS profile
       FROM users u
       LEFT JOIN player_profiles pp ON pp.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    if (!rows[0]) return null;
    return {
      ...rows[0],
      profile: rows[0].profile ?? null,
    } as UserWithProfile;
  }

  /** Find a user by their Google provider_account_id. */
  async findByGoogleId(googleId: string): Promise<UserWithProfile | null> {
    const { rows } = await this.db.query<UserRow & { profile: PlayerProfileRow | null }>(
      `SELECT
         u.*,
         row_to_json(pp.*) AS profile
       FROM users u
       JOIN auth_accounts aa ON aa.user_id = u.id
       LEFT JOIN player_profiles pp ON pp.user_id = u.id
       WHERE aa.provider = 'google' AND aa.provider_account_id = $1`,
      [googleId],
    );
    if (!rows[0]) return null;
    return { ...rows[0], profile: rows[0].profile ?? null } as UserWithProfile;
  }

  /** Create a user with email + password (the original flow). */
  async create(data: {
    email: string;
    username: string;
    passwordHash: string;
  }): Promise<UserWithProfile> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query<UserRow>(
        'INSERT INTO users (email) VALUES ($1) RETURNING *',
        [data.email.toLowerCase()],
      );
      const user = userRows[0];

      await client.query(
        `INSERT INTO auth_accounts (user_id, provider, password_hash)
         VALUES ($1, 'password', $2)`,
        [user.id, data.passwordHash],
      );

      const { rows: profileRows } = await client.query<PlayerProfileRow>(
        `INSERT INTO player_profiles (user_id, username)
         VALUES ($1, $2) RETURNING *`,
        [user.id, data.username],
      );

      await client.query(
        'INSERT INTO leaderboard_entries (user_id) VALUES ($1)',
        [user.id],
      );

      await client.query('COMMIT');
      return { ...user, profile: profileRows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Create a user authenticated via Google. */
  async createFromGoogle(data: {
    googleId: string;
    email: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  }): Promise<UserWithProfile> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query<UserRow>(
        'INSERT INTO users (email) VALUES ($1) RETURNING *',
        [data.email.toLowerCase()],
      );
      const user = userRows[0];

      await client.query(
        `INSERT INTO auth_accounts (user_id, provider, provider_account_id)
         VALUES ($1, 'google', $2)`,
        [user.id, data.googleId],
      );

      const { rows: profileRows } = await client.query<PlayerProfileRow>(
        `INSERT INTO player_profiles (user_id, username, display_name, avatar_url)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [user.id, data.username, data.displayName ?? null, data.avatarUrl ?? null],
      );

      await client.query('INSERT INTO leaderboard_entries (user_id) VALUES ($1)', [user.id]);

      await client.query('COMMIT');
      return { ...user, profile: profileRows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Create a guest user with no email or password. */
  async createGuest(username: string): Promise<UserWithProfile> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query<UserRow>(
        'INSERT INTO users DEFAULT VALUES RETURNING *',
      );
      const user = userRows[0];

      await client.query(
        `INSERT INTO auth_accounts (user_id, provider) VALUES ($1, 'guest')`,
        [user.id],
      );

      const { rows: profileRows } = await client.query<PlayerProfileRow>(
        `INSERT INTO player_profiles (user_id, username) VALUES ($1, $2) RETURNING *`,
        [user.id, username],
      );

      await client.query('INSERT INTO leaderboard_entries (user_id) VALUES ($1)', [user.id]);

      await client.query('COMMIT');
      return { ...user, profile: profileRows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Link a Google account to an existing user (used when upgrading a guest or merging accounts). */
  async linkGoogleAccount(
    userId: string,
    data: { googleId: string; email?: string; avatarUrl?: string | null },
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO auth_accounts (user_id, provider, provider_account_id)
         VALUES ($1, 'google', $2)
         ON CONFLICT (user_id, provider) DO UPDATE SET provider_account_id = $2, updated_at = NOW()`,
        [userId, data.googleId],
      );

      if (data.email) {
        await client.query(
          `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2 AND email IS NULL`,
          [data.email.toLowerCase(), userId],
        );
      }

      if (data.avatarUrl !== undefined) {
        await client.query(
          `UPDATE player_profiles SET avatar_url = COALESCE(avatar_url, $1), updated_at = NOW() WHERE user_id = $2`,
          [data.avatarUrl, userId],
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

  /** Link a password account to an existing guest user. */
  async linkPasswordAccount(
    userId: string,
    data: { email: string; passwordHash: string },
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO auth_accounts (user_id, provider, password_hash)
         VALUES ($1, 'password', $2)`,
        [userId, data.passwordHash],
      );

      await client.query(
        `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2`,
        [data.email.toLowerCase(), userId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findAuthAccount(userId: string, provider: string): Promise<AuthAccountRow | null> {
    const { rows } = await this.db.query<AuthAccountRow>(
      'SELECT * FROM auth_accounts WHERE user_id = $1 AND provider = $2',
      [userId, provider],
    );
    return rows[0] ?? null;
  }

  async findAuthAccountByEmail(email: string, provider: string): Promise<AuthAccountRow | null> {
    const { rows } = await this.db.query<AuthAccountRow>(
      `SELECT aa.*
       FROM auth_accounts aa
       JOIN users u ON u.id = aa.user_id
       WHERE u.email = $1 AND aa.provider = $2`,
      [email.toLowerCase(), provider],
    );
    return rows[0] ?? null;
  }

  async updateProfile(
    userId: string,
    data: Partial<{ displayName: string; avatarUrl: string }>,
  ): Promise<PlayerProfileRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.displayName !== undefined) {
      fields.push(`display_name = $${idx++}`);
      values.push(data.displayName);
    }
    if (data.avatarUrl !== undefined) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(data.avatarUrl);
    }
    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const { rows } = await this.db.query<PlayerProfileRow>(
      `UPDATE player_profiles SET ${fields.join(', ')}
       WHERE user_id = $${idx}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const { rows } = await this.db.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM player_profiles WHERE username = $1) AS exists',
      [username],
    );
    return rows[0]?.exists ?? false;
  }
}
