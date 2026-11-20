import {
  AI_FEATURES,
  HASHTAG_GROUPS,
  SOCIAL_PLATFORM_LABELS,
  type AiFeature,
  type AiGeneration,
  type AiUsageSummary,
} from '@metaflow/shared';
import { LoaderCircle, RotateCcwClock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAiUsage, listGenerations } from '@/services/ai-studio.service';
import { CopyButton } from './copy-button';
import { UsageLine } from './usage-line';

const FEATURE_LABELS: Record<AiFeature, string> = {
  caption: 'Captions',
  hashtags: 'Hashtags',
  ideas: 'Ideas',
};
const number = new Intl.NumberFormat();
const dollars = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function UsageSummary({ workspaceId }: { workspaceId: string }) {
  const [usage, setUsage] = useState<AiUsageSummary | null | 'error'>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchAiUsage(workspaceId, controller.signal).then(setUsage, () => {
      if (!controller.signal.aborted) setUsage('error');
    });
    return () => controller.abort();
  }, [workspaceId]);

  if (usage === null) return <Skeleton className="h-24 w-full" />;
  if (usage === 'error') return <FormAlert message="We could not load this month's AI usage." />;
  const since = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(usage.periodStart));
  const facts = [
    [
      'Requests',
      `${number.format(usage.requests)}${usage.failed ? ` (${number.format(usage.failed)} failed)` : ''}`,
    ],
    [
      'Tokens',
      `${number.format(usage.totalTokens)}${usage.requestsWithoutTokenData ? ` · not reported for ${usage.requestsWithoutTokenData}` : ''}`,
    ],
    [
      'Estimated cost',
      usage.estimatedCostUsd === null ? 'Not available' : dollars.format(usage.estimatedCostUsd),
    ],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI usage this month</CardTitle>
        <CardDescription>Since {since} (UTC), for this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function GenerationCard({
  generation,
  timeZone,
  currentUserId,
}: {
  generation: AiGeneration;
  timeZone: string;
  currentUserId: string;
}) {
  const when = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(generation.createdAt));
  const who = generation.userId === currentUserId ? 'you' : 'a teammate';
  let title: string;
  let body: ReactNode;
  switch (generation.feature) {
    case 'caption':
      title = `${SOCIAL_PLATFORM_LABELS[generation.settings.platform]}: ${generation.settings.topic}`;
      body = (
        <ol className="flex flex-col gap-3">
          {generation.output.captions.map((caption, index) => (
            <li key={index} className="flex flex-col gap-2">
              <p className="text-sm whitespace-pre-wrap">{caption.text}</p>
              <div>
                <CopyButton text={caption.text} />
              </div>
            </li>
          ))}
        </ol>
      );
      break;
    case 'hashtags': {
      const tags = HASHTAG_GROUPS.flatMap((group) => generation.output[group.value]);
      title = `${SOCIAL_PLATFORM_LABELS[generation.settings.platform]}: ${generation.settings.topic}`;
      body = (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{tags.map((tag) => `#${tag}`).join(' ')}</p>
          <div>
            <CopyButton text={tags.map((tag) => `#${tag}`).join(' ')} label="Copy all" />
          </div>
        </div>
      );
      break;
    }
    case 'ideas':
      title = generation.settings.focus || 'Content ideas';
      body = (
        <ul className="list-disc pl-5 text-sm">
          {generation.output.ideas.map((idea, index) => (
            <li key={index}>{idea.title}</li>
          ))}
        </ul>
      );
      break;
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{FEATURE_LABELS[generation.feature]}</Badge>
          <h3 className="min-w-0 flex-1 truncate font-medium">{title}</h3>
          <span className="text-muted-foreground text-xs">
            {when} · by {who}
          </span>
        </div>
        {body}
        <UsageLine usage={generation.usage} />
      </CardContent>
    </Card>
  );
}

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      generations: AiGeneration[];
      nextCursor: string | null;
      loadingMore: boolean;
    };

export function GenerationHistory({
  workspaceId,
  timeZone,
  currentUserId,
}: {
  workspaceId: string;
  timeZone: string;
  currentUserId: string;
}) {
  const [feature, setFeature] = useState<AiFeature | ''>('');
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [moreError, setMoreError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listGenerations(workspaceId, feature ? { feature } : {}, controller.signal).then(
      (page) => setState({ status: 'ready', ...page, loadingMore: false }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [workspaceId, feature, attempt]);

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor) return;
    setMoreError(false);
    setState({ ...state, loadingMore: true });
    try {
      const page = await listGenerations(workspaceId, {
        ...(feature ? { feature } : {}),
        before: state.nextCursor,
      });
      setState({
        status: 'ready',
        generations: [...state.generations, ...page.generations],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch {
      setMoreError(true);
      setState({ ...state, loadingMore: false });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <UsageSummary workspaceId={workspaceId} />
      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="history-heading" className="text-lg font-semibold tracking-tight">
            Generation history
          </h2>
          <label className="flex items-center gap-2 text-sm">
            Show
            <NativeSelect
              className="w-40"
              value={feature}
              onChange={(event) => {
                setState({ status: 'loading' });
                setFeature(event.target.value as AiFeature | '');
              }}
            >
              <option value="">Everything</option>
              {AI_FEATURES.map((value) => (
                <option key={value} value={value}>
                  {FEATURE_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        {state.status === 'loading' ? (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Loading history…</span>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="flex flex-col items-start gap-3">
            <FormAlert message="We could not load the generation history." />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' && state.generations.length === 0 ? (
          <EmptyState
            icon={RotateCcwClock}
            title="Nothing generated yet"
            description="Captions, hashtags and ideas you generate are kept here for this workspace."
          />
        ) : null}
        {state.status === 'ready'
          ? state.generations.map((generation) => (
              <GenerationCard
                key={generation.id}
                generation={generation}
                timeZone={timeZone}
                currentUserId={currentUserId}
              />
            ))
          : null}
        {state.status === 'ready' && state.nextCursor ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void loadMore()} disabled={state.loadingMore}>
              {state.loadingMore ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Load older generations
            </Button>
            {moreError ? (
              <span role="alert" className="text-destructive text-sm">
                Could not load more. Try again.
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
