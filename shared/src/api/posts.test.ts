import { describe, expect, it } from 'vitest';
import { checkPostReadiness, type ReadinessInput } from './post-readiness';
import {
  createPostRequestSchema,
  postWorkflowRequestSchema,
  updatePostRequestSchema,
} from './posts';
import { mediaListQuerySchema, updateMediaRequestSchema } from './media';

const jpeg = { kind: 'image', mimeType: 'image/jpeg', size: 1000 } as const;
const png = { kind: 'image', mimeType: 'image/png', size: 1000 } as const;
const mp4 = { kind: 'video', mimeType: 'video/mp4', size: 1000 } as const;
const webm = { kind: 'video', mimeType: 'video/webm', size: 1000 } as const;
const fb = { platform: 'facebook', status: 'connected' } as const;
const ig = { platform: 'instagram', status: 'connected' } as const;

const input = (overrides: Partial<ReadinessInput>): ReadinessInput => ({
  platforms: ['facebook'],
  caption: 'Hello',
  hashtags: [],
  media: [],
  accounts: [fb],
  missingMediaCount: 0,
  missingAccountCount: 0,
  ...overrides,
});
const messages = (overrides: Partial<ReadinessInput>) =>
  checkPostReadiness(input(overrides)).map((issue) => `${issue.platform}:${issue.field}`);

describe('checkPostReadiness', () => {
  it('accepts a text-only Facebook post and a photo Instagram post', () => {
    expect(messages({})).toEqual([]);
    expect(messages({ platforms: ['instagram'], accounts: [ig], media: [jpeg] })).toEqual([]);
    expect(
      messages({ platforms: ['facebook', 'instagram'], accounts: [fb, ig], media: [jpeg, mp4] }),
    ).toEqual(['facebook:media']);
  });

  it.each([
    ['no platform', { platforms: [] }, ['null:platforms']],
    ['no caption or media', { caption: '' }, ['null:caption']],
    ['no account for the platform', { accounts: [] }, ['facebook:socialAccounts']],
    [
      'an account that needs reconnecting',
      { accounts: [{ platform: 'facebook', status: 'needs_reconnect' }] },
      ['facebook:socialAccounts'],
    ],
    ['a missing media item', { missingMediaCount: 1 }, ['null:media']],
    ['a missing account', { missingAccountCount: 1 }, ['null:socialAccounts']],
    ['Instagram without media', { platforms: ['instagram'], accounts: [ig] }, ['instagram:media']],
    [
      'a PNG on Instagram',
      { platforms: ['instagram'], accounts: [ig], media: [png] },
      ['instagram:media'],
    ],
    ['a WebM video on Facebook', { media: [webm] }, ['facebook:media']],
    ['a video mixed with photos on Facebook', { media: [mp4, jpeg] }, ['facebook:media']],
    [
      'an Instagram photo over 8 MB',
      { platforms: ['instagram'], accounts: [ig], media: [{ ...jpeg, size: 9 * 1024 * 1024 }] },
      ['instagram:media'],
    ],
    [
      'a long Instagram caption',
      { platforms: ['instagram'], accounts: [ig], media: [jpeg], caption: 'x'.repeat(2201) },
      ['instagram:caption'],
    ],
    [
      'over 30 hashtags on Instagram, counting the caption',
      {
        platforms: ['instagram'],
        accounts: [ig],
        media: [jpeg],
        hashtags: Array.from({ length: 25 }, (_, i) => `tag${i}`),
        caption: '#one #two #three #four #five #six',
      },
      ['instagram:hashtags'],
    ],
    ['more than 10 items', { media: Array.from({ length: 11 }, () => jpeg) }, ['facebook:media']],
  ] as const)('reports %s', (_label, overrides, expected) => {
    expect(messages(overrides as Partial<ReadinessInput>)).toEqual(expected);
  });
});

describe('post request schemas', () => {
  it('normalizes a create request and fills defaults', () => {
    expect(
      createPostRequestSchema.parse({
        title: '  Launch ',
        hashtags: ['#Bakery', 'bakery', 'Bakery'],
        platforms: ['instagram', 'instagram'],
      }),
    ).toEqual({
      title: 'Launch',
      caption: '',
      hashtags: ['Bakery', 'bakery'],
      platforms: ['instagram'],
      mediaIds: [],
      socialAccountIds: [],
    });
  });

  it.each([
    [{}, 'empty'],
    [{ title: 'x', status: 'approved' }, 'status'],
    [{ title: 'x', reviewEvents: [] }, 'review events'],
    [{ title: 'x', mediaIds: ['nope'] }, 'bad media ID'],
    [{ title: 'x\u0007' }, 'control character'],
    [{ caption: 'x'.repeat(2201), platforms: ['instagram'] }, 'long Instagram caption'],
  ] as [unknown, string][])('refuses %j (%s)', (body) => {
    expect(createPostRequestSchema.safeParse(body).success).toBe(false);
  });

  it('allows partial edits but not empty ones or server-owned fields', () => {
    expect(updatePostRequestSchema.parse({ revision: 2, caption: 'New' })).toEqual({
      revision: 2,
      caption: 'New',
    });
    expect(updatePostRequestSchema.safeParse({}).success).toBe(false);
    // A revision alone changes nothing.
    expect(updatePostRequestSchema.safeParse({ revision: 0 }).success).toBe(false);
    expect(updatePostRequestSchema.safeParse({ revision: 0, createdBy: 'x' }).success).toBe(false);
    expect(
      updatePostRequestSchema.safeParse({ revision: 0, generationId: '0'.repeat(24) }).success,
    ).toBe(false);
  });

  it('requires the revision the editor loaded', () => {
    for (const revision of [undefined, -1, 1.5, '2', null]) {
      expect(updatePostRequestSchema.safeParse({ revision, caption: 'New' }).success).toBe(false);
    }
  });

  it('accepts only known workflow actions', () => {
    expect(postWorkflowRequestSchema.parse({ action: 'approve', revision: 3 })).toEqual({
      action: 'approve',
      revision: 3,
    });
    expect(postWorkflowRequestSchema.safeParse({ action: 'publish', revision: 0 }).success).toBe(
      false,
    );
    expect(
      postWorkflowRequestSchema.safeParse({ action: 'approve', revision: 0, by: 'x' }).success,
    ).toBe(false);
  });

  it('requires the revision the decision was made on', () => {
    for (const revision of [undefined, -1, 1.5, '2', null]) {
      expect(postWorkflowRequestSchema.safeParse({ action: 'approve', revision }).success).toBe(
        false,
      );
    }
  });
});

describe('media request schemas', () => {
  it('allows editing only alt text and description', () => {
    expect(updateMediaRequestSchema.parse({ altText: ' Shop ' })).toEqual({ altText: 'Shop' });
    expect(updateMediaRequestSchema.safeParse({}).success).toBe(false);
    expect(updateMediaRequestSchema.safeParse({ originalName: 'x' }).success).toBe(false);
  });

  it('bounds the list query', () => {
    expect(mediaListQuerySchema.parse({})).toEqual({ limit: 24 });
    expect(mediaListQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(mediaListQuerySchema.safeParse({ kind: 'audio' }).success).toBe(false);
  });
});
