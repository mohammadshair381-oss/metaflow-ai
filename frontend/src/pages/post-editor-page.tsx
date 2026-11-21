import {
  CAPTION_CHARACTER_LIMITS,
  EDITABLE_POST_STATUSES,
  POST_LIMITS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  checkPostReadiness,
  createPostRequestSchema,
  type Post,
  type PostMediaSummary,
  type PostWorkflowAction,
  type ReadinessIssue,
  type SocialAccount,
  type SocialPlatform,
  type Workspace,
  type WorkspaceMember,
} from '@metaflow/shared';
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  ImagePlus,
  LoaderCircle,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { MediaPicker } from '@/components/media/media-picker';
import { MediaPreview } from '@/components/media/media-preview';
import { PostStatusBadge } from '@/components/posts/post-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useActiveWorkspace } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { describeSubmitError, fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';
import { ApiRequestError } from '@/services/api-client';
import { createPost, getPost, runPostWorkflow, updatePost } from '@/services/post.service';
import { listSocialAccounts } from '@/services/social-account.service';
import { listWorkspaceMembers } from '@/services/workspace.service';

type Field = 'title' | 'caption' | 'hashtags' | 'platforms' | 'mediaIds' | 'socialAccountIds';
const FIELDS: readonly Field[] = [
  'title',
  'caption',
  'hashtags',
  'platforms',
  'mediaIds',
  'socialAccountIds',
];

interface Values {
  title: string;
  caption: string;
  hashtags: string;
  platforms: SocialPlatform[];
  socialAccountIds: string[];
  media: PostMediaSummary[];
}

const EMPTY: Values = {
  title: '',
  caption: '',
  hashtags: '',
  platforms: [],
  socialAccountIds: [],
  media: [],
};

const valuesOf = (post: Post): Values => ({
  title: post.title,
  caption: post.caption,
  hashtags: post.hashtags.map((tag) => `#${tag}`).join(' '),
  platforms: post.platforms,
  socialAccountIds: post.socialAccountIds,
  // Only items that still exist; deleted ones are dropped on the next save.
  media: post.media,
});

const parseHashtags = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

const toRequest = (values: Values) => ({
  title: values.title,
  caption: values.caption,
  hashtags: parseHashtags(values.hashtags),
  platforms: values.platforms,
  socialAccountIds: values.socialAccountIds,
  mediaIds: values.media.map((item) => item.id),
});

const ACTION_LABELS: Record<PostWorkflowAction, string> = {
  submit: 'Submitted for approval',
  withdraw: 'Withdrawn from approval',
  approve: 'Approved',
  request_changes: 'Changes requested',
  reopen: 'Reopened for editing',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | {
      status: 'ready';
      post: Post | null;
      accounts: SocialAccount[];
      members: WorkspaceMember[];
    };

/**
 * Shown after a 409 CONFLICT: the post changed since this page loaded it. Nothing was saved;
 * loading the latest version replaces what is on screen (including unsaved changes).
 */
function LoadLatestVersion({
  onReload,
  discardsChanges,
}: {
  onReload: () => void;
  discardsChanges?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onReload}>
        Load the latest version
      </Button>
      {discardsChanges ? (
        <span className="text-muted-foreground text-xs">
          Your unsaved changes will be replaced. Copy anything you want to keep first.
        </span>
      ) : null}
    </div>
  );
}

function ReadinessPanel({ issues, saved }: { issues: ReadinessIssue[]; saved: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform check</CardTitle>
        <CardDescription>
          Rules each platform applies, checked as you edit. Passing them is needed to submit for
          approval; Meta can still refuse a post when it is published.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <p className="text-success flex items-center gap-2 text-sm font-medium">
            <CircleCheck className="size-4" aria-hidden />
            {saved ? 'Ready to submit for approval.' : 'Ready. Save the post to submit it.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" aria-label="Issues to fix">
            {issues.map((issue) => (
              <li key={`${issue.platform}-${issue.field}-${issue.message}`} className="flex gap-2">
                <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowPanel({
  workspace,
  post,
  members,
  dirty,
  ready,
  onChanged,
  onReload,
}: {
  workspace: Workspace;
  post: Post;
  members: WorkspaceMember[];
  dirty: boolean;
  ready: boolean;
  onChanged: (post: Post) => void;
  /** Loads the latest version of the post (after a conflict). */
  onReload: () => void;
}) {
  const { state: auth } = useAuth();
  const userId = auth.status === 'authenticated' ? auth.user.id : null;
  const [busy, setBusy] = useState<PostWorkflowAction | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<{
    message: string;
    details: string[];
    conflict: boolean;
  } | null>(null);
  const isOwner = workspace.role === 'owner';
  const submitter = post.reviewEvents.findLast((event) => event.action === 'submit')?.by;
  const lastChangeRequest =
    post.status === 'changes_requested'
      ? post.reviewEvents.findLast((event) => event.action === 'request_changes')
      : undefined;
  const nameOf = (id: string) =>
    id === userId ? 'You' : (members.find((member) => member.userId === id)?.name ?? 'A member');
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: workspace.timezone,
    }).format(new Date(value));

  async function run(action: PostWorkflowAction) {
    setBusy(action);
    setError(null);
    try {
      // Sent with the revision on screen: the decision applies only to this exact version.
      onChanged(
        await runPostWorkflow(
          workspace.id,
          post.id,
          action,
          post.revision,
          note.trim() || undefined,
        ),
      );
      setNote('');
    } catch (caught) {
      setError({
        message: describeSubmitError(caught, []).formError ?? 'That did not work.',
        details:
          caught instanceof ApiRequestError && caught.code === 'POST_NOT_READY'
            ? caught.details.map((detail) => detail.message)
            : [],
        conflict: caught instanceof ApiRequestError && caught.code === 'CONFLICT',
      });
    } finally {
      setBusy(null);
    }
  }

  const actionButton = (
    action: PostWorkflowAction,
    label: string,
    variant: 'default' | 'outline' = 'default',
    disabled = false,
  ) => (
    <Button
      key={action}
      size="sm"
      variant={variant}
      disabled={busy !== null || disabled}
      onClick={() => void run(action)}
    >
      {busy === action ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval</CardTitle>
        <CardDescription>
          Staff submit posts; the workspace owner approves them or asks for changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          Status: <PostStatusBadge status={post.status} />
        </div>
        {lastChangeRequest?.note ? (
          <div className="bg-muted rounded-md p-3 text-sm">
            <p className="text-muted-foreground text-xs">
              {nameOf(lastChangeRequest.by)} asked for changes:
            </p>
            <p className="whitespace-pre-wrap">{lastChangeRequest.note}</p>
          </div>
        ) : null}

        {EDITABLE_POST_STATUSES.includes(post.status) ? (
          <div className="flex flex-col gap-2">
            <div>{actionButton('submit', 'Submit for approval', 'default', dirty || !ready)}</div>
            {dirty ? (
              <p className="text-muted-foreground text-xs">Save your changes before submitting.</p>
            ) : !ready ? (
              <p className="text-muted-foreground text-xs">
                Fix the platform check issues before submitting.
              </p>
            ) : null}
          </div>
        ) : null}

        {post.status === 'awaiting_approval' ? (
          <div className="flex flex-col gap-3">
            {isOwner ? (
              <>
                <FormField
                  label="Note for the author (optional)"
                  hint="Saved with your decision. Most useful when asking for changes."
                >
                  {(props) => (
                    <Textarea
                      {...props}
                      rows={2}
                      value={note}
                      maxLength={POST_LIMITS.reviewNote}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  )}
                </FormField>
                <div className="flex flex-wrap gap-2">
                  {actionButton('approve', 'Approve')}
                  {actionButton('request_changes', 'Request changes', 'outline')}
                </div>
                {submitter === userId ? (
                  <p className="text-muted-foreground text-xs">
                    You submitted this post yourself. Approving it is recorded under your name.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Waiting for the workspace owner to review it.
              </p>
            )}
            {isOwner || submitter === userId ? (
              <div>{actionButton('withdraw', 'Withdraw to edit', 'outline')}</div>
            ) : null}
          </div>
        ) : null}

        {post.status === 'approved' ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              Approved and locked. Scheduling and publishing arrive in a later milestone.
            </p>
            <div>{actionButton('reopen', 'Reopen for editing', 'outline')}</div>
          </div>
        ) : null}

        {error ? (
          <div className="flex flex-col gap-2">
            <FormAlert message={error.message} />
            {error.details.length > 0 ? (
              <ul className="text-destructive list-disc pl-5 text-sm">
                {error.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
            {error.conflict ? <LoadLatestVersion onReload={onReload} /> : null}
          </div>
        ) : null}

        {post.reviewEvents.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-sm font-medium">History</h3>
            <ol className="flex flex-col gap-2 text-sm">
              {[...post.reviewEvents].reverse().map((event) => (
                <li key={`${event.action}-${event.at}`} className="flex flex-col">
                  <span>
                    {ACTION_LABELS[event.action]} by {nameOf(event.by)}
                  </span>
                  <span className="text-muted-foreground text-xs">{formatDate(event.at)}</span>
                  {event.note ? (
                    <span className="text-muted-foreground text-xs whitespace-pre-wrap">
                      “{event.note}”
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Editor({ workspace, postId }: { workspace: Workspace; postId: string | null }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY);
  const [savedValues, setSavedValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      postId ? getPost(workspace.id, postId, signal) : Promise.resolve(null),
      listSocialAccounts(workspace.id, signal),
      listWorkspaceMembers(workspace.id, signal).catch(() => []),
    ]).then(
      ([post, accounts, members]) => {
        const initial = post ? valuesOf(post) : EMPTY;
        setValues(initial);
        setSavedValues(initial);
        setLoad({ status: 'ready', post, accounts: accounts.accounts, members });
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setLoad({
          status:
            error instanceof ApiRequestError && (error.status === 404 || error.status === 400)
              ? 'not_found'
              : 'error',
        });
      },
    );
    return () => controller.abort();
  }, [workspace.id, postId, attempt]);

  const accounts = useMemo(() => (load.status === 'ready' ? load.accounts : []), [load]);
  const post = load.status === 'ready' ? load.post : null;
  const editable = !post || EDITABLE_POST_STATUSES.includes(post.status);
  const dirty = JSON.stringify(toRequest(values)) !== JSON.stringify(toRequest(savedValues));

  const issues = useMemo(() => {
    const knownAccounts = values.socialAccountIds.flatMap(
      (id) => accounts.find((account) => account.id === id) ?? [],
    );
    return checkPostReadiness({
      platforms: values.platforms,
      caption: values.caption.trim(),
      hashtags: parseHashtags(values.hashtags),
      media: values.media,
      accounts: knownAccounts,
      missingMediaCount: 0,
      missingAccountCount: values.socialAccountIds.length - knownAccounts.length,
    });
  }, [values, accounts]);

  /** Loads the post again from the server (after a conflict); local edits are replaced. */
  const reload = () => {
    setErrors({});
    setFormError(null);
    setSaveConflict(false);
    setSavedNotice(false);
    setLoad({ status: 'loading' });
    setAttempt((value) => value + 1);
  };

  const change = (patch: Partial<Values>) => {
    setValues((current) => ({ ...current, ...patch }));
    setSavedNotice(false);
  };

  function togglePlatform(platform: SocialPlatform, checked: boolean) {
    setValues((current) => {
      const platforms = checked
        ? [...current.platforms, platform]
        : current.platforms.filter((entry) => entry !== platform);
      // Accounts on a platform that is no longer selected go with it.
      const socialAccountIds = current.socialAccountIds.filter((id) => {
        const account = accounts.find((entry) => entry.id === id);
        return !account || platforms.includes(account.platform);
      });
      return { ...current, platforms, socialAccountIds };
    });
    setSavedNotice(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaveConflict(false);
    const request = toRequest(values);
    const parsed = createPostRequestSchema.safeParse(request);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod<Field>(parsed.error));
      setFormError('Check the highlighted fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!post) {
        const created = await createPost(workspace.id, request);
        void navigate(`/posts/${created.id}`, { replace: true });
        return;
      }
      // Sent with the revision this form was loaded from: if someone else saved in the
      // meantime, the server refuses (409 CONFLICT) instead of overwriting their changes.
      const updated = await updatePost(workspace.id, post.id, {
        ...request,
        revision: post.revision,
      });
      const next = valuesOf(updated);
      setValues(next);
      setSavedValues(next);
      setLoad((current) => (current.status === 'ready' ? { ...current, post: updated } : current));
      setSavedNotice(true);
    } catch (caught) {
      const described = describeSubmitError(caught, FIELDS);
      setErrors(described.fieldErrors);
      setFormError(described.formError);
      setSaveConflict(caught instanceof ApiRequestError && caught.code === 'CONFLICT');
    } finally {
      setSaving(false);
    }
  }

  if (load.status === 'loading') {
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading the post…</span>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (load.status === 'not_found') {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Post not found"
        description="It may have been deleted, or it belongs to another workspace."
      >
        <Button asChild size="sm" variant="outline">
          <Link to="/posts">Back to posts</Link>
        </Button>
      </EmptyState>
    );
  }
  if (load.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormAlert message="We could not load this post." />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoad({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const limitFor = values.platforms.length
    ? Math.min(...values.platforms.map((platform) => CAPTION_CHARACTER_LIMITS[platform]))
    : CAPTION_CHARACTER_LIMITS.facebook;
  const deletedMedia = post ? post.mediaIds.length - post.media.length : 0;
  const readOnlyReason =
    post?.status === 'awaiting_approval'
      ? 'This post is awaiting approval. Withdraw it to make changes.'
      : post && !editable
        ? 'This post is approved and locked. Reopen it to make changes.'
        : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form className="flex flex-col gap-6" onSubmit={(event) => void save(event)} noValidate>
        {readOnlyReason ? <FormAlert message={readOnlyReason} /> : null}
        <fieldset disabled={!editable || saving} className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField
                label="Title"
                error={errors.title}
                hint="Only shown inside MetaFlow AI, to find the post again."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={values.title}
                    maxLength={POST_LIMITS.title}
                    onChange={(event) => change({ title: event.target.value })}
                  />
                )}
              </FormField>
              <FormField
                label="Caption"
                error={errors.caption}
                hint={`${values.caption.trim().length} / ${limitFor} characters`}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={8}
                    value={values.caption}
                    onChange={(event) => change({ caption: event.target.value })}
                  />
                )}
              </FormField>
              <FormField
                label="Hashtags"
                error={errors.hashtags}
                hint="Separate with spaces or commas, for example #bakery #croissant."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={values.hashtags}
                    onChange={(event) => change({ hashtags: event.target.value })}
                  />
                )}
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
              <CardDescription>
                Up to {POST_LIMITS.media} items from the media library, in the order shown.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {deletedMedia > 0 ? (
                <p className="text-muted-foreground text-sm">
                  {deletedMedia === 1
                    ? '1 attached item was deleted from the library'
                    : `${deletedMedia} attached items were deleted from the library`}{' '}
                  and will be removed when you save.
                </p>
              ) : null}
              {values.media.length > 0 ? (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-label="Attached media">
                  {values.media.map((item) => (
                    <li key={item.id} className="relative">
                      <MediaPreview workspaceId={workspace.id} media={item} />
                      {editable ? (
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="secondary"
                          className="absolute top-1 right-1"
                          aria-label={`Remove ${item.originalName}`}
                          onClick={() =>
                            change({ media: values.media.filter((entry) => entry.id !== item.id) })
                          }
                        >
                          <X aria-hidden />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No media attached.</p>
              )}
              {errors.mediaIds ? (
                <p className="text-destructive text-xs font-medium">{errors.mediaIds}</p>
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={values.media.length >= POST_LIMITS.media}
                  onClick={() => setPickerOpen(true)}
                >
                  <ImagePlus aria-hidden />
                  Add media
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Platforms and accounts</CardTitle>
              <CardDescription>
                Where this post will go once publishing is available.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Platforms</legend>
                {SOCIAL_PLATFORMS.map((platform) => (
                  <label key={platform} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={values.platforms.includes(platform)}
                      onChange={(event) => togglePlatform(platform, event.target.checked)}
                    />
                    {SOCIAL_PLATFORM_LABELS[platform]}
                  </label>
                ))}
              </fieldset>
              {values.platforms.map((platform) => {
                const options = accounts.filter((account) => account.platform === platform);
                return (
                  <fieldset key={platform} className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">
                      {SOCIAL_PLATFORM_LABELS[platform]} accounts
                    </legend>
                    {options.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No {SOCIAL_PLATFORM_LABELS[platform]} account is connected.{' '}
                        <Link to="/accounts" className="underline">
                          Connect one
                        </Link>
                        .
                      </p>
                    ) : (
                      options.map((account) => (
                        <label key={account.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={values.socialAccountIds.includes(account.id)}
                            onChange={(event) =>
                              change({
                                socialAccountIds: event.target.checked
                                  ? [...values.socialAccountIds, account.id]
                                  : values.socialAccountIds.filter((id) => id !== account.id),
                              })
                            }
                          />
                          {account.name}
                          {account.username ? (
                            <span className="text-muted-foreground">@{account.username}</span>
                          ) : null}
                          {account.status !== 'connected' ? (
                            <Badge variant="outline">Needs reconnecting</Badge>
                          ) : null}
                        </label>
                      ))
                    )}
                  </fieldset>
                );
              })}
              {errors.socialAccountIds || errors.platforms ? (
                <p className="text-destructive text-xs font-medium">
                  {errors.socialAccountIds ?? errors.platforms}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </fieldset>

        {formError ? <FormAlert message={formError} /> : null}
        {saveConflict ? <LoadLatestVersion onReload={reload} discardsChanges /> : null}
        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving || (Boolean(post) && !dirty)}>
              {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {post ? 'Save changes' : 'Save draft'}
            </Button>
            {post && dirty ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setValues(savedValues);
                  setErrors({});
                  setFormError(null);
                }}
              >
                <Undo2 aria-hidden />
                Discard changes
              </Button>
            ) : null}
            {savedNotice ? (
              <span role="status" className="text-success flex items-center gap-1 text-sm">
                <CircleCheck className="size-4" aria-hidden />
                Saved.
              </span>
            ) : null}
          </div>
        ) : null}
      </form>

      <div className="flex flex-col gap-6">
        <ReadinessPanel issues={issues} saved={Boolean(post) && !dirty} />
        {post ? (
          <WorkflowPanel
            workspace={workspace}
            post={post}
            members={load.members}
            dirty={dirty}
            ready={issues.length === 0}
            onChanged={(next) => {
              const nextValues = valuesOf(next);
              setValues(nextValues);
              setSavedValues(nextValues);
              setSavedNotice(false);
              setLoad((current) =>
                current.status === 'ready' ? { ...current, post: next } : current,
              );
            }}
            onReload={reload}
          />
        ) : null}
      </div>

      <MediaPicker
        workspaceId={workspace.id}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add media"
        description="Choose photos or videos from this workspace's library, or upload new ones."
        maxSelection={POST_LIMITS.media - values.media.length}
        excludeIds={values.media.map((item) => item.id)}
        onConfirm={(items) => change({ media: [...values.media, ...items] })}
      />
    </div>
  );
}

export function PostEditorPage() {
  const { postId = null } = useParams();
  const workspace = useActiveWorkspace();
  useDocumentTitle(postId ? 'Edit post' : 'New post');
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/posts">
              <ArrowLeft aria-hidden />
              All posts
            </Link>
          </Button>
        </div>
        <PageHeader
          title={postId ? 'Edit post' : 'New post'}
          description="Drafts can be saved at any time. Submitting for approval needs the platform check to pass."
        />
      </div>
      <Editor key={`${workspace.id}:${postId ?? 'new'}`} workspace={workspace} postId={postId} />
    </div>
  );
}
