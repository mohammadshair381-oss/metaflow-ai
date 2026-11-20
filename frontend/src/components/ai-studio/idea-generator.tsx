import {
  IDEA_COUNT,
  IDEA_FORMATS,
  IDEA_TYPES,
  SOCIAL_PLATFORM_LABELS,
  WORKSPACE_LANGUAGES,
  ideasRequestSchema,
  optionLabel,
  type ContentIdea,
  type IdeaType,
  type IdeasGeneration,
  type WorkspaceLanguage,
} from '@metaflow/shared';
import { LoaderCircle, PenLine, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';
import { generateIdeas } from '@/services/ai-studio.service';
import { UsageLine } from './usage-line';

const FIELDS = ['focus', 'platform', 'types', 'count', 'language'] as const;
type Field = (typeof FIELDS)[number];

export function IdeaGenerator({
  workspaceId,
  language,
  available,
  onUseIdea,
}: {
  workspaceId: string;
  language: WorkspaceLanguage;
  available: boolean;
  /** Opens the caption generator prefilled with this idea. */
  onUseIdea: (idea: ContentIdea) => void;
}) {
  const [focus, setFocus] = useState('');
  const [platform, setPlatform] = useState<'' | 'facebook' | 'instagram'>('');
  const [types, setTypes] = useState<IdeaType[]>([]);
  const [count, setCount] = useState<number>(IDEA_COUNT.default);
  const [ideaLanguage, setIdeaLanguage] = useState<string>(language);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<IdeasGeneration | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = ideasRequestSchema.safeParse({
      focus,
      types,
      count,
      language: ideaLanguage,
      ...(platform ? { platform } : {}),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setGeneration(await generateIdeas(workspaceId, parsed.data));
    } catch (error) {
      const described = describeSubmitError(error, FIELDS);
      setErrors(described.fieldErrors);
      setFormError(described.formError);
    } finally {
      setBusy(false);
    }
  }

  const toggleType = (type: IdeaType) =>
    setTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  const disabled = !available || busy;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Get content ideas</CardTitle>
          <CardDescription>
            Ideas based on your business, the season and your goals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            {formError ? <FormAlert message={formError} /> : null}
            <FormField
              label="Focus"
              error={errors.focus}
              hint="Optional, e.g. Eid collection or new winter menu."
            >
              {(field) => (
                <Input
                  {...field}
                  name="focus"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  disabled={disabled}
                />
              )}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Platform" error={errors.platform}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="platform"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as typeof platform)}
                    disabled={disabled}
                  >
                    <option value="">Both</option>
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Number of ideas" error={errors.count}>
                {(field) => (
                  <NativeSelect
                    {...field}
                    name="count"
                    value={String(count)}
                    onChange={(e) => setCount(Number(e.target.value))}
                    disabled={disabled}
                  >
                    {Array.from(
                      { length: IDEA_COUNT.max - IDEA_COUNT.min + 1 },
                      (_, i) => i + IDEA_COUNT.min,
                    ).map((value) => (
                      <option key={value} value={value}>
                        {value}
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
                    value={ideaLanguage}
                    onChange={(e) => setIdeaLanguage(e.target.value)}
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
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Kinds of ideas</legend>
              <p className="text-muted-foreground text-xs">Leave all unticked for a mix.</p>
              <div className="flex flex-wrap gap-2">
                {IDEA_TYPES.map((type) => (
                  <label
                    key={type.value}
                    className="has-[:checked]:bg-accent has-[:checked]:text-accent-foreground flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={types.includes(type.value)}
                      onChange={() => toggleType(type.value)}
                      disabled={disabled}
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={disabled}>
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {busy ? 'Thinking of ideas…' : 'Get ideas'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="idea-results" className="flex flex-col gap-4">
        <h2 id="idea-results" className="text-lg font-semibold tracking-tight">
          Ideas
        </h2>
        {!generation ? (
          <p className="text-muted-foreground bg-card rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            Ideas will appear here. Turn any of them into captions with one click.
          </p>
        ) : (
          <>
            {generation.output.ideas.map((idea, index) => (
              <Card key={`${idea.title}-${index}`}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{idea.title}</h3>
                    <Badge variant="outline">{optionLabel(IDEA_TYPES, idea.type)}</Badge>
                    <Badge variant="secondary">
                      {optionLabel(IDEA_FORMATS, idea.format)} ·{' '}
                      {SOCIAL_PLATFORM_LABELS[idea.platform]}
                    </Badge>
                  </div>
                  <p className="text-sm">{idea.description}</p>
                  {idea.angle ? (
                    <p className="text-muted-foreground text-sm">
                      <span className="text-foreground font-medium">Angle:</span> {idea.angle}
                    </p>
                  ) : null}
                  {idea.callToAction ? (
                    <p className="text-muted-foreground text-sm">
                      <span className="text-foreground font-medium">Call to action:</span>{' '}
                      {idea.callToAction}
                    </p>
                  ) : null}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUseIdea(idea)}
                      disabled={!available}
                    >
                      <PenLine aria-hidden />
                      Write a caption
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <UsageLine usage={generation.usage} />
          </>
        )}
      </section>
    </div>
  );
}
