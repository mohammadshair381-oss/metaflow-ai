import {
  MEDIA_TEXT_LIMITS,
  formatBytes,
  mediaFormatLabel,
  type Media,
  type MediaKind,
  type MediaLimits,
  type Workspace,
} from '@metaflow/shared';
import { CircleCheck, Download, Images, LoaderCircle, Search, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { MediaPreview } from '@/components/media/media-preview';
import { MediaUploadButton } from '@/components/media/media-upload-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useActiveWorkspace } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { describeSubmitError } from '@/lib/form-errors';
import { deleteMedia, listMedia, mediaFileUrl, updateMedia } from '@/services/media.service';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: Media[];
      nextCursor: string | null;
      limits: MediaLimits;
      loadingMore: boolean;
    };

interface Filters {
  kind: MediaKind | '';
  q: string;
}

function MediaDetails({
  workspace,
  media,
  onChanged,
  onDeleted,
}: {
  workspace: Workspace;
  media: Media;
  onChanged: (media: Media) => void;
  onDeleted: (mediaId: string) => void;
}) {
  const [altText, setAltText] = useState(media.altText);
  const [description, setDescription] = useState(media.description);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { state: auth } = useAuth();
  // Mirrors the server rule (owners: anything; staff: their own uploads). The server decides.
  const canDelete =
    workspace.role === 'owner' ||
    (auth.status === 'authenticated' && media.uploadedBy === auth.user.id);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: workspace.timezone,
    }).format(new Date(value));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      onChanged(await updateMedia(workspace.id, media.id, { altText, description }));
      setSaved(true);
    } catch (caught) {
      setError(describeSubmitError(caught, []).formError ?? 'The changes could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await deleteMedia(workspace.id, media.id);
      onDeleted(media.id);
    } catch (caught) {
      setError(describeSubmitError(caught, []).formError ?? 'The file could not be deleted.');
      setConfirmingDelete(false);
      setDeleting(false);
    }
  }

  const facts = [
    ['Type', `${mediaFormatLabel(media.mimeType)} ${media.kind}`],
    ['Size', formatBytes(media.size)],
    ...(media.width && media.height ? [['Dimensions', `${media.width} × ${media.height}`]] : []),
    ['Uploaded', formatDate(media.createdAt)],
  ];

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4 pt-0">
      {media.kind === 'video' ? (
        <video
          src={mediaFileUrl(workspace.id, media.id)}
          controls
          preload="metadata"
          className="bg-muted max-h-80 w-full rounded-md"
          aria-label={media.altText || media.originalName}
        />
      ) : (
        <MediaPreview workspaceId={workspace.id} media={media} className="aspect-auto max-h-80" />
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <FormField
          label="Alt text"
          hint="Describes the image for people using screen readers. Kept with the file."
        >
          {(props) => (
            <Input
              {...props}
              value={altText}
              maxLength={MEDIA_TEXT_LIMITS.altText}
              onChange={(event) => setAltText(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Description" hint="Internal notes. Never published.">
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={description}
              maxLength={MEDIA_TEXT_LIMITS.description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Save details
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={mediaFileUrl(workspace.id, media.id, true)} download>
              <Download aria-hidden />
              Download
            </a>
          </Button>
          {saved ? (
            <span role="status" className="text-success flex items-center gap-1 text-sm">
              <CircleCheck className="size-4" aria-hidden />
              Saved.
            </span>
          ) : null}
        </div>
      </form>
      {error ? <FormAlert message={error} /> : null}
      {canDelete ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          {confirmingDelete ? (
            <>
              <p className="text-sm">
                Delete <strong>{media.originalName}</strong> permanently? Posts must not use it.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  {deleting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Delete permanently
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Library({ workspace }: { workspace: Workspace }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filters, setFilters] = useState<Filters>({ kind: '', q: '' });
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listMedia(
      workspace.id,
      { kind: filters.kind || undefined, q: filters.q },
      controller.signal,
    ).then(
      (page) =>
        setState({
          status: 'ready',
          items: page.media,
          nextCursor: page.nextCursor,
          limits: page.limits,
          loadingMore: false,
        }),
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
      const page = await listMedia(workspace.id, {
        kind: filters.kind || undefined,
        q: filters.q,
        before: state.nextCursor,
      });
      setState({
        ...state,
        items: [...state.items, ...page.media],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch {
      setState({ ...state, loadingMore: false });
    }
  }

  const replace = (item: Media) =>
    setState((current) =>
      current.status === 'ready'
        ? { ...current, items: current.items.map((entry) => (entry.id === item.id ? item : entry)) }
        : current,
    );
  const filtered = filters.kind !== '' || filters.q !== '';
  const open =
    state.status === 'ready' ? state.items.find((item) => item.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <MediaUploadButton
            workspaceId={workspace.id}
            limits={state.status === 'ready' ? state.limits : null}
            onUploaded={(item) =>
              setState((current) =>
                current.status === 'ready'
                  ? { ...current, items: [item, ...current.items] }
                  : current,
              )
            }
          />
          <form
            role="search"
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters({ ...filters, q: search.trim() });
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <label htmlFor="media-search" className="text-xs font-medium">
                Search
              </label>
              <Input
                id="media-search"
                value={search}
                placeholder="File name, alt text or description"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="media-kind" className="text-xs font-medium">
                Type
              </label>
              <NativeSelect
                id="media-kind"
                value={filters.kind}
                onChange={(event) =>
                  applyFilters({ ...filters, kind: event.target.value as Filters['kind'] })
                }
              >
                <option value="">All media</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline">
              <Search aria-hidden />
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      {state.status === 'loading' ? (
        <div role="status" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <span className="sr-only">Loading media…</span>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="aspect-square w-full" />
          ))}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <FormAlert message="We could not load this workspace's media library." />
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

      {state.status === 'ready' && state.items.length === 0 ? (
        <EmptyState
          icon={Images}
          title={filtered ? 'Nothing matches' : 'No media yet'}
          description={
            filtered
              ? 'Try another search or type.'
              : 'Upload photos and videos here, then attach them to posts or use one as the workspace logo.'
          }
        />
      ) : null}

      {state.status === 'ready' && state.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Media">
          {state.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                className="focus-visible:ring-ring/50 flex w-full flex-col gap-1.5 rounded-lg border p-2 text-left outline-none focus-visible:ring-[3px]"
                aria-label={`Open ${item.originalName}`}
              >
                <MediaPreview workspaceId={workspace.id} media={item} />
                <span className="truncate text-sm font-medium">{item.originalName}</span>
                <span className="text-muted-foreground text-xs">
                  {mediaFormatLabel(item.mimeType)} · {formatBytes(item.size)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'ready' && state.nextCursor ? (
        <div>
          <Button variant="outline" onClick={() => void loadMore()} disabled={state.loadingMore}>
            {state.loadingMore ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Load more
          </Button>
        </div>
      ) : null}

      <Sheet open={Boolean(open)} onOpenChange={(next) => (next ? null : setOpenId(null))}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle className="pr-6 break-all">{open.originalName}</SheetTitle>
                <SheetDescription>Media library item</SheetDescription>
              </SheetHeader>
              <MediaDetails
                key={open.id}
                workspace={workspace}
                media={open}
                onChanged={replace}
                onDeleted={(mediaId) => {
                  setOpenId(null);
                  setState((current) =>
                    current.status === 'ready'
                      ? { ...current, items: current.items.filter((entry) => entry.id !== mediaId) }
                      : current,
                  );
                }}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function MediaLibraryPage() {
  useDocumentTitle('Media Library');
  const workspace = useActiveWorkspace();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Media Library"
        description="Photos and videos for this workspace. Attach them to posts or use an image as the workspace logo."
      />
      <Library key={workspace.id} workspace={workspace} />
    </div>
  );
}
