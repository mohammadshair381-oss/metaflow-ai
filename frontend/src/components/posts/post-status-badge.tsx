import { POST_STATUS_LABELS, type PostStatus } from '@metaflow/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STYLES: Partial<Record<PostStatus, string>> = {
  awaiting_approval: 'border-warning/60 bg-warning/15 text-foreground',
  changes_requested: 'border-destructive/40 text-destructive',
  approved: 'border-success/50 text-success',
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  return (
    <Badge variant="outline" className={cn(STYLES[status])}>
      {POST_STATUS_LABELS[status]}
    </Badge>
  );
}
