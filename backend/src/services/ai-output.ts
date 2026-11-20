import {
  CAPTION_CHARACTER_LIMITS,
  HASHTAG_GROUPS,
  HASHTAG_PATTERN,
  IDEA_FORMATS,
  IDEA_TYPES,
  MAX_HASHTAGS_PER_GROUP,
  type CaptionOutput,
  type CaptionSettings,
  type ContentIdea,
  type HashtagOutput,
  type IdeasOutput,
  type IdeasSettings,
} from '@metaflow/shared';
import { z } from 'zod';

/**
 * Checks and cleans what a model returned, whatever the provider. Structured outputs make the
 * shape likely, not guaranteed, and the providers cannot enforce lengths or counts. Items that
 * break a rule are dropped; null means nothing usable is left.
 */

const captionsShape = z.object({ captions: z.array(z.object({ text: z.string() })) });

export function cleanCaptions(output: unknown, settings: CaptionSettings): CaptionOutput | null {
  const parsed = captionsShape.safeParse(output);
  if (!parsed.success) return null;
  const limit = CAPTION_CHARACTER_LIMITS[settings.platform];
  const seen = new Set<string>();
  const captions = parsed.data.captions
    .map((caption) => caption.text.trim())
    .filter((text) => {
      if (text === '' || text.length > limit || seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .slice(0, settings.variations)
    .map((text) => ({ text }));
  return captions.length > 0 ? { captions } : null;
}

const hashtagShape = z.object({
  broad: z.array(z.string()),
  niche: z.array(z.string()),
  industry: z.array(z.string()),
  product: z.array(z.string()),
});

export function normalizeHashtag(value: string): string | null {
  const tag = value.trim().replace(/^#+/, '').replace(/\s+/g, '');
  return HASHTAG_PATTERN.test(tag) ? tag : null;
}

export function cleanHashtags(output: unknown): HashtagOutput | null {
  const parsed = hashtagShape.safeParse(output);
  if (!parsed.success) return null;
  // Across groups, in group order: a hashtag appears once, in the first group that has it.
  const seen = new Set<string>();
  const result = { broad: [], niche: [], industry: [], product: [] } as HashtagOutput;
  for (const { value: group } of HASHTAG_GROUPS) {
    for (const raw of parsed.data[group]) {
      const tag = normalizeHashtag(raw);
      const key = tag?.toLocaleLowerCase();
      if (!tag || !key || seen.has(key) || result[group].length >= MAX_HASHTAGS_PER_GROUP) continue;
      seen.add(key);
      result[group].push(tag);
    }
  }
  return seen.size > 0 ? result : null;
}

const ideaShape = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(800),
  type: z.enum(
    IDEA_TYPES.map((type) => type.value) as [ContentIdea['type'], ...ContentIdea['type'][]],
  ),
  format: z.enum(
    IDEA_FORMATS.map((format) => format.value) as [
      ContentIdea['format'],
      ...ContentIdea['format'][],
    ],
  ),
  platform: z.enum(['facebook', 'instagram']),
  angle: z.string().trim().max(400),
  callToAction: z.string().trim().max(200),
});

export function cleanIdeas(output: unknown, settings: IdeasSettings): IdeasOutput | null {
  const parsed = z.object({ ideas: z.array(z.unknown()) }).safeParse(output);
  if (!parsed.success) return null;
  const ideas: ContentIdea[] = parsed.data.ideas.flatMap((item) => {
    const idea = ideaShape.safeParse(item);
    if (!idea.success) return [];
    if (settings.types.length > 0 && !settings.types.includes(idea.data.type)) return [];
    if (settings.platform && idea.data.platform !== settings.platform) return [];
    return [{ ...idea.data, callToAction: idea.data.callToAction || null }];
  });
  const result = ideas.slice(0, settings.count);
  return result.length > 0 ? { ideas: result } : null;
}
