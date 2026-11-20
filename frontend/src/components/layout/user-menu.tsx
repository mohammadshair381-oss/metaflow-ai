import { LoaderCircle, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part?.[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Signed-in user and sign-out. Sign-out only completes in the UI after the server confirms. */
export function UserMenu() {
  const { state, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'authenticated') return null;
  const { user } = state;

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await logout(); // ProtectedRoute then redirects to /login.
    } catch {
      setError('Sign-out failed. Try again.');
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden min-w-0 text-right sm:block">
        <p className="truncate text-sm leading-tight font-medium">{user.name}</p>
        <p className="text-muted-foreground truncate text-xs">{user.email}</p>
      </div>
      <span
        aria-hidden
        className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold"
      >
        {initials(user.name)}
      </span>
      <Button variant="outline" size="sm" onClick={() => void signOut()} disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        <span className="hidden sm:inline">Sign out</span>
        <span className="sr-only sm:hidden">Sign out</span>
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
