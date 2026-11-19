import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FRONTEND_ORIGIN, buildTestApp } from './helpers';

describe('CORS', () => {
  const app = buildTestApp();

  it('allows the configured frontend origin with credentials', async () => {
    const response = await request(app).get('/api/health').set('Origin', FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-expose-headers']).toContain('X-Request-Id');
    expect(response.headers.vary).toContain('Origin');
  });

  it('does not grant access to an unlisted origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('never answers with a wildcard origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers preflight requests from the allowed origin', async () => {
    const response = await request(app)
      .options('/api/health')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('refuses preflight requests from an unlisted origin', async () => {
    const response = await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests without an Origin header (health checks, curl)', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
