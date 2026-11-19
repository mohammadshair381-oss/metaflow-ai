import { describe, expect, it } from 'vitest';
import { normalizeApiBaseUrl } from './config';

describe('normalizeApiBaseUrl', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['   ', ''],
    ['https://metaflow-api.onrender.com', 'https://metaflow-api.onrender.com'],
    ['https://metaflow-api.onrender.com/', 'https://metaflow-api.onrender.com'],
    [' http://localhost:4000// ', 'http://localhost:4000'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeApiBaseUrl(input)).toBe(expected);
  });
});
