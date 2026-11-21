import {
  DEFAULT_MEDIA_LIMITS,
  MEDIA_ACCEPT,
  formatBytes,
  type Media,
  type MediaLimits,
} from '@metaflow/shared';
import { LoaderCircle, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { describeSubmitError } from '@/lib/form-errors';
import { uploadMedia } from '@/services/media.service';

/**
 * Picks files and uploads them one by one. The `accept` list and the size check only save the
 * user a wasted upload: the server identifies every file by its content and has the final say.
 */
export function MediaUploadButton({
  workspaceId,
  limits,
  onUploaded,
  label = 'Upload',
  size = 'sm',
}: {
  workspaceId: string;
  limits: MediaLimits | null;
  onUploaded: (media: Media) => void;
  label?: string;
  size?: 'sm' | 'default';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const disabled = limits?.uploadsEnabled === false || progress !== null;
  const maxBytes = Math.max(
    limits?.imageBytes ?? DEFAULT_MEDIA_LIMITS.imageBytes,
    limits?.videoBytes ?? DEFAULT_MEDIA_LIMITS.videoBytes,
  );

  async function upload(files: File[]) {
    setErrors([]);
    setProgress({ done: 0, total: files.length });
    const problems: string[] = [];
    for (const [index, file] of files.entries()) {
      if (file.size > maxBytes) {
        problems.push(`${file.name}: files can be at most ${formatBytes(maxBytes)}.`);
      } else {
        try {
          onUploaded(await uploadMedia(workspaceId, file));
        } catch (error) {
          const message = describeSubmitError(error, []).formError ?? 'Upload failed.';
          problems.push(`${file.name}: ${message}`);
        }
      }
      setProgress({ done: index + 1, total: files.length });
    }
    setProgress(null);
    setErrors(problems);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose files to upload"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length > 0) void upload(files);
        }}
      />
      <div>
        <Button
          type="button"
          size={size}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {progress ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Upload aria-hidden />
          )}
          {progress
            ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : label}
        </Button>
      </div>
      {limits?.uploadsEnabled === false ? (
        <p className="text-muted-foreground text-xs">
          Uploads are unavailable: media storage is not configured on the server yet.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          JPEG, PNG, WebP or GIF images up to{' '}
          {formatBytes(limits?.imageBytes ?? DEFAULT_MEDIA_LIMITS.imageBytes)}; MP4 or WebM videos
          up to {formatBytes(limits?.videoBytes ?? DEFAULT_MEDIA_LIMITS.videoBytes)}.
        </p>
      )}
      {errors.length > 0 ? (
        <ul role="alert" className="text-destructive flex flex-col gap-1 text-sm">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
