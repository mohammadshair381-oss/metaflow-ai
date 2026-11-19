import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Small label above the title, e.g. "Not available yet". */
  eyebrow?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Use 'h1' when the empty state is the whole page (404, error), 'h2' inside a page. */
  headingLevel?: 'h1' | 'h2';
}

/** Placeholder for something that has no content or does not exist yet. Never shows fake data. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  eyebrow,
  children,
  className,
  headingLevel: Heading = 'h2',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'bg-card flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center',
        className,
      )}
    >
      <span className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-xl">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="flex max-w-md flex-col items-center gap-2">
        {eyebrow}
        <Heading className="text-lg font-semibold tracking-tight">{title}</Heading>
        <div className="text-muted-foreground text-sm leading-relaxed">{description}</div>
      </div>
      {children ? <div className="flex flex-wrap justify-center gap-2 pt-1">{children}</div> : null}
    </div>
  );
}
