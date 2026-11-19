'use client';

import { API_ROUTES, type HealthResponse, type ReadinessResponse } from '@metaflow/shared';
import {
  CircleCheck,
  CircleX,
  Database,
  LoaderCircle,
  RefreshCw,
  Server,
  TriangleExclamationPoint,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { type CheckState, type OverallStatus, useBackendStatus } from '@/hooks/use-backend-status';
import { API_BASE_URL, IS_DEFAULT_API_BASE_URL } from '@/lib/config';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'error' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
  neutral: 'bg-muted-foreground/50',
};

const OVERALL: Record<OverallStatus, { label: string; tone: Tone }> = {
  checking: { label: 'Checking…', tone: 'neutral' },
  operational: { label: 'Connected', tone: 'success' },
  degraded: { label: 'Degraded', tone: 'warning' },
  unreachable: { label: 'Unreachable', tone: 'error' },
};

function StatusBadge({ status }: { status: OverallStatus }) {
  const { label, tone } = OVERALL[status];
  return (
    <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs" aria-live="polite">
      {status === 'checking' ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <span className={cn('size-2 rounded-full', TONE_DOT[tone])} aria-hidden />
      )}
      {label}
    </Badge>
  );
}

function formatUptime(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function CheckTile({
  icon: Icon,
  title,
  path,
  children,
}: {
  icon: LucideIcon;
  title: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-background flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-start gap-3">
        <span className="bg-accent text-accent-foreground grid size-8 shrink-0 place-items-center rounded-md">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-muted-foreground truncate font-mono text-xs">GET {path}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function StatusLine({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const color = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-destructive',
    neutral: 'text-muted-foreground',
  }[tone];
  return (
    <p className={cn('flex items-center gap-2 text-sm font-medium', color)}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="text-foreground">{children}</span>
    </p>
  );
}

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LoadingLines() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}

function ErrorBody({ state }: { state: Extract<CheckState<unknown>, { phase: 'error' }> }) {
  const { error } = state;
  return (
    <div className="flex flex-col gap-2">
      <StatusLine tone="error" icon={CircleX}>
        {error.kind === 'timeout' ? 'No response' : 'Request failed'}
      </StatusLine>
      <p className="text-muted-foreground text-xs leading-relaxed">{error.message}</p>
      {error.requestId ? (
        <p className="text-muted-foreground font-mono text-[11px]">Request ID: {error.requestId}</p>
      ) : null}
    </div>
  );
}

function HealthBody({ state }: { state: CheckState<HealthResponse> }) {
  if (state.phase === 'loading') return <LoadingLines />;
  if (state.phase === 'error') return <ErrorBody state={state} />;

  const { data, durationMs } = state.response;
  return (
    <div className="flex flex-col gap-3">
      <StatusLine tone="success" icon={CircleCheck}>
        Responding in {durationMs} ms
      </StatusLine>
      <Details
        rows={[
          ['Version', data.version],
          ['Environment', data.environment],
          ['Commit', data.commit ?? '—'],
          ['Uptime', formatUptime(data.uptimeSeconds)],
        ]}
      />
    </div>
  );
}

function ReadinessBody({ state }: { state: CheckState<ReadinessResponse> }) {
  if (state.phase === 'loading') return <LoadingLines />;
  if (state.phase === 'error') return <ErrorBody state={state} />;

  const database = state.response.data.checks.database;
  if (database.status === 'up') {
    return (
      <div className="flex flex-col gap-3">
        <StatusLine tone="success" icon={CircleCheck}>
          MongoDB connected
        </StatusLine>
        <Details
          rows={[
            ['Ping', database.latencyMs === undefined ? '—' : `${database.latencyMs} ms`],
            ['Readiness', 'ready'],
          ]}
        />
      </div>
    );
  }
  if (database.status === 'not_configured') {
    return (
      <div className="flex flex-col gap-2">
        <StatusLine tone="neutral" icon={TriangleExclamationPoint}>
          Database not configured
        </StatusLine>
        <p className="text-muted-foreground text-xs leading-relaxed">
          The API is running without <code className="font-mono">MONGODB_URI</code>. That is allowed
          in local development only; production requires a database.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <StatusLine tone="warning" icon={TriangleExclamationPoint}>
        MongoDB unavailable
      </StatusLine>
      <p className="text-muted-foreground text-xs leading-relaxed">
        The API is up but cannot reach its database. Check the MongoDB Atlas cluster and its network
        access list.
      </p>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function SystemStatusPanel() {
  const { health, readiness, overall, isSlow, checkedAt, refresh } = useBackendStatus();
  const isChecking = overall === 'checking';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backend connection</CardTitle>
        <CardDescription>
          A live request from your browser to the MetaFlow API, using the same credentialed CORS
          path that sign-in will use.
        </CardDescription>
        <CardAction>
          <StatusBadge status={overall} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="bg-muted/60 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-xs">
          <span className="text-muted-foreground">API endpoint</span>
          <code className="font-mono font-medium break-all">{API_BASE_URL}</code>
          {IS_DEFAULT_API_BASE_URL ? (
            <span className="text-muted-foreground">(local development default)</span>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <CheckTile icon={Server} title="API liveness" path={API_ROUTES.health}>
            <HealthBody state={health} />
          </CheckTile>
          <CheckTile icon={Database} title="Database readiness" path={API_ROUTES.healthReady}>
            <ReadinessBody state={readiness} />
          </CheckTile>
        </div>

        {isSlow && isChecking ? (
          <p className="border-warning/40 bg-warning/10 rounded-md border px-3 py-2 text-xs leading-relaxed">
            Still waiting. A Render free instance sleeps after 15 minutes without traffic and can
            take up to a minute to start again.
          </p>
        ) : null}

        {overall === 'unreachable' ? (
          <div className="border-destructive/30 bg-destructive/5 rounded-md border px-3 py-3 text-xs leading-relaxed">
            <p className="mb-1.5 font-semibold">Things to check</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-4">
              <li>The backend is running and the endpoint above is its correct URL.</li>
              <li>
                This site&apos;s origin is listed in the backend&apos;s{' '}
                <code className="font-mono">CORS_ORIGINS</code>.
              </li>
              <li>
                The backend health check answers: open{' '}
                <code className="font-mono break-all">
                  {API_BASE_URL}
                  {API_ROUTES.health}
                </code>
              </li>
            </ul>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t text-xs">
        <span>{checkedAt ? `Last checked at ${formatTime(checkedAt)}` : 'Checking now…'}</span>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isChecking}>
          <RefreshCw className={cn('size-3.5', isChecking && 'animate-spin')} aria-hidden />
          Check again
        </Button>
      </CardFooter>
    </Card>
  );
}
