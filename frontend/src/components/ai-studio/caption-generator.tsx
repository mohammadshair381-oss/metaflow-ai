import {
  CALL_TO_ACTION_STYLES,
  CAPTION_CHARACTER_LIMITS,
  CAPTION_LENGTHS,
  CONTENT_OBJECTIVES,
  CONTENT_TONES,
  EMOJI_PREFERENCES,
  MAX_CAPTION_VARIATIONS,
  SOCIAL_PLATFORM_LABELS,
  WORKSPACE_LANGUAGES,
  captionRequestSchema,
  type AiGenerationUsage,
  type CaptionRequest,
  type SocialPlatform,
} from '@metaflow/shared';
import { CircleCheck, LoaderCircle, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ZodError } from 'zod';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';
import { generateCaptions } from '@/services/ai-studio.service';
import { createPost } from '@/services/post.service';
import type { CaptionFormValues } from './caption-preset';
import { CopyButton } from './copy-button';
import { UsageLine } from './usage-line';

const FIELDS = [
  'topic',
  'product',
  'audience',
  'platform',
  'objective',
  'tone',
  'language',
  'length',
  'emoji',
  'callToAction',
  'callToActionText',
  'variations',
] as const;
type Field = (typeof FIELDS)[number];

interface ResultItem {
  key: string;
  text: string;
  generationId: string;
  draft:
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'saved'; postId: string }
    | { state: 'error'; message: string };
}

interface Results {
  platform: SocialPlatform;
  request: CaptionRequest;
  items: ResultItem[];
  usage: AiGenerationUsage;
}

let keySequence = 0;
const nextKey = () => `caption-${(keySequence += 1)}`;

export function CaptionGenerator({
  workspaceId,
  initialValues,
  available,
}: {
  workspaceId: string;
  /** Change the component's `key` to load new values (e.g. from a content idea). */
  initialValues: CaptionFormValues;
  /** False when AI generation is not configured on the server. */
  available: boolean;
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generate' | 'more' | null>(null);
  const [results, setResults] = useState<Results | null>(null);

  const update = (field: Field) => (event: { target: { value: string } }) => {
    const value = field === 'variations' ? Number(event.target.value) : event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function run(request: CaptionRequest, mode: 'generate' | 'more') {
    setFormError(null);
    setBusy(mode);
    try {
      const generation = await generateCaptions(workspaceId, request);
      const items = generation.output.captions.map((caption) => ({
        key: nextKey(),
        text: caption.text,
        generationId: generation.id,
        draft: { state: 'idle' } as const,
      }));
      setResults((current) =>
        mode === 'more' && current
          ? { ...current, items: [...current.items, ...items], usage: generation.usage }
          : { platform: generation.settings.platform, request, items, usage: generation.usage },
      );
    } catch (error) {
      const described = describeSubmitError(error, FIELDS);
      setErrors(described.fieldErrors);
      setFormError(described.formError);
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = captionRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    void run(parsed.data, 'generate');
  }

  function another() {
    if (!results) return;
    const avoid = results.items.map((item) => item.text).slice(-MAX_CAPTION_VARIATIONS * 2);
    void run({ ...results.request, variations: 1, avoid }, 'more');
  }

  const setItem = (key: string, change: Partial<ResultItem>) =>
    setResults((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.key === key ? { ...item, ...change } : item)),
          }
        : current,
    );

  async function saveDraft(item: ResultItem) {
    if (!results) return;
    setItem(item.key, { draft: { state: 'saving' } });
    try {
      const post = await createPost(workspaceId, {
        caption: item.text,
        platforms: [results.platform],
        generationId: item.generationId,
      });
      setItem(item.key, { draft: { state: 'saved', postId: post.id } });
    } catch (error) {
      const message =
        error instanceof ZodError
          ? (error.issues[0]?.message ?? 'This caption cannot be saved.')
          : (describeSubmitError(error, []).formError ?? 'The draft could not be saved.');
      setItem(item.key, { draft: { state: 'error', message } });
    }
  }

  const disabled = !available || busy !== null;
  const limit = results ? CAPTION_CHARACTER_LIMITS[results.platform] : 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Write captions</CardTitle>
          <CardDescription>
            Describe the post. AI Studio writes it in your brand voice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            {formError ? <FormAlert message={formError} /> : null}
            <FormField
              label="What is the post about?"
              error={errors.topic}
              hint="For example: our new weekend croissant box."
            >
              {(field) => (
                <Textarea
                  {...field}
                  name="topic"
                  rows={3}
                  value={values.topic}
                  onChange={update('topic')}
                  disabled={disabled}
                />
              )}
            </FormField>
            <FormField label="Product or service" error={errors.product} hint="Optional.">
              {(field) => (
                <Input
                  {...field}
                  name="product"
                  value={values.product}
                  onChange={update('product')}
                  disabled={disabled}
                />
              )}
            </FormField>
            <FormField
              label="Target audience"
              error={errors.audience}
              hint="Optional. Leave empty to use your brand voice."
            >
              {(field) => (
                <Input
                  {...field}
                  name="audience"
                  value={values.audience}
                  onChange={update('audience')}
                  disabled={disabled}
                />
              )}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Platform" error={errors.platform}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="platform"
                    value={values.platform}
                    onChange={update('platform')}
                    disabled={disabled}
                  >
                    {(['instagram', 'facebook'] as const).map((platform) => (
                      <option key={platform} value={platform}>
                        {SOCIAL_PLATFORM_LABELS[platform]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Goal" error={errors.objective}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="objective"
                    value={values.objective}
                    onChange={update('objective')}
                    disabled={disabled}
                  >
                    {CONTENT_OBJECTIVES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Tone" error={errors.tone}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="tone"
                    value={values.tone}
                    onChange={update('tone')}
                    disabled={disabled}
                  >
                    {CONTENT_TONES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Language" error={errors.language}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="language"
                    value={values.language}
                    onChange={update('language')}
                    disabled={disabled}
                  >
                    {WORKSPACE_LANGUAGES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Length" error={errors.length}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="length"
                    value={values.length}
                    onChange={update('length')}
                    disabled={disabled}
                  >
                    {CAPTION_LENGTHS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Emojis" error={errors.emoji}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="emoji"
                    value={values.emoji}
                    onChange={update('emoji')}
                    disabled={disabled}
                  >
                    {EMOJI_PREFERENCES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Call to action" error={errors.callToAction}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="callToAction"
                    value={values.callToAction}
                    onChange={update('callToAction')}
                    disabled={disabled}
                  >
                    {CALL_TO_ACTION_STYLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Number of captions" error={errors.variations}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="variations"
                    value={String(values.variations)}
                    onChange={update('variations')}
                    disabled={disabled}
                  >
                    {Array.from({ length: MAX_CAPTION_VARIATIONS }, (_, index) => index + 1).map(
                      (count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ),
                    )}
                  </NativeSelect>
                )}
              </FormField>
            </div>
            {values.callToAction !== 'none' ? (
              <FormField
                label="What should readers do?"
                error={errors.callToActionText}
                hint="Optional, e.g. order on WhatsApp. Leave empty to let AI Studio choose."
              >
                {(field) => (
                  <Input
                    {...field}
                    name="callToActionText"
                    value={values.callToActionText}
                    onChange={update('callToActionText')}
                    disabled={disabled}
                  />
                )}
              </FormField>
            ) : null}
            <Button type="submit" disabled={disabled}>
              {busy === 'generate' ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {busy === 'generate' ? 'Writing captions…' : 'Generate captions'}
            </Button>
            {busy ? (
              <p role="status" className="text-muted-foreground text-xs">
                This can take up to a minute.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="caption-results" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="caption-results" className="text-lg font-semibold tracking-tight">
            Captions
          </h2>
          {results ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run(results.request, 'generate')}
                disabled={disabled}
              >
                <RefreshCw aria-hidden />
                Regenerate
              </Button>
              <Button variant="outline" size="sm" onClick={another} disabled={disabled}>
                {busy === 'more' ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Plus aria-hidden />
                )}
                Another variation
              </Button>
            </div>
          ) : null}
        </div>
        {!results ? (
          <p className="text-muted-foreground bg-card rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            Your captions will appear here. You can edit them before copying or saving.
          </p>
        ) : (
          <>
            {results.items.map((item, index) => {
              const tooLong = item.text.length > limit;
              const id = `caption-${item.key}`;
              return (
                <Card key={item.key}>
                  <CardContent className="flex flex-col gap-3">
                    <label htmlFor={id} className="text-sm font-medium">
                      Caption {index + 1}
                    </label>
                    <Textarea
                      id={id}
                      rows={6}
                      value={item.text}
                      aria-invalid={tooLong}
                      onChange={(event) =>
                        setItem(item.key, { text: event.target.value, draft: { state: 'idle' } })
                      }
                    />
                    <p
                      className={
                        tooLong
                          ? 'text-destructive text-xs font-medium'
                          : 'text-muted-foreground text-xs'
                      }
                    >
                      {item.text.length} / {limit} characters
                      {tooLong ? ` — too long for ${SOCIAL_PLATFORM_LABELS[results.platform]}` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={item.text} disabled={item.text.trim() === ''} />
                      <Button
                        size="sm"
                        onClick={() => void saveDraft(item)}
                        disabled={
                          item.draft.state === 'saving' ||
                          item.draft.state === 'saved' ||
                          tooLong ||
                          item.text.trim() === ''
                        }
                      >
                        {item.draft.state === 'saving' ? (
                          <LoaderCircle className="animate-spin" aria-hidden />
                        ) : null}
                        {item.draft.state === 'saved' ? 'Saved' : 'Save as draft'}
                      </Button>
                      {item.draft.state === 'saved' ? (
                        <span
                          role="status"
                          className="text-success flex items-center gap-1 text-sm"
                        >
                          <CircleCheck className="size-4" aria-hidden />
                          Saved as a draft.{' '}
                          <Link to={`/posts/${item.draft.postId}`} className="underline">
                            Open the draft
                          </Link>
                        </span>
                      ) : null}
                      {item.draft.state === 'error' ? (
                        <span role="alert" className="text-destructive text-sm">
                          {item.draft.message}
                        </span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <UsageLine usage={results.usage} />
          </>
        )}
      </section>
    </div>
  );
}
