import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/utils/logger';
import { buildTestApp } from './helpers';

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { lines, logger };
}

describe('request logger', () => {
  it('logs the full path of routed requests, without the query string', async () => {
    const { lines, logger } = captureLogs();
    await request(buildTestApp({ logger })).get('/api/health/ready?token=secret-value');

    const entry = lines.find((line) => line.msg === 'http.request');
    expect(entry).toMatchObject({ method: 'GET', path: '/api/health/ready', status: 200 });
    expect(JSON.stringify(lines)).not.toContain('secret-value');
  });

  it('logs health checks at debug level and other requests at info level', async () => {
    const { lines, logger } = captureLogs();
    const app = buildTestApp({ logger });
    await request(app).get('/api/health');
    await request(app).get('/api/healthcheck-lookalike');

    const requests = lines.filter((line) => line.msg === 'http.request');
    expect(requests.map((line) => [line.path, line.level])).toEqual([
      ['/api/health', 'debug'],
      ['/api/healthcheck-lookalike', 'info'],
    ]);
  });
});
