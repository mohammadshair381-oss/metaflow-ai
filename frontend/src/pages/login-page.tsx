import { loginRequestSchema } from '@metaflow/shared';
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

const FIELDS = ['email', 'password'] as const;
type Field = (typeof FIELDS)[number];

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { login, state } = useAuth();
  const location = useLocation();
  const [values, setValues] = useState({ email: '', password: '' });
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
    const parsed = loginRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      // GuestRoute now redirects to where the user was going (or the dashboard).
    } catch (error) {
      const { fieldErrors, formError: message } = describeSubmitError(error, FIELDS);
      setErrors(fieldErrors);
      setFormError(message);
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to your MetaFlow AI account."
      footer={
        <>
          New to MetaFlow AI?{' '}
          <Link
            to="/register"
            state={location.state as RedirectState | null}
            className="text-primary font-medium hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        {state.status === 'error' ? <FormAlert message={state.message} /> : null}
        {formError ? <FormAlert message={formError} /> : null}

        <FormField label="Email" error={errors.email}>
          {(field) => (
            <Input
              {...field}
              type="email"
              name="email"
              autoComplete="email"
              autoFocus
              value={values.email}
              onChange={update('email')}
              disabled={submitting}
            />
          )}
        </FormField>

        <FormField label="Password" error={errors.password}>
          {(field) => (
            <PasswordInput
              {...field}
              name="password"
              autoComplete="current-password"
              value={values.password}
              onChange={update('password')}
              disabled={submitting}
            />
          )}
        </FormField>

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
