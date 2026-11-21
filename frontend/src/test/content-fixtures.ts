import type { Media, Post, SocialAccount } from '@metaflow/shared';
import { TEST_USER } from './auth-test-utils';

/** Response fixtures that match the shared contracts exactly (the API client validates them). */

export const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: 'c'.repeat(24),
  status: 'draft',
  revision: 0,
  title: '',
  caption: 'Golden, flaky and warm.',
  hashtags: ['Croissant'],
  platforms: ['instagram'],
  mediaIds: [],
  socialAccountIds: [],
  media: [],
  socialAccounts: [],
  source: 'ai_studio',
  generationId: 'd'.repeat(24),
  createdBy: TEST_USER.id,
  updatedBy: TEST_USER.id,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  scheduledAt: null,
  reviewEvents: [],
  readiness: { ready: true, issues: [] },
  ...overrides,
});

export const makeMedia = (overrides: Partial<Media> = {}): Media => ({
  id: 'a'.repeat(24),
  kind: 'image',
  mimeType: 'image/jpeg',
  originalName: 'croissant.jpg',
  size: 245_000,
  width: 1080,
  height: 1350,
  durationSeconds: null,
  altText: 'A croissant',
  description: '',
  uploadedBy: TEST_USER.id,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  ...overrides,
});

export const makeAccount = (overrides: Partial<SocialAccount> = {}): SocialAccount => ({
  id: 'b'.repeat(24),
  platform: 'instagram',
  externalId: '17841400000000000',
  name: 'Bloom Bakery',
  username: 'bloombakery',
  accountType: 'instagram_professional',
  profileImageUrl: null,
  status: 'connected',
  issue: null,
  grantedPermissions: [],
  missingPermissions: [],
  tokenExpiresAt: null,
  connectedAt: '2026-11-20T10:00:00.000Z',
  lastSyncedAt: null,
  ...overrides,
});

export const MEDIA_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  uploadsEnabled: true,
};
