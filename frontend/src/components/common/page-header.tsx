import type { ReactNode } from 'react';

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {description ? (
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">{description}</p>
      ) : null}
    </section>
  );
}
