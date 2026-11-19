import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/utils/logger';
import { REDACTED, redactConnectionStrings, redactForLog } from '../src/utils/redact';

describe('redaction', () => {
  it('strips credentials from MongoDB connection strings', () => {
    expect(redactConnectionStrings('failed: mongodb+srv://app:p%40ss@cluster0.x.net/db')).toBe(
      `failed: mongodb+srv://${REDACTED}@cluster0.x.net/db`,
    );
    expect(redactConnectionStrings('mongodb://localhost:27017/db')).toBe(
      'mongodb://localhost:27017/db',
    );
  });

  it('masks sensitive keys at any depth', () => {
    const output = redactForLog({
      user: { email: 'a@b.c', password: 'pw', nested: { sessionToken: 't' } },
      headers: { authorization: 'Bearer x', cookie: 'sid=1' },
      MONGODB_URI: 'mongodb://u:p@h/db',
      apiKey: 'k',
    });
    expect(output).toEqual({
      user: { email: 'a@b.c', password: REDACTED, nested: { sessionToken: REDACTED } },
      headers: { authorization: REDACTED, cookie: REDACTED },
      MONGODB_URI: REDACTED,
      apiKey: REDACTED,
    });
  });

  it('serializes errors with redacted messages and stacks', () => {
    const output = redactForLog(new Error('cannot reach mongodb://root:toor@db:27017')) as Record<
      string,
      string
    >;
    expect(output.name).toBe('Error');
    expect(output.message).not.toContain('toor');
    expect(output.stack).not.toContain('toor');
  });
});

describe('createLogger', () => {
  it('writes JSON lines at or above the configured level only', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', write: (line) => lines.push(line) });

    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('shown', { password: 'nope', attempt: 2 });
    logger.error('shown too');

    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(first).toMatchObject({ level: 'warn', msg: 'shown', password: REDACTED, attempt: 2 });
    expect(typeof first.time).toBe('string');
  });

  it('writes nothing when silent', () => {
    const lines: string[] = [];
    createLogger({ level: 'silent', write: (line) => lines.push(line) }).error('x');
    expect(lines).toHaveLength(0);
  });
});
