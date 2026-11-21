import type { Workspace } from '@metaflow/shared';
import { Building2, ImagePlus, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FormAlert } from '@/components/auth/form-alert';
import { MediaPicker } from '@/components/media/media-picker';
import { MediaPreview } from '@/components/media/media-preview';
import { Button } from '@/components/ui/button';
import { useWorkspaces } from '@/contexts/workspace-context';
import { cn } from '@/lib/utils';
import { describeSubmitError } from '@/lib/form-errors';
import { setWorkspaceLogo } from '@/services/media.service';

/** The workspace logo (an image from its media library), or a neutral placeholder. */
export function WorkspaceLogoImage({
  workspace,
  className,
}: {
  workspace: Workspace;
  className?: string;
}) {
  if (!workspace.logoMediaId) {
    return (
      <span
        className={cn(
          'bg-muted text-muted-foreground grid aspect-square place-items-center rounded-md',
          className,
        )}
      >
        <Building2 className="size-1/2" aria-hidden />
      </span>
    );
  }
  return (
    <MediaPreview
      workspaceId={workspace.id}
      media={{
        id: workspace.logoMediaId,
        kind: 'image',
        altText: `${workspace.name} logo`,
        originalName: `${workspace.name} logo`,
      }}
      className={className}
    />
  );
}

/**
 * Settings section for the logo. Owners choose an image from the media library (or upload one
 * there); removing the logo keeps the image in the library. Staff see it read-only.
 */
export function WorkspaceLogoSettings({ workspace }: { workspace: Workspace }) {
  const { syncWorkspace } = useWorkspaces();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = workspace.role === 'owner';

  async function apply(mediaId: string | null) {
    setBusy(true);
    setError(null);
    try {
      const updated = await setWorkspaceLogo(workspace.id, mediaId);
      syncWorkspace(workspace.id, { logoMediaId: updated.logoMediaId });
    } catch (caught) {
      setError(describeSubmitError(caught, []).formError ?? 'The logo could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <WorkspaceLogoImage workspace={workspace} className="size-20" />
        <p className="text-muted-foreground text-sm">
          {workspace.logoMediaId ? 'Current logo.' : 'No logo yet.'}{' '}
          {isOwner ? (
            <>
              Logos come from the{' '}
              <Link to="/media" className="underline">
                media library
              </Link>
              .
            </>
          ) : (
            'Only the owner can change the logo.'
          )}
        </p>
      </div>
      {isOwner ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>
            {busy ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <ImagePlus aria-hidden />
            )}
            {workspace.logoMediaId ? 'Change logo' : 'Choose logo'}
          </Button>
          {workspace.logoMediaId ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void apply(null)}>
              Remove logo
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? <FormAlert message={error} /> : null}
      {isOwner ? (
        <MediaPicker
          workspaceId={workspace.id}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title="Choose a logo"
          description="Pick an image from the media library, or upload a new one. Square images look best."
          kind="image"
          maxSelection={1}
          confirmLabel="Use as logo"
          onConfirm={([item]) => {
            if (item) void apply(item.id);
          }}
        />
      ) : null}
    </div>
  );
}
