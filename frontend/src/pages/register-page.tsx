import { AuthUnavailable } from '@/components/common/auth-unavailable';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function RegisterPage() {
  useDocumentTitle('Create account');
  return <AuthUnavailable title="Create your account" />;
}
