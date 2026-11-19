import { Info } from 'lucide-react';

/** Shown while sign-in does not exist, so nobody mistakes the open dashboard for a real account. */
export function PreviewNotice() {
  return (
    <div
      role="note"
      className="border-primary/20 bg-accent/60 text-accent-foreground mx-auto flex w-full max-w-6xl items-start gap-2.5 rounded-lg border px-4 py-3 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Preview mode.</span> Accounts and sign-in arrive in the next
        milestone. Until then these pages are open to anyone and store no data.
      </p>
    </div>
  );
}
