import { APP_NAME } from '@metaflow/shared';
import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md outline-offset-4">
      <span
        aria-hidden
        className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-bold shadow-sm"
      >
        M
      </span>
      <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );
}
