import { type Media, type MediaKind, type MediaLimits } from '@metaflow/shared';
import { Check, ImagePlus, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { listMedia } from '@/services/media.service';
import { MediaPreview } from './media-preview';
import { MediaUploadButton } from './media-upload-button';

type LibraryState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: Media[];
      nextCursor: string | null;
      limits: MediaLimits;
      loadingMore: boolean;
    };

/**
 * Chooses items from the workspace's media library, or uploads new ones on the spot. Used by
 * the post editor (several items) and the workspace logo (one image).
 */
export function MediaPicker({
  workspaceId,
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  kind,
  maxSelection,
  excludeIds = [],
  confirmLabel = 'Add selected',
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (items: Media[]) => void;
  title: string;
  description: string;
  /** Show only this kind (the logo takes images only). */
  kind?: MediaKind;
  maxSelection: number;
  excludeIds?: readonly string[];
  confirmLabel?: string;
}) {
  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  const [selected, setSelected] = useState<Media[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    listMedia(workspaceId, { kind }, controller.signal).then(
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
  }, [workspaceId, kind, open, attempt]);

  function close(next: boolean) {
    if (!next) {
      setSelected([]);
      setState({ status: 'loading' });
    }
    onOpenChange(next);
  }

  function toggle(item: Media) {
    setSelected((current) => {
      if (current.some((entry) => entry.id === item.id)) {
        return current.filter((entry) => entry.id !== item.id);
      }
      if (maxSelection === 1) return [item];
      return current.length >= maxSelection ? current : [...current, item];
    });
  }

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await listMedia(workspaceId, { kind, before: state.nextCursor });
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

  const visible =
    state.status === 'ready' ? state.items.filter((item) => !excludeIds.includes(item.id)) : [];

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {state.status === 'ready' ? (
            <MediaUploadButton
              workspaceId={workspaceId}
              limits={state.limits}
              label="Upload new"
              onUploaded={(item) => {
                if (kind && item.kind !== kind) return;
                setState((current) =>
                  current.status === 'ready'
                    ? { ...current, items: [item, ...current.items] }
                    : current,
                );
                toggle(item);
              }}
            />
          ) : null}
          {state.status === 'loading' ? (
            <div role="status" className="grid grid-cols-3 gap-3">
              <span className="sr-only">Loading the media library…</span>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="aspect-square w-full" />
              ))}
            </div>
          ) : null}
          {state.status === 'error' ? (
            <div className="flex flex-col items-start gap-3">
              <FormAlert message="We could not load the media library." />
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
          {state.status === 'ready' && visible.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <ImagePlus className="size-4" aria-hidden />
              {kind === 'image' ? 'No images in the library yet.' : 'The library is empty.'} Upload
              a file to get started.
            </p>
          ) : null}
          {visible.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Media library">
              {visible.map((item) => {
                const isSelected = selected.some((entry) => entry.id === item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`Select ${item.originalName}`}
                      onClick={() => toggle(item)}
                      className={cn(
                        'focus-visible:ring-ring/50 relative flex w-full flex-col gap-1 rounded-lg border p-1.5 text-left outline-none focus-visible:ring-[3px]',
                        isSelected && 'border-primary ring-primary ring-2',
                      )}
                    >
                      <MediaPreview workspaceId={workspaceId} media={item} />
                      <span className="truncate text-xs">{item.originalName}</span>
                      {isSelected ? (
                        <span className="bg-primary text-primary-foreground absolute top-2.5 right-2.5 rounded-full p-0.5">
                          <Check className="size-3.5" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {state.status === 'ready' && state.nextCursor ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={state.loadingMore}
              >
                {state.loadingMore ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Load more
              </Button>
            </div>
          ) : null}
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t">
          <span className="text-muted-foreground text-sm">
            {selected.length} selected{maxSelection > 1 ? ` (up to ${maxSelection})` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              disabled={selected.length === 0}
              onClick={() => {
                onConfirm(selected);
                close(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
