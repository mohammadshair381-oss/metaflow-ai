import { ArrowRight, CalendarClock, Share2, Sparkles, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '@/components/layout/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useDocumentTitle } from '@/hooks/use-document-title';

const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Share2,
    title: 'Connect your accounts',
    description:
      'Bring Facebook Pages and Instagram Professional accounts together, authorized through Meta’s official login.',
  },
  {
    icon: Sparkles,
    title: 'Create with AI',
    description:
      'Draft captions and hashtags in each brand’s voice, then review and refine them before anything goes out.',
  },
  {
    icon: CalendarClock,
    title: 'Schedule and automate',
    description:
      'Plan posts on a calendar and publish them with an approval step, or let trusted automations publish on their own.',
  },
];

export function LandingPage() {
  useDocumentTitle();
  const { state } = useAuth();
  const signedIn = state.status === 'authenticated';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Brand />
          <nav className="ml-auto flex items-center gap-2" aria-label="Account">
            {signedIn ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Go to dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Create account</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24">
          <Badge variant="outline">In development · Milestone 2</Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Social media for Facebook and Instagram, run by AI and approved by you.
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base sm:text-lg">
            MetaFlow AI is being built for businesses, creators and agencies that manage several
            brands. This early release includes secure accounts and the platform foundation; the
            features below arrive over the coming milestones.
          </p>
          <div className="flex flex-wrap gap-3">
            {signedIn ? (
              <Button asChild size="lg">
                <Link to="/dashboard">
                  Go to dashboard
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link to="/register">
                    Create account
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/login">Sign in</Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <section
          aria-labelledby="capabilities-heading"
          className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6"
        >
          <h2 id="capabilities-heading" className="sr-only">
            Planned capabilities
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="bg-card flex flex-col gap-3 rounded-xl border p-6">
                <span className="bg-accent text-accent-foreground grid size-10 place-items-center rounded-lg">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{title}</h3>
                  <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                    Planned
                  </span>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="text-muted-foreground border-t py-6 text-center text-xs">
        MetaFlow AI · Deployment foundation v0.1
      </footer>
    </div>
  );
}
