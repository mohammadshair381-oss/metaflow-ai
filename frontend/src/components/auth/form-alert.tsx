import { CircleExclamationPoint } from 'lucide-react';

/** Form-level error, announced to screen readers when it appears. */
export function FormAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
    >
      <CircleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
