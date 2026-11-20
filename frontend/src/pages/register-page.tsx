import { PASSWORD_MIN_LENGTH, registerRequestSchema } from '@metaflow/shared';
import { LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthCard } from '@/components/auth/auth-card';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import type { RedirectState } from '@/routes/redirect';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';

const FIELDS = ['name', 'email', 'password'] as const;
type Field = (typeof FIELDS)[number];

export function RegisterPage() {
  useDocumentTitle('Create account');
  const { register, state } = useAuth();
  const location = useLocation();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: Field) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = registerRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await register(parsed.data);
      // Registration signs the user in; GuestRoute now redirects.
    } catch (error) {
      const { fieldErrors, formError: message } = describeSubmitError(error, FIELDS);
      setErrors(fieldErrors);
      setFormError(message);
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start managing your Facebook and Instagram content in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            state={location.state as RedirectState | null}
            className="text-primary font-medium hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        {state.status === 'error' ? <FormAlert message={state.message} /> : null}
        {formError ? <FormAlert message={formError} /> : null}

        <FormField label="Name" error={errors.name}>
          {(field) => (
            <Input
              {...field}
              name="name"
              autoComplete="name"
              autoFocus
              value={values.name}
              onChange={update('name')}
              disabled={submitting}
            />
          )}
        </FormField>

        <FormField label="Email" error={errors.email}>
          {(field) => (
            <Input
              {...field}
              type="email"
              name="email"
              autoComplete="email"
              value={values.email}
              onChange={update('email')}
              disabled={submitting}
            />
          )}
        </FormField>

        <FormField
          label="Password"
          error={errors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easier to remember and harder to guess.`}
        >
          {(field) => (
            <PasswordInput
              {...field}
              name="password"
              autoComplete="new-password"
              value={values.password}
              onChange={update('password')}
              disabled={submitting}
            />
          )}
        </FormField>

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
