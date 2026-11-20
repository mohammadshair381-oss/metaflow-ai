import {
  BUSINESS_CATEGORIES,
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_LANGUAGES,
  createWorkspaceRequestSchema,
  type CreateWorkspaceRequest,
} from '@metaflow/shared';
import { LoaderCircle } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  WORKSPACE_FIELDS,
  type WorkspaceField,
  type WorkspaceFormValues,
} from './workspace-form-values';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';

type Field = WorkspaceField;
const FIELDS = WORKSPACE_FIELDS;

function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older browsers: offer the current value and UTC only.
  }
  return [...new Set(['UTC', current, ...zones])].filter(Boolean).sort();
}

/**
 * The business profile fields, shared by "create workspace" and workspace settings.
 * Validates with the same schema as the API, then shows server errors next to their fields.
 */
export function WorkspaceForm({
  initialValues,
  submitLabel,
  submittingLabel,
  onSubmit,
  onSaved,
}: {
  initialValues: WorkspaceFormValues;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: CreateWorkspaceRequest) => Promise<unknown>;
  onSaved?: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const zones = useMemo(() => timeZoneOptions(initialValues.timezone), [initialValues.timezone]);

  const update = (field: Field) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = createWorkspaceRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
      onSaved?.();
    } catch (error) {
      const described = describeSubmitError(error, FIELDS);
      setErrors(described.fieldErrors);
      setFormError(described.formError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {formError ? <FormAlert message={formError} /> : null}

      <FormField
        label="Workspace name"
        error={errors.name}
        hint="Usually your business or brand name."
      >
        {(field) => (
          <Input
            {...field}
            name="name"
            autoComplete="organization"
            value={values.name}
            onChange={update('name')}
            disabled={submitting}
          />
        )}
      </FormField>

      <FormField label="Business category" error={errors.category}>
        {(field) => (
          <NativeSelect
            {...field}
            name="category"
            value={values.category}
            onChange={update('category')}
            disabled={submitting}
          >
            {BUSINESS_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <FormField
        label="About the business"
        error={errors.description}
        hint="Optional. What you sell and who you sell it to. AI-generated content will use this."
      >
        {(field) => (
          <Textarea
            {...field}
            name="description"
            maxLength={WORKSPACE_DESCRIPTION_MAX_LENGTH}
            value={values.description}
            onChange={update('description')}
            disabled={submitting}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Time zone"
          error={errors.timezone}
          hint="Posts are scheduled and shown in this time zone."
        >
          {(field) => (
            <NativeSelect
              {...field}
              name="timezone"
              value={values.timezone}
              onChange={update('timezone')}
              disabled={submitting}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>

        <FormField
          label="Content language"
          error={errors.defaultLanguage}
          hint="The default language for new content."
        >
          {(field) => (
            <NativeSelect
              {...field}
              name="defaultLanguage"
              value={values.defaultLanguage}
              onChange={update('defaultLanguage')}
              disabled={submitting}
            >
              {WORKSPACE_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
