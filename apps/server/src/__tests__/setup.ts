// Set required env vars before any module is imported.
// These are used by config/index.ts (which throws on missing vars).
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/calash_test';
process.env['JWT_SECRET'] = 'test-jwt-secret-for-testing-only-32chars';
process.env['JWT_EXPIRES_IN'] = '1h';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['COMMERCE_ENABLED'] = 'false';
