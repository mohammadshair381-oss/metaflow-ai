import { AuthUnavailable } from '@/components/common/auth-unavailable';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function LoginPage() {
  useDocumentTitle('Sign in');
  return <AuthUnavailable title="Sign in" />;
}
