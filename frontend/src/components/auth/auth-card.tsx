import type { ReactNode } from 'react';
import { Brand } from '@/components/layout/brand';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

/** Centered shell for the sign-in and registration pages. Renders the page's only <h1>. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="bg-background grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Brand />
        <Card className="w-full">
          <CardHeader>
            <h1 data-slot="card-title" className="text-xl leading-none font-semibold">
              {title}
            </h1>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <p className="text-muted-foreground text-sm">{footer}</p>
      </div>
    </div>
  );
}
