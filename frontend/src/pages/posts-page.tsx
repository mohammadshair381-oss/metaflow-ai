import { SOCIAL_PLATFORM_LABELS, type Post, type Workspace } from '@metaflow/shared';
import { FileText, LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FormAlert } from '@/components/auth/form-alert';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyButton } from '@/components/ai-studio/copy-button';
import { useActiveWorkspace } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { listPosts } from '@/services/ai-studio.service';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; posts: Post[]; nextCursor: string | null; loadingMore: boolean };

function Drafts({ workspace }: { workspace: Workspace }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listPosts(workspace.id, {}, controller.signal).then(
      (page) => setState({ status: 'ready', ...page, loadingMore: false }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [workspace.id, attempt]);

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await listPosts(workspace.id, { before: state.nextCursor });
      setState({
        status: 'ready',
        posts: [...state.posts, ...page.posts],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch {
      setState({ ...state, loadingMore: false });
    }
  }

  if (state.status === 'loading') {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">Loading drafts…</span>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormAlert message="We could not load this workspace's drafts." />
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
    );
  }
  if (state.posts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No drafts yet"
        description="Captions you save in AI Studio appear here as drafts."
      >
        <Button asChild size="sm">
          <Link to="/ai-studio">
            <Sparkles aria-hidden />
            Open AI Studio
          </Link>
        </Button>
      </EmptyState>
    );
  }

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: workspace.timezone,
    }).format(new Date(value));
  return (
    <div className="flex flex-col gap-4">
      {state.posts.map((post) => (
        <Card key={post.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Draft</Badge>
              {post.platforms.map((platform) => (
                <Badge key={platform} variant="secondary">
                  {SOCIAL_PLATFORM_LABELS[platform]}
                </Badge>
              ))}
              {post.source === 'ai_studio' ? (
                <Badge variant="secondary">From AI Studio</Badge>
              ) : null}
              <span className="text-muted-foreground ml-auto text-xs">
                Saved {formatDate(post.createdAt)}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{post.caption}</p>
            {post.hashtags.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {post.hashtags.map((tag) => `#${tag}`).join(' ')}
              </p>
            ) : null}
            <div>
              <CopyButton text={post.caption} />
            </div>
          </CardContent>
        </Card>
      ))}
      {state.nextCursor ? (
        <div>
          <Button variant="outline" onClick={() => void loadMore()} disabled={state.loadingMore}>
            {state.loadingMore ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Load older drafts
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PostsPage() {
  useDocumentTitle('Posts');
  const workspace = useActiveWorkspace();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Posts"
        description="Drafts saved for this workspace. Editing, approval, scheduling and publishing arrive with the content milestone."
      />
      <Drafts key={workspace.id} workspace={workspace} />
    </div>
  );
}
