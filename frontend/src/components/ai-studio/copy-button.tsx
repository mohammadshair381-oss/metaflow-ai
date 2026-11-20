import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';

/** Copies `text` and confirms, or says that copying is not possible here. */
export function CopyButton({
  text,
  label = 'Copy',
  disabled,
}: {
  text: string;
  label?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'))}
      >
        {state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
        {state === 'copied' ? 'Copied' : label}
      </Button>
      {state === 'failed' ? (
        <span role="alert" className="text-destructive text-xs">
          Copying is blocked in this browser. Select the text and copy it instead.
        </span>
      ) : null}
    </span>
  );
}
