import { AI_PROVIDER_LABELS, type AiGenerationUsage } from '@metaflow/shared';

const number = new Intl.NumberFormat();
const dollars = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

/** Which model wrote it and what it used. Unknown values are labelled, never shown as zero. */
export function UsageLine({ usage }: { usage: AiGenerationUsage }) {
  const parts = [
    `${AI_PROVIDER_LABELS[usage.provider]} · ${usage.model}`,
    usage.totalTokens === null
      ? 'token usage not reported'
      : `${number.format(usage.totalTokens)} tokens`,
  ];
  if (usage.estimatedCostUsd !== null)
    parts.push(`about ${dollars.format(usage.estimatedCostUsd)}`);
  return <p className="text-muted-foreground text-xs">{parts.join(' · ')}</p>;
}
