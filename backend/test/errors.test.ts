import { apiErrorResponseSchema } from '@metaflow/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createErrorHandler } from '../src/middleware/error-handler';
import { requestId } from '../src/middleware/request-id';
import { createLogger } from '../src/utils/logger';
import { parseRequest } from '../src/validators/parse-request';
import { buildTestApp } from './helpers';

describe('application error handling', () => {
  const app = buildTestApp();

  it('returns a 404 error envelope for unknown routes', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('rejects a malformed JSON body with 400 BAD_REQUEST', async () => {
    const response = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');

    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Request body is not valid JSON',
    });
  });

  it('rejects an oversized JSON body with 413', async () => {
    const response = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(200 * 1024) }));

    expect(response.status).toBe(413);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
  });
});

describe('parseRequest and the central error handler', () => {
  const logged: string[] = [];
  const capturingLogger = createLogger({ level: 'error', write: (line) => logged.push(line) });

  const bodySchema = z.object({ name: z.string().min(2), count: z.number().int().positive() });
  const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });

  const testApp = express()
    .use(requestId())
    .use(express.json())
    .post('/items', (req, res) => {
      const { body, query } = parseRequest(req, { body: bodySchema, query: querySchema });
      res.status(201).json({ body, query });
    })
    .get('/explode', () => {
      throw new Error('database password is hunter2 at mongodb://admin:hunter2@db.internal');
    })
    .get('/explode-async', async () => {
      await Promise.resolve();
      throw new Error('async failure');
    })
    .use(createErrorHandler(capturingLogger));

  it('returns parsed, typed values for valid input', async () => {
    const response = await request(testApp)
      .post('/items?page=3')
      .send({ name: 'Launch post', count: 2 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ body: { name: 'Launch post', count: 2 }, query: { page: 3 } });
  });

  it('reports every invalid field with its location', async () => {
    const response = await request(testApp).post('/items?page=0').send({ name: 'x' });

    expect(response.status).toBe(400);
    const { error } = apiErrorResponseSchema.parse(response.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.map((issue) => issue.path).sort()).toEqual([
      'body.count',
      'body.name',
      'query.page',
    ]);
  });

  it('rejects a missing body as a validation error, not a crash', async () => {
    const response = await request(testApp).post('/items');
    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('hides internal error details from the client but logs them redacted', async () => {
    logged.length = 0;
    const response = await request(testApp).get('/explode');

    expect(response.status).toBe(500);
    expect(apiErrorResponseSchema.parse(response.body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
    expect(JSON.stringify(response.body)).not.toContain('stack');

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('http.unhandled_error');
    expect(logged[0]).not.toContain('admin:hunter2@');
  });

  it('catches errors thrown by async handlers (Express 5)', async () => {
    const response = await request(testApp).get('/explode-async');
    expect(response.status).toBe(500);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('INTERNAL_ERROR');
  });

  it('does not log expected client errors at error level', async () => {
    logged.length = 0;
    await request(testApp).post('/items').send({});
    await request(testApp).get('/missing-route-handled-by-express');
    expect(logged).toHaveLength(0);
  });
});
