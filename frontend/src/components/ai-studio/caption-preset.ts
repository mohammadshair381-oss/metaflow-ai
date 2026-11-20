import type {
  BrandVoice,
  CallToActionStyle,
  CaptionLength,
  ContentIdea,
  ContentObjective,
  ContentTone,
  EmojiPreference,
  IdeaType,
  SocialPlatform,
  WorkspaceLanguage,
} from '@metaflow/shared';

export interface CaptionFormValues {
  topic: string;
  product: string;
  audience: string;
  platform: SocialPlatform;
  objective: ContentObjective;
  tone: ContentTone;
  language: WorkspaceLanguage;
  length: CaptionLength;
  emoji: EmojiPreference;
  callToAction: CallToActionStyle;
  callToActionText: string;
  variations: number;
}

/** Starting values: the brand voice supplies tone, language and emoji use. */
export function captionDefaults(voice: BrandVoice): CaptionFormValues {
  return {
    topic: '',
    product: '',
    audience: '',
    platform: 'instagram',
    objective: 'engagement',
    tone: voice.tone,
    language: voice.language,
    length: 'medium',
    emoji: voice.emojiPreference,
    callToAction: 'soft',
    callToActionText: '',
    variations: 3,
  };
}

const OBJECTIVE_FOR_IDEA: Record<IdeaType, ContentObjective> = {
  educational: 'education',
  promotional: 'product_promotion',
  engagement: 'engagement',
  seasonal: 'product_promotion',
  product_showcase: 'product_promotion',
  brand_awareness: 'brand_awareness',
  behind_the_scenes: 'brand_awareness',
};

/** Turns a content idea into a ready-to-generate caption request. */
export function captionValuesFromIdea(idea: ContentIdea, voice: BrandVoice): CaptionFormValues {
  return {
    ...captionDefaults(voice),
    topic: `${idea.title}: ${idea.description}`.slice(0, 300).trim(),
    platform: idea.platform,
    objective: OBJECTIVE_FOR_IDEA[idea.type],
    callToAction: idea.callToAction ? 'soft' : 'none',
    callToActionText: (idea.callToAction ?? '').slice(0, 150),
  };
}
