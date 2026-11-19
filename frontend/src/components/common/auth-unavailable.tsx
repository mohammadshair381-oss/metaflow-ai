import { LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

/**
 * Stand-in for the sign-in and registration forms until accounts exist.
 * Deliberately has no form fields: a form that cannot submit would be fake functionality.
 */
export function AuthUnavailable({ title }: { title: string }) {
  return (
    <div className="bg-background grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Brand />
        <Card className="w-full">
          <CardHeader className="text-center">
            <span className="bg-accent text-accent-foreground mx-auto mb-2 grid size-11 place-items-center rounded-xl">
              <LockKeyhole className="size-5" aria-hidden />
            </span>
            <h1 data-slot="card-title" className="text-xl leading-none font-semibold">
              {title}
            </h1>
            <CardDescription>Accounts are not available yet.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground text-center leading-relaxed">
              Registration and sign-in arrive in the next milestone, with secure server-side
              sessions. Until then the dashboard is open in preview mode and stores no data.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button asChild>
                <Link to="/dashboard">Open dashboard preview</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
