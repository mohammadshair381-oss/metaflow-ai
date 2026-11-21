import {
  EDITABLE_POST_STATUSES,
  POST_STATUS_LABELS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type Post,
  type PostStatus,
  type SocialPlatform,
  type Workspace,
} from '@metaflow/shared';
import { Copy, FileText, LoaderCircle, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FormAlert } from '@/components/auth/form-alert';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { MediaPreview } from '@/components/media/media-preview';
import { PostStatusBadge } from '@/components/posts/post-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useActiveWorkspace } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { describeSubmitError } from '@/lib/form-errors';
import { deletePost, duplicatePost, listPosts } from '@/services/post.service';

/** The statuses a post can be in today; scheduling and publishing arrive later. */
const FILTERABLE_STATUSES: PostStatus[] = [
  'draft',
  'awaiting_approval',
  'changes_requested',
  'approved',
];

interface Filters {
  status: PostStatus | '';
  platform: SocialPlatform | '';
  q: string;
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; posts: Post[]; nextCursor: string | null; loadingMore: boolean };

const filtersToQuery = (filters: Filters) => ({
  status: filters.status || undefined,
  platform: filters.platform || undefined,
  q: filters.q || undefined,
});

function PostCard({
  workspace,
  post,
  canDelete,
  onDeleted,
}: {
  workspace: Workspace;
  post: Post;
  canDelete: boolean;
  onDeleted: (postId: string) => void;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'duplicate' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: workspace.timezone,
    }).format(new Date(value));
  const heading = post.title || post.caption.slice(0, 80) || 'Untitled post';

  async function duplicate() {
    setBusy('duplicate');
    setError(null);
    try {
      const copy = await duplicatePost(workspace.id, post.id);
      void navigate(`/posts/${copy.id}`);
    } catch (caught) {
      setError(describeSubmitError(caught, []).formError ?? 'The post could not be duplicated.');
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    try {
      await deletePost(workspace.id, post.id);
      onDeleted(post.id);
    } catch (caught) {
      setError(describeSubmitError(caught, []).formError ?? 'The post could not be deleted.');
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PostStatusBadge status={post.status} />
          {post.platforms.map((platform) => (
            <Badge key={platform} variant="secondary">
              {SOCIAL_PLATFORM_LABELS[platform]}
            </Badge>
          ))}
          {post.source === 'ai_studio' ? <Badge variant="secondary">From AI Studio</Badge> : null}
          <span className="text-muted-foreground ml-auto text-xs">
            Updated {formatDate(post.updatedAt)}
          </span>
        </div>
        <h2 className="font-semibold">
          <Link to={`/posts/${post.id}`} className="hover:underline">
            {heading}
          </Link>
        </h2>
        {post.caption && post.title ? (
          <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
            {post.caption}
          </p>
        ) : null}
        {post.hashtags.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {post.hashtags.map((tag) => `#${tag}`).join(' ')}
          </p>
        ) : null}
        {post.media.length > 0 ? (
          <ul className="flex gap-2" aria-label="Attached media">
            {post.media.slice(0, 4).map((item) => (
              <li key={item.id} className="w-16">
                <MediaPreview workspaceId={workspace.id} media={item} />
              </li>
            ))}
            {post.media.length > 4 ? (
              <li className="text-muted-foreground self-center text-xs">
                +{post.media.length - 4} more
              </li>
            ) : null}
          </ul>
        ) : null}
        {!post.readiness.ready && EDITABLE_POST_STATUSES.includes(post.status) ? (
          <p className="text-muted-foreground text-xs">
            {post.readiness.issues.length === 1
              ? '1 thing to fix before it can be submitted.'
              : `${post.readiness.issues.length} things to fix before it can be submitted.`}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={`/posts/${post.id}`}>
              {EDITABLE_POST_STATUSES.includes(post.status) ? 'Edit' : 'Open'}
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void duplicate()}
          >
            {busy === 'duplicate' ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Copy aria-hidden />
            )}
            Duplicate
          </Button>
          {canDelete && !confirming ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          ) : null}
          {confirming ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              Delete this post? Its media stays in the library.
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                onClick={() => void remove()}
              >
                {busy === 'delete' ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Delete post
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : null}
        </div>
        {error ? <FormAlert message={error} /> : null}
      </CardContent>
    </Card>
  );
}

function PostList({ workspace }: { workspace: Workspace }) {
  const { state: auth } = useAuth();
  const userId = auth.status === 'authenticated' ? auth.user.id : null;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filters, setFilters] = useState<Filters>({ status: '', platform: '', q: '' });
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listPosts(workspace.id, filtersToQuery(filters), controller.signal).then(
      (page) => setState({ status: 'ready', ...page, loadingMore: false }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [workspace.id, filters, attempt]);

  function applyFilters(next: Filters) {
    setState({ status: 'loading' });
    setFilters(next);
  }

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await listPosts(workspace.id, {
        ...filtersToQuery(filters),
        before: state.nextCursor,
      });
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

  // Mirrors the server rule; the server decides.
  const canDelete = (post: Post) =>
    workspace.role === 'owner' ||
    (post.createdBy === userId && EDITABLE_POST_STATUSES.includes(post.status));
  const filtered = filters.status !== '' || filters.platform !== '' || filters.q !== '';

  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters({ ...filters, q: search.trim() });
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="post-search" className="text-xs font-medium">
            Search
          </label>
          <Input
            id="post-search"
            value={search}
            placeholder="Title or caption"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="post-status" className="text-xs font-medium">
            Status
          </label>
          <NativeSelect
            id="post-status"
            value={filters.status}
            onChange={(event) =>
              applyFilters({ ...filters, status: event.target.value as Filters['status'] })
            }
          >
            <option value="">All statuses</option>
            {FILTERABLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {POST_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="post-platform" className="text-xs font-medium">
            Platform
          </label>
          <NativeSelect
            id="post-platform"
            value={filters.platform}
            onChange={(event) =>
              applyFilters({ ...filters, platform: event.target.value as Filters['platform'] })
            }
          >
            <option value="">All platforms</option>
            {SOCIAL_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {SOCIAL_PLATFORM_LABELS[platform]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {state.status === 'loading' ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">Loading posts…</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <FormAlert message="We could not load this workspace's posts." />
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

      {state.status === 'ready' && state.posts.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Search}
            title="No posts match"
            description="Try another search, status or platform."
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="No posts yet"
            description="Write a post here, or save a caption from AI Studio as a draft."
          >
            <Button asChild size="sm">
              <Link to="/posts/new">
                <Plus aria-hidden />
                New post
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/ai-studio">
                <Sparkles aria-hidden />
                Open AI Studio
              </Link>
            </Button>
          </EmptyState>
        )
      ) : null}

      {state.status === 'ready'
        ? state.posts.map((post) => (
            <PostCard
              key={post.id}
              workspace={workspace}
              post={post}
              canDelete={canDelete(post)}
              onDeleted={(postId) =>
                setState((current) =>
                  current.status === 'ready'
                    ? { ...current, posts: current.posts.filter((entry) => entry.id !== postId) }
                    : current,
                )
              }
            />
          ))
        : null}

      {state.status === 'ready' && state.nextCursor ? (
        <div>
          <Button variant="outline" onClick={() => void loadMore()} disabled={state.loadingMore}>
            {state.loadingMore ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Load more
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Posts"
          description="Write posts, attach media, choose accounts and send them for approval. Scheduling and publishing arrive in a later milestone."
        />
        <Button asChild>
          <Link to="/posts/new">
            <Plus aria-hidden />
            New post
          </Link>
        </Button>
      </div>
      <PostList key={workspace.id} workspace={workspace} />
    </div>
  );
}
