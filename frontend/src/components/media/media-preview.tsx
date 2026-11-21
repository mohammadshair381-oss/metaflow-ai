import type { MediaKind } from '@metaflow/shared';
import { Film, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { mediaFileUrl } from '@/services/media.service';

/**
 * A square preview of a media library item. Images load from the media file endpoint with the
 * session cookie; videos show a frame once the browser has read their metadata. If the file
 * cannot be loaded (for example when the web app and the API are on different sites, where the
 * browser does not send the cookie), a neutral placeholder is shown instead.
 */
export function MediaPreview({
  workspaceId,
  media,
  className,
}: {
  workspaceId: string;
  media: { id: string; kind: MediaKind; altText: string; originalName: string };
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaFileUrl(workspaceId, media.id);
  const frame = cn('bg-muted relative aspect-square w-full overflow-hidden rounded-md', className);

  if (failed) {
    return (
      <div className={cn(frame, 'text-muted-foreground grid place-items-center')}>
        <ImageOff className="size-6" aria-hidden />
        <span className="sr-only">Preview unavailable for {media.originalName}</span>
      </div>
    );
  }
  if (media.kind === 'video') {
    return (
      <div className={frame}>
        <video
          src={`${src}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="size-full object-cover"
          aria-label={media.altText || media.originalName}
          onError={() => setFailed(true)}
        />
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 p-1 text-white">
          <Film className="size-3.5" aria-hidden />
          <span className="sr-only">Video</span>
        </span>
      </div>
    );
  }
  return (
    <div className={frame}>
      <img
        src={src}
        alt={media.altText}
        loading="lazy"
        className="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
