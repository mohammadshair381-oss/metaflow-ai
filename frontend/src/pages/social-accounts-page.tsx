import {
  SOCIAL_PLATFORM_LABELS,
  metaConnectResultSchema,
  type MetaConnectResult,
  type SocialAccount,
  type SocialPlatform,
  type Workspace,
} from '@metaflow/shared';
import { CircleCheck, Info, LoaderCircle, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FormAlert } from '@/components/auth/form-alert';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import {
  SocialAccountCard,
  type AccountAction,
} from '@/components/social-accounts/social-account-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { browser } from '@/lib/browser';
import { ApiRequestError } from '@/services/api-client';
import {
  disconnectSocialAccount,
  listSocialAccounts,
  refreshSocialAccount,
  startSocialConnection,
} from '@/services/social-account.service';

const RESULT_TEXT: Record<Exclude<MetaConnectResult, 'connected'>, string> = {
  denied: 'The connection was cancelled on Facebook. Nothing was connected.',
  invalid_state:
    'That connection attempt expired or was already used. Start again from the buttons below.',
  session_expired: 'You were signed out before the connection finished. Please connect again.',
  not_allowed: 'Only the workspace owner can connect accounts.',
  exchange_failed: 'Meta did not complete the connection. Please try again in a moment.',
  no_accounts:
    'No account was found. For Facebook, choose at least one Page you manage. For Instagram, the account must be a Business or Creator account linked to a Facebook Page you manage.',
  not_configured: 'Connecting social accounts is not set up on this server yet.',
};

type Notice = { kind: 'success' | 'error'; text: string };

function noticeFrom(params: URLSearchParams): Notice | null {
  const result = metaConnectResultSchema.safeParse(params.get('meta'));
  if (!result.success) return null;
  if (result.data !== 'connected') return { kind: 'error', text: RESULT_TEXT[result.data] };
  const count = Number.parseInt(params.get('count') ?? '', 10);
  return {
    kind: 'success',
    text:
      count === 1
        ? '1 account is connected.'
        : `${Number.isInteger(count) && count > 0 ? count : 'Your'} accounts are connected.`,
  };
}

const messageOf = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong. Please try again.';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; accounts: SocialAccount[]; configured: boolean };

function Accounts({ workspace }: { workspace: Workspace }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(() => noticeFrom(searchParams));
  const [connecting, setConnecting] = useState<SocialPlatform | null>(null);
  const [pending, setPending] = useState<{ id: string; action: AccountAction } | null>(null);
  const isOwner = workspace.role === 'owner';

  // The result arrives once in the address; keep the message, clean the address.
  useEffect(() => {
    if (searchParams.has('meta')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    listSocialAccounts(workspace.id, controller.signal).then(
      (data) =>
        setState({
          status: 'ready',
          accounts: data.accounts,
          configured: data.integration.configured,
        }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [workspace.id, attempt]);

  const replaceAccounts = (update: (accounts: SocialAccount[]) => SocialAccount[]) =>
    setState((current) =>
      current.status === 'ready' ? { ...current, accounts: update(current.accounts) } : current,
    );

  /** Leaves the app for Facebook's own login page. Nothing is connected until it returns. */
  async function connect(platform: SocialPlatform, accountId?: string) {
    setNotice(null);
    setConnecting(platform);
    if (accountId) setPending({ id: accountId, action: 'reconnect' });
    try {
      browser.assign(await startSocialConnection(workspace.id, platform));
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) });
      setConnecting(null);
      setPending(null);
    }
  }

  async function refresh(account: SocialAccount) {
    setNotice(null);
    setPending({ id: account.id, action: 'refresh' });
    try {
      const updated = await refreshSocialAccount(workspace.id, account.id);
      replaceAccounts((accounts) => accounts.map((a) => (a.id === updated.id ? updated : a)));
      setNotice(
        updated.status === 'connected'
          ? { kind: 'success', text: `${updated.name} is connected and working.` }
          : { kind: 'error', text: `${updated.name} needs attention. See the details below.` },
      );
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) });
    } finally {
      setPending(null);
    }
  }

  async function disconnect(account: SocialAccount) {
    setNotice(null);
    setPending({ id: account.id, action: 'disconnect' });
    try {
      await disconnectSocialAccount(workspace.id, account.id);
      replaceAccounts((accounts) => accounts.filter((a) => a.id !== account.id));
      setNotice({ kind: 'success', text: `${account.name} was disconnected.` });
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) });
    } finally {
      setPending(null);
    }
  }

  const configured = state.status === 'ready' && state.configured;

  return (
    <>
      {notice?.kind === 'error' ? <FormAlert message={notice.text} /> : null}
      {notice?.kind === 'success' ? (
        <p
          role="status"
          className="border-success/30 bg-success/5 flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm"
        >
          <CircleCheck className="text-success size-4 shrink-0" aria-hidden />
          {notice.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connect an account</CardTitle>
          <CardDescription>
            You sign in on Facebook and choose what to share. MetaFlow AI never sees your Facebook
            or Instagram password. Instagram accounts must be Business or Creator accounts linked to
            a Facebook Page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state.status === 'ready' && !state.configured ? (
            <p className="bg-muted flex items-start gap-2 rounded-md px-3 py-2.5 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Connecting accounts is not available yet: this MetaFlow AI server has not been linked
              to a Meta app. The buttons below start working once that setup is done.
            </p>
          ) : null}
          {isOwner ? (
            <div className="flex flex-wrap gap-2">
              {(['facebook', 'instagram'] as const).map((platform) => (
                <Button
                  key={platform}
                  onClick={() => void connect(platform)}
                  disabled={!configured || connecting !== null}
                >
                  {connecting === platform ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : null}
                  {platform === 'facebook'
                    ? 'Connect Facebook Pages'
                    : 'Connect Instagram accounts'}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Only the workspace owner can connect or disconnect accounts.
            </p>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="connected-accounts" className="flex flex-col gap-4">
        <h2 id="connected-accounts" className="text-lg font-semibold tracking-tight">
          Connected accounts
        </h2>
        {state.status === 'loading' ? (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Loading connected accounts…</span>
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="flex flex-col items-start gap-3">
            <FormAlert message="We could not load this workspace's connected accounts." />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' && state.accounts.length === 0 ? (
          <EmptyState
            icon={Share2}
            title="No accounts connected yet"
            description={`Connect a Facebook Page or an Instagram account to publish ${workspace.name}'s content to it.`}
          />
        ) : null}
        {state.status === 'ready'
          ? state.accounts.map((account) => (
              <SocialAccountCard
                key={account.id}
                account={account}
                timeZone={workspace.timezone}
                canManage={isOwner}
                canConnect={state.configured}
                pending={pending?.id === account.id ? pending.action : null}
                onRefresh={() => void refresh(account)}
                onReconnect={() => void connect(account.platform, account.id)}
                onDisconnect={() => void disconnect(account)}
              />
            ))
          : null}
      </section>
    </>
  );
}

export function SocialAccountsPage() {
  useDocumentTitle('Social Accounts');
  const workspace = useActiveWorkspace();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Social Accounts"
        description={`The ${SOCIAL_PLATFORM_LABELS.facebook} Pages and ${SOCIAL_PLATFORM_LABELS.instagram} accounts ${workspace.name} can publish to.`}
      />
      {/* Keyed by workspace: switching workspaces starts from a clean, loading page. */}
      <Accounts key={workspace.id} workspace={workspace} />
    </div>
  );
}
