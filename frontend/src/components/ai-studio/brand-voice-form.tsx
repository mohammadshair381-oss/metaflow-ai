import {
  BRAND_VOICE_LIMITS,
  CONTENT_TONES,
  EMOJI_PREFERENCES,
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_LANGUAGES,
  updateBrandVoiceRequestSchema,
  type BrandVoice,
} from '@metaflow/shared';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';
import { saveBrandVoice } from '@/services/ai-studio.service';

const FIELDS = [
  'description',
  'language',
  'targetAudience',
  'tone',
  'personality',
  'writingStyle',
  'wordsToUse',
  'wordsToAvoid',
  'emojiPreference',
  'additionalInstructions',
] as const;
type Field = (typeof FIELDS)[number];

/** One phrase per line in the form, a list in the API. */
const toLines = (phrases: string[]) => phrases.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function BrandVoiceForm({
  workspaceId,
  voice,
  canEdit,
  onSaved,
}: {
  workspaceId: string;
  voice: BrandVoice;
  /** Owners edit; staff see the brand voice read-only. */
  canEdit: boolean;
  onSaved: (voice: BrandVoice) => void;
}) {
  const [values, setValues] = useState({
    description: voice.description,
    language: voice.language,
    targetAudience: voice.targetAudience,
    tone: voice.tone,
    personality: voice.personality,
    writingStyle: voice.writingStyle,
    wordsToUse: toLines(voice.wordsToUse),
    wordsToAvoid: toLines(voice.wordsToAvoid),
    emojiPreference: voice.emojiPreference,
    additionalInstructions: voice.additionalInstructions,
  });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (field: Field) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaved(false);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = updateBrandVoiceRequestSchema.safeParse({
      ...values,
      wordsToUse: fromLines(values.wordsToUse),
      wordsToAvoid: fromLines(values.wordsToAvoid),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const result = await saveBrandVoice(workspaceId, parsed.data);
      onSaved(result);
      setSaved(true);
    } catch (error) {
      const described = describeSubmitError(error, FIELDS);
      setErrors(described.fieldErrors);
      setFormError(described.formError);
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEdit || saving;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand voice</CardTitle>
        <CardDescription>
          How your content should sound. AI Studio uses this for every caption, hashtag and idea.
          {voice.configured ? '' : ' Until you save it, only your business description is used.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          {!canEdit ? (
            <p className="bg-muted rounded-md px-3 py-2.5 text-sm">
              Only the workspace owner can change the brand voice.
            </p>
          ) : null}
          {formError ? <FormAlert message={formError} /> : null}
          <FormField
            label="About the business"
            error={errors.description}
            hint="The same description as in workspace settings."
          >
            {(field) => (
              <Textarea
                {...field}
                name="description"
                rows={3}
                maxLength={WORKSPACE_DESCRIPTION_MAX_LENGTH}
                value={values.description}
                onChange={update('description')}
                disabled={disabled}
              />
            )}
          </FormField>
          <FormField
            label="Target audience"
            error={errors.targetAudience}
            hint="Who you are talking to."
          >
            {(field) => (
              <Textarea
                {...field}
                name="targetAudience"
                rows={2}
                maxLength={BRAND_VOICE_LIMITS.targetAudience}
                value={values.targetAudience}
                onChange={update('targetAudience')}
                disabled={disabled}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Preferred tone" error={errors.tone}>
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
            <FormField label="Content language" error={errors.language}>
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
            <FormField label="Emojis" error={errors.emojiPreference}>
              {(field) => (
                <NativeSelect
                  {...field}
                  name="emojiPreference"
                  value={values.emojiPreference}
                  onChange={update('emojiPreference')}
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
          </div>
          <FormField
            label="Brand personality"
            error={errors.personality}
            hint="For example: warm, expert, a little playful."
          >
            {(field) => (
              <Input
                {...field}
                name="personality"
                maxLength={BRAND_VOICE_LIMITS.personality}
                value={values.personality}
                onChange={update('personality')}
                disabled={disabled}
              />
            )}
          </FormField>
          <FormField
            label="Writing style"
            error={errors.writingStyle}
            hint="For example: short sentences, no jargon."
          >
            {(field) => (
              <Input
                {...field}
                name="writingStyle"
                maxLength={BRAND_VOICE_LIMITS.writingStyle}
                value={values.writingStyle}
                onChange={update('writingStyle')}
                disabled={disabled}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Words and phrases to use"
              error={errors.wordsToUse}
              hint={`One per line, up to ${BRAND_VOICE_LIMITS.phrases}.`}
            >
              {(field) => (
                <Textarea
                  {...field}
                  name="wordsToUse"
                  rows={4}
                  value={values.wordsToUse}
                  onChange={update('wordsToUse')}
                  disabled={disabled}
                />
              )}
            </FormField>
            <FormField
              label="Words and phrases to avoid"
              error={errors.wordsToAvoid}
              hint={`One per line, up to ${BRAND_VOICE_LIMITS.phrases}.`}
            >
              {(field) => (
                <Textarea
                  {...field}
                  name="wordsToAvoid"
                  rows={4}
                  value={values.wordsToAvoid}
                  onChange={update('wordsToAvoid')}
                  disabled={disabled}
                />
              )}
            </FormField>
          </div>
          <FormField
            label="Anything else AI Studio should know"
            error={errors.additionalInstructions}
            hint="For example: always mention free delivery in Lahore."
          >
            {(field) => (
              <Textarea
                {...field}
                name="additionalInstructions"
                rows={3}
                maxLength={BRAND_VOICE_LIMITS.additionalInstructions}
                value={values.additionalInstructions}
                onChange={update('additionalInstructions')}
                disabled={disabled}
              />
            )}
          </FormField>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {saving ? 'Saving…' : 'Save brand voice'}
              </Button>
              {saved ? (
                <p
                  role="status"
                  className="text-success flex items-center gap-2 text-sm font-medium"
                >
                  <CircleCheck className="size-4" aria-hidden />
                  Brand voice saved.
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
