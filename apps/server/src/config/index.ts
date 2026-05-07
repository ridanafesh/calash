import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

/**
 * Resolve the single allowed CORS origin shared by Express and Socket.IO.
 *
 * Priority:
 *   1. CLIENT_URL  (canonical name, what the deployment platform uses)
 *   2. CORS_ORIGIN (legacy alias kept for backward compatibility with older
 *      .env files / docker-compose / test setup)
 *   3. http://localhost:3000  (development fallback ONLY)
 *
 * In production we refuse to silently fall back to localhost — that's how
 * we ended up with `Access-Control-Allow-Origin: http://localhost:3000`
 * leaking to the deployed frontend. If neither CLIENT_URL nor CORS_ORIGIN
 * is set in production we throw at boot so the misconfiguration is loud.
 */
function resolveAllowedOrigin(): string {
  const fromEnv = process.env['CLIENT_URL'] ?? process.env['CORS_ORIGIN'];
  if (NODE_ENV === 'production') {
    if (!fromEnv) {
      throw new Error(
        'Missing required env var: CLIENT_URL (or CORS_ORIGIN). In production the server refuses to fall back to http://localhost:3000.',
      );
    }
    return fromEnv;
  }
  // Development / test: env wins, otherwise localhost.
  return fromEnv ?? 'http://localhost:3000';
}

export const config = {
  nodeEnv: NODE_ENV,
  port: parseInt(process.env['PORT'] ?? '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
    guestExpiresIn: process.env['JWT_GUEST_EXPIRES_IN'] ?? '24h',
  },
  cors: {
    origin: resolveAllowedOrigin(),
  },
  google: {
    // Optional — Google sign-in is disabled when not configured
    clientId: process.env['GOOGLE_CLIENT_ID'] ?? null,
  },
} as const;
