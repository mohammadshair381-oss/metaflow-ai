import {
  SOCIAL_ACCOUNT_TYPE_LABELS,
  SOCIAL_PLATFORM_LABELS,
  type SocialAccount,
} from '@metaflow/shared';
import { LoaderCircle, RefreshCw, TriangleExclamationPoint } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const ISSUE_TEXT: Record<NonNullable<SocialAccount['issue']>, string> = {
  token_invalid:
    'Meta no longer accepts this connection. It may have expired, or access was removed on Facebook. Reconnect to restore it.',
  missing_permissions:
    'Some permissions were not granted, so MetaFlow AI cannot publish to this account. Reconnect and allow every permission requested.',
  insufficient_page_role:
    'The person who connected this Page cannot create content on it. Ask a Page admin to connect it, or to give you content access on Facebook.',
};

export type AccountAction = 'refresh' | 'reconnect' | 'disconnect';

export function SocialAccountCard({
  account,
  timeZone,
  canManage,
  canConnect,
  pending,
  onRefresh,
  onReconnect,
  onDisconnect,
}: {
  account: SocialAccount;
  timeZone: string;
  /** Owners can reconnect and disconnect. */
  canManage: boolean;
  /** False while the server has no Meta credentials. */
  canConnect: boolean;
  pending: AccountAction | null;
  onRefresh: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  const healthy = account.status === 'connected';
  const busy = pending !== null;
  const facts = [
    ['Account ID', account.externalId],
    ['Connected on', formatDate(account.connectedAt)],
    ['Last checked', account.lastSyncedAt ? formatDate(account.lastSyncedAt) : 'Not yet'],
  ] as const;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          {account.profileImageUrl ? (
            <img
              src={account.profileImageUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="bg-muted size-11 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="bg-accent text-accent-foreground grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold"
            >
              {account.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold">{account.name}</h3>
            <p className="text-muted-foreground truncate text-sm">
              {account.username ? `@${account.username} · ` : ''}
              {SOCIAL_ACCOUNT_TYPE_LABELS[account.accountType]}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant="outline">{SOCIAL_PLATFORM_LABELS[account.platform]}</Badge>
            <Badge variant={healthy ? 'secondary' : 'destructive'}>
              {healthy ? 'Connected' : 'Needs attention'}
            </Badge>
          </div>
        </div>

        {account.issue ? (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
          >
            <TriangleExclamationPoint
              className="text-destructive mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <div>
              <p>{ISSUE_TEXT[account.issue]}</p>
              {account.missingPermissions.length > 0 ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  Missing: {account.missingPermissions.join(', ')}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy || !canConnect}>
            {pending === 'refresh' ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            Check connection
          </Button>
          {canManage && !healthy ? (
            <Button size="sm" onClick={onReconnect} disabled={busy || !canConnect}>
              {pending === 'reconnect' ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : null}
              Reconnect
            </Button>
          ) : null}
          {canManage && !confirming ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive ml-auto"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              Disconnect
            </Button>
          ) : null}
          {canManage && confirming ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <p className="text-sm">Disconnect {account.name}?</p>
              <Button variant="destructive" size="sm" onClick={onDisconnect} disabled={busy}>
                {pending === 'disconnect' ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : null}
                Yes, disconnect
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
