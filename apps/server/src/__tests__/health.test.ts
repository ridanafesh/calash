// mockPoolQuery must start with 'mock' for Jest to hoist it alongside jest.mock
const mockPoolQuery = jest.fn();

jest.mock('../db/index', () => ({
  pool: {
    query: mockPoolQuery,
    connect: jest.fn(),
    on: jest.fn(),
  },
  query: mockPoolQuery,
  withTransaction: jest.fn(),
}));

// Stub all repository modules so route imports don't fail
jest.mock('../db/repositories/index', () => ({
  createDatabaseService: jest.fn(() => ({})),
}));

import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

describe('GET /api/health', () => {
  it('returns 200 and status:ok when DB is reachable', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('returns 503 when DB query throws', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});
