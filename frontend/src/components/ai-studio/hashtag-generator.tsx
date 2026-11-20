import {
  BUSINESS_CATEGORIES,
  HASHTAG_GROUPS,
  MAX_HASHTAGS_PER_POST,
  SOCIAL_PLATFORM_LABELS,
  WORKSPACE_LANGUAGES,
  hashtagRequestSchema,
  type BusinessCategory,
  type HashtagGeneration,
  type WorkspaceLanguage,
} from '@metaflow/shared';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';
import { generateHashtags } from '@/services/ai-studio.service';
import { CopyButton } from './copy-button';
import { UsageLine } from './usage-line';

const FIELDS = ['topic', 'product', 'audience', 'category', 'platform', 'language'] as const;
type Field = (typeof FIELDS)[number];

export function HashtagGenerator({
  workspaceId,
  category,
  language,
  available,
}: {
  workspaceId: string;
  category: BusinessCategory;
  language: WorkspaceLanguage;
  available: boolean;
}) {
  const [values, setValues] = useState({
    topic: '',
    product: '',
    audience: '',
    category: category,
    platform: 'instagram',
    language: language,
  });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<HashtagGeneration | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const update = (field: Field) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = hashtagRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await generateHashtags(workspaceId, parsed.data);
      setGeneration(result);
      setSelected(new Set(HASHTAG_GROUPS.flatMap((group) => result.output[group.value])));
    } catch (error) {
      const described = describeSubmitError(error, FIELDS);
      setErrors(described.fieldErrors);
      setFormError(described.formError);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (tag: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const ordered = generation
    ? HASHTAG_GROUPS.flatMap((group) => generation.output[group.value]).filter((tag) =>
        selected.has(tag),
      )
    : [];
  const disabled = !available || busy;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Find hashtags</CardTitle>
          <CardDescription>Suggestions grouped from broad to specific.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            {formError ? <FormAlert message={formError} /> : null}
            <FormField label="What is the post about?" error={errors.topic}>
              {(field) => (
                <Input
                  {...field}
                  name="topic"
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
            <FormField label="Target audience" error={errors.audience} hint="Optional.">
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
              <FormField label="Business category" error={errors.category}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="category"
                    value={values.category}
                    onChange={update('category')}
                    disabled={disabled}
                  >
                    {BUSINESS_CATEGORIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
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
            </div>
            <Button type="submit" disabled={disabled}>
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {busy ? 'Finding hashtags…' : 'Suggest hashtags'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="hashtag-results" className="flex flex-col gap-4">
        <h2 id="hashtag-results" className="text-lg font-semibold tracking-tight">
          Hashtags
        </h2>
        {!generation ? (
          <p className="text-muted-foreground bg-card rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            Suggested hashtags will appear here. Pick the ones that fit and copy them.
          </p>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-5">
              {HASHTAG_GROUPS.filter((group) => generation.output[group.value].length > 0).map(
                (group) => (
                  <fieldset key={group.value} className="flex flex-col gap-2">
                    <legend className="text-muted-foreground mb-1 text-xs font-semibold tracking-wider uppercase">
                      {group.label}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {generation.output[group.value].map((tag) => (
                        <label
                          key={tag}
                          className="has-[:checked]:bg-accent has-[:checked]:text-accent-foreground flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={selected.has(tag)}
                            onChange={() => toggle(tag)}
                          />
                          #{tag}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ),
              )}
              <div className="flex flex-wrap items-center gap-3">
                <CopyButton
                  text={ordered.map((tag) => `#${tag}`).join(' ')}
                  label={`Copy selected (${ordered.length})`}
                  disabled={ordered.length === 0}
                />
                {generation.settings.platform === 'instagram' &&
                ordered.length > MAX_HASHTAGS_PER_POST ? (
                  <p className="text-destructive text-xs">
                    Instagram accepts at most {MAX_HASHTAGS_PER_POST} hashtags on one post.
                  </p>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                Hashtags help people find posts about a subject. They don’t guarantee more reach; a
                few relevant ones usually work better than many.
              </p>
              <UsageLine usage={generation.usage} />
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
