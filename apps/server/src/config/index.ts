import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: parseInt(process.env['PORT'] ?? '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
    guestExpiresIn: process.env['JWT_GUEST_EXPIRES_IN'] ?? '24h',
  },
  cors: {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  },
  google: {
    // Optional — Google sign-in is disabled when not configured
    clientId: process.env['GOOGLE_CLIENT_ID'] ?? null,
  },
} as const;
