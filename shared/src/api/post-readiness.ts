import { CAPTION_CHARACTER_LIMITS, MAX_HASHTAGS_PER_POST } from './ai-studio';
import type { MediaKind } from './media';
import type { ReadinessIssue } from './posts';
import {
  SOCIAL_PLATFORM_LABELS,
  type SocialAccountStatus,
  type SocialPlatform,
} from './social-accounts';

/**
 * Platform rules a post must meet before it can be submitted for approval. Separate from the
 * basic draft rules (a draft can be saved while these fail) and from the publishing step, which
 * will add live checks against Meta. Each platform's rules live in one place so new platforms
 * add a function rather than change the others.
 *
 * The limits follow Meta's documentation as understood today and still need confirming with a
 * real publish (see docs/architecture.md, "Content management").
 */
export interface ReadinessInput {
  platforms: readonly SocialPlatform[];
  caption: string;
  hashtags: readonly string[];
  media: readonly { kind: MediaKind; mimeType: string; size: number }[];
  accounts: readonly { platform: SocialPlatform; status: SocialAccountStatus }[];
  /** Referenced items that no longer exist. */
  missingMediaCount: number;
  missingAccountCount: number;
}

export const PLATFORM_MEDIA_RULES = {
  facebook: {
    imageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    videoTypes: ['video/mp4'],
    maxItems: 10,
    requiresMedia: false,
  },
  instagram: {
    imageTypes: ['image/jpeg'],
    videoTypes: ['video/mp4'],
    maxItems: 10,
    maxImageBytes: 8 * 1024 * 1024,
    requiresMedia: true,
  },
} as const;

const issue = (
  platform: SocialPlatform | null,
  field: ReadinessIssue['field'],
  message: string,
): ReadinessIssue => ({ platform, field, message });

function mediaIssues(platform: SocialPlatform, input: ReadinessInput): ReadinessIssue[] {
  const rules = PLATFORM_MEDIA_RULES[platform];
  const label = SOCIAL_PLATFORM_LABELS[platform];
  const issues: ReadinessIssue[] = [];
  const images = input.media.filter((item) => item.kind === 'image');
  const videos = input.media.filter((item) => item.kind === 'video');

  if (rules.requiresMedia && input.media.length === 0) {
    issues.push(issue(platform, 'media', `${label} posts need at least one photo or video.`));
  }
  if (input.media.length > rules.maxItems) {
    issues.push(
      issue(platform, 'media', `${label} posts can have at most ${rules.maxItems} items.`),
    );
  }
  if (images.some((item) => !(rules.imageTypes as readonly string[]).includes(item.mimeType))) {
    const allowed = platform === 'instagram' ? 'JPEG' : 'JPEG, PNG or GIF';
    issues.push(
      issue(platform, 'media', `${label} accepts ${allowed} photos. Convert the others.`),
    );
  }
  if (videos.some((item) => !(rules.videoTypes as readonly string[]).includes(item.mimeType))) {
    issues.push(
      issue(platform, 'media', `${label} videos must be MP4. Convert WebM videos first.`),
    );
  }
  if (platform === 'facebook' && videos.length > 0 && input.media.length > 1) {
    issues.push(
      issue(platform, 'media', 'Facebook posts can have one video, or photos only, not both.'),
    );
  }
  if (
    platform === 'instagram' &&
    images.some((item) => item.size > PLATFORM_MEDIA_RULES.instagram.maxImageBytes)
  ) {
    issues.push(issue(platform, 'media', 'Instagram photos can be at most 8 MB.'));
  }
  return issues;
}

/** Hashtags written into the caption count towards Instagram's limit too. */
const captionHashtagCount = (caption: string) =>
  (caption.match(/#[\p{L}\p{M}\p{N}_]+/gu) ?? []).length;

export function checkPostReadiness(input: ReadinessInput): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (input.platforms.length === 0) {
    issues.push(issue(null, 'platforms', 'Choose at least one platform.'));
  }
  if (!input.caption && input.media.length === 0) {
    issues.push(issue(null, 'caption', 'Add a caption or media.'));
  }
  if (input.missingMediaCount > 0) {
    issues.push(issue(null, 'media', 'An attached media item no longer exists. Remove it.'));
  }
  if (input.missingAccountCount > 0) {
    issues.push(
      issue(null, 'socialAccounts', 'A selected account is no longer connected. Remove it.'),
    );
  }

  for (const platform of input.platforms) {
    const label = SOCIAL_PLATFORM_LABELS[platform];
    const accounts = input.accounts.filter((account) => account.platform === platform);
    if (accounts.length === 0) {
      issues.push(
        issue(
          platform,
          'socialAccounts',
          `Select ${platform === 'instagram' ? 'an' : 'a'} ${label} account. If none is listed, connect one under Social Accounts first.`,
        ),
      );
    } else if (accounts.some((account) => account.status !== 'connected')) {
      issues.push(
        issue(platform, 'socialAccounts', `A selected ${label} account needs to be reconnected.`),
      );
    }
    if (input.caption.length > CAPTION_CHARACTER_LIMITS[platform]) {
      issues.push(
        issue(
          platform,
          'caption',
          `${label} captions can have at most ${CAPTION_CHARACTER_LIMITS[platform]} characters.`,
        ),
      );
    }
    if (
      platform === 'instagram' &&
      input.hashtags.length + captionHashtagCount(input.caption) > MAX_HASHTAGS_PER_POST
    ) {
      issues.push(
        issue(platform, 'hashtags', `Instagram allows at most ${MAX_HASHTAGS_PER_POST} hashtags.`),
      );
    }
    issues.push(...mediaIssues(platform, input));
  }
  return issues;
}
