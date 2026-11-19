import { LoaderCircle } from 'lucide-react';

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div role="status" className="text-muted-foreground grid min-h-dvh place-items-center text-sm">
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {label}
      </div>
    </div>
  );
}
