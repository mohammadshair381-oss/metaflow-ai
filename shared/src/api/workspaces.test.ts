import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CATEGORIES,
  WORKSPACE_LANGUAGES,
  createWorkspaceRequestSchema,
  isValidTimeZone,
  recordIdSchema,
  updateWorkspaceRequestSchema,
} from './workspaces';

describe('workspace contracts', () => {
  it('fills in defaults for a workspace created with only a name', () => {
    expect(createWorkspaceRequestSchema.parse({ name: '  Bloom  ' })).toEqual({
      name: 'Bloom',
      description: '',
      category: 'other',
      timezone: 'UTC',
      defaultLanguage: 'en',
    });
  });

  it('drops fields a client must not set when creating', () => {
    const parsed = createWorkspaceRequestSchema.parse({
      name: 'A',
      ownerId: 'x',
      status: 'archived',
    });
    expect(parsed).not.toHaveProperty('ownerId');
    expect(parsed).not.toHaveProperty('status');
  });

  it('accepts real IANA time zones only', () => {
    expect(isValidTimeZone('Asia/Karachi')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('x'.repeat(65))).toBe(false);
  });

  it('requires at least one known field for an update and rejects unknown ones', () => {
    expect(updateWorkspaceRequestSchema.safeParse({}).success).toBe(false);
    expect(updateWorkspaceRequestSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(updateWorkspaceRequestSchema.safeParse({ name: 'A', status: 'archived' }).success).toBe(
      false,
    );
    expect(updateWorkspaceRequestSchema.parse({ description: '' })).toEqual({ description: '' });
  });

  it('accepts only 24-character hex record IDs', () => {
    expect(recordIdSchema.safeParse('65f0c0ffee0000000000abcd').success).toBe(true);
    for (const value of ['', 'abc', 'z'.repeat(24), 'a'.repeat(25), { $ne: null }]) {
      expect(recordIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it('lists every category and language once, with "other" as a category', () => {
    const categories = BUSINESS_CATEGORIES.map((c) => c.value);
    expect(new Set(categories).size).toBe(categories.length);
    expect(categories).toContain('other');
    const languages = WORKSPACE_LANGUAGES.map((l) => l.value);
    expect(new Set(languages).size).toBe(languages.length);
  });
});
