import { z } from 'zod';
import { SOCIAL_PLATFORMS } from './social-accounts';
import {
  BUSINESS_CATEGORIES,
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_LANGUAGES,
  recordIdSchema,
} from './workspaces';

/** The values of an option list, typed as a non-empty tuple for z.enum. */
const valuesOf = <const T extends readonly { value: string }[]>(list: T) =>
  list.map((item) => item.value) as unknown as [T[number]['value'], ...T[number]['value'][]];

export function optionLabel<T extends readonly { value: string; label: string }[]>(
  list: T,
  value: T[number]['value'],
): string {
  return list.find((item) => item.value === value)?.label ?? value;
}

export const AI_FEATURES = ['caption', 'hashtags', 'ideas'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * AI providers the server can be configured with. Which one is used, and which model, is
 * decided by server configuration only; clients can never choose either.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
};

export const CONTENT_TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'promotional', label: 'Promotional' },
  { value: 'educational', label: 'Educational' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'humorous', label: 'Humorous' },
] as const;
export type ContentTone = (typeof CONTENT_TONES)[number]['value'];

export const CONTENT_OBJECTIVES = [
  { value: 'brand_awareness', label: 'Brand awareness' },
  { value: 'product_promotion', label: 'Product promotion' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'sales', label: 'Sales' },
  { value: 'education', label: 'Education' },
  { value: 'announcement', label: 'Announcement' },
] as const;
export type ContentObjective = (typeof CONTENT_OBJECTIVES)[number]['value'];

export const CAPTION_LENGTHS = [
  { value: 'short', label: 'Short (1–2 sentences)' },
  { value: 'medium', label: 'Medium (3–5 sentences)' },
  { value: 'long', label: 'Long (a few short paragraphs)' },
] as const;
export type CaptionLength = (typeof CAPTION_LENGTHS)[number]['value'];

export const EMOJI_PREFERENCES = [
  { value: 'none', label: 'No emojis' },
  { value: 'few', label: 'A few emojis' },
  { value: 'many', label: 'Plenty of emojis' },
] as const;
export type EmojiPreference = (typeof EMOJI_PREFERENCES)[number]['value'];

export const CALL_TO_ACTION_STYLES = [
  { value: 'none', label: 'No call to action' },
  { value: 'soft', label: 'Gentle call to action' },
  { value: 'direct', label: 'Direct call to action' },
] as const;
export type CallToActionStyle = (typeof CALL_TO_ACTION_STYLES)[number]['value'];

export const IDEA_TYPES = [
  { value: 'educational', label: 'Educational' },
  { value: 'promotional', label: 'Promotional' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'product_showcase', label: 'Product showcase' },
  { value: 'brand_awareness', label: 'Brand awareness' },
  { value: 'behind_the_scenes', label: 'Behind the scenes' },
] as const;
export type IdeaType = (typeof IDEA_TYPES)[number]['value'];

export const IDEA_FORMATS = [
  { value: 'image', label: 'Single image' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'reel', label: 'Reel or short video' },
  { value: 'story', label: 'Story' },
  { value: 'video', label: 'Video' },
  { value: 'text', label: 'Text post' },
] as const;
export type IdeaFormat = (typeof IDEA_FORMATS)[number]['value'];

export const MAX_CAPTION_VARIATIONS = 5;
/** Instagram's caption limit is 2,200 characters. Facebook allows more; MetaFlow caps it here. */
export const CAPTION_CHARACTER_LIMITS = { facebook: 5000, instagram: 2200 } as const;
export const MAX_HASHTAGS_PER_GROUP = 15;
/** Instagram accepts at most 30 hashtags on one post. */
export const MAX_HASHTAGS_PER_POST = 30;
export const IDEA_COUNT = { min: 3, max: 10, default: 6 } as const;

const languageValues = valuesOf(WORKSPACE_LANGUAGES);
const platformSchema = z.enum(SOCIAL_PLATFORMS, { error: 'Choose Facebook or Instagram' });
const languageSchema = z.enum(languageValues, { error: 'Choose a language' });
const toneSchema = z.enum(valuesOf(CONTENT_TONES), { error: 'Choose a tone' });
const emojiSchema = z.enum(valuesOf(EMOJI_PREFERENCES), { error: 'Choose an emoji preference' });

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const singleLine = (max: number) =>
  text(max).refine((value) => !CONTROL_CHARACTERS.test(value), {
    error: 'Use a single line without special characters',
  });

// ── Caption generator ─────────────────────────────────────────────────────────────────────

/**
 * Strict: unknown fields are rejected, so a client cannot slip in a provider, model or
 * prompt. Tone, language and emoji use default to the workspace's brand voice when omitted.
 */
export const captionRequestSchema = z.strictObject({
  topic: text(300).min(1, 'Describe what the post is about'),
  product: text(500).default(''),
  audience: text(300).default(''),
  platform: platformSchema,
  objective: z.enum(valuesOf(CONTENT_OBJECTIVES), { error: 'Choose a goal' }).default('engagement'),
  tone: toneSchema.optional(),
  language: languageSchema.optional(),
  length: z.enum(valuesOf(CAPTION_LENGTHS), { error: 'Choose a length' }).default('medium'),
  emoji: emojiSchema.optional(),
  callToAction: z
    .enum(valuesOf(CALL_TO_ACTION_STYLES), { error: 'Choose a call to action' })
    .default('soft'),
  callToActionText: singleLine(150).default(''),
  variations: z
    .int({ error: 'Choose how many captions to write' })
    .min(1, 'Ask for at least 1 caption')
    .max(MAX_CAPTION_VARIATIONS, `Ask for at most ${MAX_CAPTION_VARIATIONS} captions`)
    .default(3),
  /** Captions already on screen: new ones must differ from them ("another variation"). */
  avoid: z
    .array(z.string().max(CAPTION_CHARACTER_LIMITS.facebook))
    .max(MAX_CAPTION_VARIATIONS * 2)
    .default([]),
});
export type CaptionRequest = z.input<typeof captionRequestSchema>;

/** The settings a caption generation actually used, after brand voice defaults. */
export const captionSettingsSchema = z.object({
  topic: z.string(),
  product: z.string(),
  audience: z.string(),
  platform: platformSchema,
  objective: z.enum(valuesOf(CONTENT_OBJECTIVES)),
  tone: toneSchema,
  language: languageSchema,
  length: z.enum(valuesOf(CAPTION_LENGTHS)),
  emoji: emojiSchema,
  callToAction: z.enum(valuesOf(CALL_TO_ACTION_STYLES)),
  callToActionText: z.string(),
  variations: z.number().int(),
});
export type CaptionSettings = z.infer<typeof captionSettingsSchema>;

export const captionOutputSchema = z.object({
  captions: z.array(z.object({ text: z.string() })),
});
export type CaptionOutput = z.infer<typeof captionOutputSchema>;

// ── Hashtag generator ─────────────────────────────────────────────────────────────────────

export const hashtagRequestSchema = z.strictObject({
  topic: text(300).min(1, 'Describe what the post is about'),
  product: text(500).default(''),
  audience: text(300).default(''),
  /** Defaults to the workspace's business category. */
  category: z.enum(valuesOf(BUSINESS_CATEGORIES), { error: 'Choose a category' }).optional(),
  platform: platformSchema,
  language: languageSchema.optional(),
});
export type HashtagRequest = z.input<typeof hashtagRequestSchema>;

export const hashtagSettingsSchema = z.object({
  topic: z.string(),
  product: z.string(),
  audience: z.string(),
  category: z.enum(valuesOf(BUSINESS_CATEGORIES)),
  platform: platformSchema,
  language: languageSchema,
});
export type HashtagSettings = z.infer<typeof hashtagSettingsSchema>;

export const HASHTAG_GROUPS = [
  { value: 'broad', label: 'Broad' },
  { value: 'niche', label: 'Niche' },
  { value: 'industry', label: 'Industry' },
  { value: 'product', label: 'Product-specific' },
] as const;
export type HashtagGroup = (typeof HASHTAG_GROUPS)[number]['value'];

/** Hashtags are stored without the leading "#". */
export const hashtagOutputSchema = z.object({
  broad: z.array(z.string()),
  niche: z.array(z.string()),
  industry: z.array(z.string()),
  product: z.array(z.string()),
});
export type HashtagOutput = z.infer<typeof hashtagOutputSchema>;

/** One hashtag: letters (any script), marks, digits and underscores; stored without "#". */
export const HASHTAG_PATTERN = /^[\p{L}\p{M}\p{N}_]{1,60}$/u;

// ── Content ideas ─────────────────────────────────────────────────────────────────────────

export const ideasRequestSchema = z.strictObject({
  /** Optional theme, e.g. "Eid collection" or "new winter menu". */
  focus: text(300).default(''),
  /** Leave out to get ideas for both platforms. */
  platform: platformSchema.optional(),
  /** Leave empty for a mix of every type. */
  types: z
    .array(z.enum(valuesOf(IDEA_TYPES), { error: 'Unknown idea type' }))
    .max(IDEA_TYPES.length)
    .default([])
    .transform((types) => [...new Set(types)]),
  count: z
    .int({ error: 'Choose how many ideas to get' })
    .min(IDEA_COUNT.min, `Ask for at least ${IDEA_COUNT.min} ideas`)
    .max(IDEA_COUNT.max, `Ask for at most ${IDEA_COUNT.max} ideas`)
    .default(IDEA_COUNT.default),
  language: languageSchema.optional(),
});
export type IdeasRequest = z.input<typeof ideasRequestSchema>;

export const ideasSettingsSchema = z.object({
  focus: z.string(),
  platform: platformSchema.nullable(),
  types: z.array(z.enum(valuesOf(IDEA_TYPES))),
  count: z.number().int(),
  language: languageSchema,
});
export type IdeasSettings = z.infer<typeof ideasSettingsSchema>;

export const contentIdeaSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(valuesOf(IDEA_TYPES)),
  format: z.enum(valuesOf(IDEA_FORMATS)),
  platform: platformSchema,
  angle: z.string(),
  callToAction: z.string().nullable(),
});
export type ContentIdea = z.infer<typeof contentIdeaSchema>;

export const ideasOutputSchema = z.object({ ideas: z.array(contentIdeaSchema) });
export type IdeasOutput = z.infer<typeof ideasOutputSchema>;

// ── Generations, usage and status ─────────────────────────────────────────────────────────

/** Token counts are null when the provider did not report them: never shown as zero. */
export const aiGenerationUsageSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  /** Only when the server has pricing configured for the model that answered. */
  estimatedCostUsd: z.number().nullable(),
});
export type AiGenerationUsage = z.infer<typeof aiGenerationUsageSchema>;

const generationBase = {
  id: z.string(),
  /** Who generated it (a workspace member). */
  userId: z.string(),
  createdAt: z.iso.datetime(),
  usage: aiGenerationUsageSchema,
};

export const captionGenerationSchema = z.object({
  ...generationBase,
  feature: z.literal('caption'),
  settings: captionSettingsSchema,
  output: captionOutputSchema,
});
export const hashtagGenerationSchema = z.object({
  ...generationBase,
  feature: z.literal('hashtags'),
  settings: hashtagSettingsSchema,
  output: hashtagOutputSchema,
});
export const ideasGenerationSchema = z.object({
  ...generationBase,
  feature: z.literal('ideas'),
  settings: ideasSettingsSchema,
  output: ideasOutputSchema,
});
export const aiGenerationSchema = z.discriminatedUnion('feature', [
  captionGenerationSchema,
  hashtagGenerationSchema,
  ideasGenerationSchema,
]);
export type CaptionGeneration = z.infer<typeof captionGenerationSchema>;
export type HashtagGeneration = z.infer<typeof hashtagGenerationSchema>;
export type IdeasGeneration = z.infer<typeof ideasGenerationSchema>;
export type AiGeneration = z.infer<typeof aiGenerationSchema>;

export const captionGenerationResponseSchema = z.object({ generation: captionGenerationSchema });
export const hashtagGenerationResponseSchema = z.object({ generation: hashtagGenerationSchema });
export const ideasGenerationResponseSchema = z.object({ generation: ideasGenerationSchema });

export const AI_HISTORY_PAGE_SIZE = { default: 20, max: 50 } as const;

export const aiGenerationListQuerySchema = z.object({
  feature: z.enum(AI_FEATURES).optional(),
  /** ID of the last generation already shown: returns older ones. */
  before: recordIdSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(AI_HISTORY_PAGE_SIZE.max)
    .default(AI_HISTORY_PAGE_SIZE.default),
});
export type AiGenerationListQuery = z.input<typeof aiGenerationListQuerySchema>;

export const aiGenerationListResponseSchema = z.object({
  generations: z.array(aiGenerationSchema),
  /** Pass as `before` to load older generations; null when there are none. */
  nextCursor: z.string().nullable(),
});
export type AiGenerationListResponse = z.infer<typeof aiGenerationListResponseSchema>;

export const aiStatusResponseSchema = z.object({
  configured: z.boolean(),
  provider: z.enum(AI_PROVIDERS).nullable(),
  model: z.string().nullable(),
  /** True when the server can estimate costs (pricing configured). */
  costEstimates: z.boolean(),
});
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;

export const aiUsageSummarySchema = z.object({
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  requests: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  /** Sums over the requests that reported token counts. */
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  totalTokens: z.number().int(),
  requestsWithoutTokenData: z.number().int(),
  /** Null when no request in the period has a cost estimate. */
  estimatedCostUsd: z.number().nullable(),
  requestsWithoutCost: z.number().int(),
});
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;
export const aiUsageSummaryResponseSchema = z.object({ usage: aiUsageSummarySchema });

// ── Brand voice ───────────────────────────────────────────────────────────────────────────

export const BRAND_VOICE_LIMITS = {
  targetAudience: 500,
  personality: 300,
  writingStyle: 500,
  additionalInstructions: 1000,
  phrases: 25,
  phraseLength: 60,
} as const;

const phraseListSchema = z
  .array(singleLine(BRAND_VOICE_LIMITS.phraseLength).min(1, 'Remove empty entries'), {
    error: 'Enter a list of words or phrases',
  })
  .max(BRAND_VOICE_LIMITS.phrases, `Use at most ${BRAND_VOICE_LIMITS.phrases} entries`)
  .transform((phrases) => {
    const seen = new Set<string>();
    return phrases.filter((phrase) => {
      const key = phrase.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/**
 * Replaces the whole brand voice. `description` and `language` are the workspace's own
 * "About the business" and content language, shared with workspace settings.
 */
export const updateBrandVoiceRequestSchema = z.strictObject({
  description: text(WORKSPACE_DESCRIPTION_MAX_LENGTH),
  language: languageSchema,
  targetAudience: text(BRAND_VOICE_LIMITS.targetAudience),
  tone: toneSchema,
  personality: text(BRAND_VOICE_LIMITS.personality),
  writingStyle: text(BRAND_VOICE_LIMITS.writingStyle),
  wordsToUse: phraseListSchema,
  wordsToAvoid: phraseListSchema,
  emojiPreference: emojiSchema,
  additionalInstructions: text(BRAND_VOICE_LIMITS.additionalInstructions),
});
export type UpdateBrandVoiceRequest = z.input<typeof updateBrandVoiceRequestSchema>;

export const brandVoiceSchema = z.object({
  description: z.string(),
  language: languageSchema,
  targetAudience: z.string(),
  tone: toneSchema,
  personality: z.string(),
  writingStyle: z.string(),
  wordsToUse: z.array(z.string()),
  wordsToAvoid: z.array(z.string()),
  emojiPreference: emojiSchema,
  additionalInstructions: z.string(),
  /** False until the brand voice has been saved once; the fields then hold defaults. */
  configured: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type BrandVoice = z.infer<typeof brandVoiceSchema>;
export const brandVoiceResponseSchema = z.object({ brandVoice: brandVoiceSchema });

/** Used until a brand voice is saved. */
export const DEFAULT_BRAND_TONE: ContentTone = 'friendly';
export const DEFAULT_EMOJI_PREFERENCE: EmojiPreference = 'few';
